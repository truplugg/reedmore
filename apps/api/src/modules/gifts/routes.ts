import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, type OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { orderNumber } from '../../lib/crypto.js';
import { conflict, forbidden, notFound, badRequest } from '../../lib/errors.js';
import { priceOf } from '../../lib/money.js';
import { readContext } from '../books/public.js';
import { BOOK_INCLUDE, shopBook } from '../books/view.js';
import { audit } from '../../lib/audit.js';

/**
 * A gift order, as the donor is allowed to see it.
 *
 * This function is the privacy boundary (§20). It is the only thing that turns
 * a gift into JSON for a donor, and there is no recipient address in it to
 * leave out — the query it is fed never loads one.
 */
function donorGift(row: {
  id: string; number: string; status: OrderStatus; currency: 'EUR' | 'UAH';
  total: number; createdAt: Date;
  gift: { anonymous: boolean; message: string | null; recipient: { profile: { nickname: string; avatarUrl: string | null } | null } | null } | null;
  items: Array<{ titleSnapshot: string; authorSnapshot: string | null; unitPrice: number }>;
}) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: row.currency,
    total: row.total,
    createdAt: row.createdAt.toISOString(),
    anonymous: row.gift?.anonymous ?? false,
    message: row.gift?.message ?? null,
    // The donor knows who they are sending to, because they chose the list.
    // A nickname and a picture is all that ever was.
    recipient: row.gift?.recipient?.profile
      ? { nickname: row.gift.recipient.profile.nickname, avatarUrl: row.gift.recipient.profile.avatarUrl }
      : null,
    items: row.items.map((i) => ({ title: i.titleSnapshot, author: i.authorSnapshot, unitPrice: i.unitPrice }))
  };
}

/** What a recipient sees about a gift coming to them (§21). */
function recipientGift(row: {
  id: string; number: string; status: OrderStatus; createdAt: Date;
  gift: { anonymous: boolean; message: string | null; donor: { profile: { nickname: string; avatarUrl: string | null } | null } | null } | null;
  items: Array<{ titleSnapshot: string; authorSnapshot: string | null }>;
}) {
  const anon = row.gift?.anonymous ?? true;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    message: row.gift?.message ?? null,
    // An anonymous gift says nothing about the donor. Not a hidden field —
    // the branch never reads one.
    from: anon || !row.gift?.donor?.profile
      ? null
      : { nickname: row.gift.donor.profile.nickname, avatarUrl: row.gift.donor.profile.avatarUrl },
    items: row.items.map((i) => ({ title: i.titleSnapshot, author: i.authorSnapshot }))
  };
}

const DONOR_SELECT = {
  id: true, number: true, status: true, currency: true, total: true, createdAt: true,
  items: { select: { titleSnapshot: true, authorSnapshot: true, unitPrice: true } },
  gift: {
    select: {
      anonymous: true, message: true,
      recipient: { select: { profile: { select: { nickname: true, avatarUrl: true } } } }
    }
  }
} satisfies Prisma.OrderSelect;

const RECIPIENT_SELECT = {
  id: true, number: true, status: true, createdAt: true,
  items: { select: { titleSnapshot: true, authorSnapshot: true } },
  gift: {
    select: {
      anonymous: true, message: true,
      donor: { select: { profile: { select: { nickname: true, avatarUrl: true } } } }
    }
  }
} satisfies Prisma.OrderSelect;

export default async function giftRoutes(app: FastifyInstance) {
  /**
   * Reserve a wishlist item and open a gift order.
   *
   * The whole thing is one transaction at SERIALIZABLE, and the write that
   * matters is conditional: `updateMany` with `status: 'AVAILABLE'` in the
   * where clause. Two donors racing for the same book both try it; one
   * updates a row, the other updates none and is told so. Even if both got
   * past that, `reservedByGiftId` is unique, so the database refuses the
   * second write. (§17)
   */
  app.post('/reserve', async (req, reply) => {
    const viewer = req.requireViewer();
    const { currency } = readContext(req);
    const body = z.object({
      wishlistItemId: z.string().min(1),
      anonymous: z.boolean().default(false),
      message: z.string().max(500).optional()
    }).parse(req.body);

    const item = await prisma.wishlistItem.findUnique({
      where: { id: body.wishlistItemId },
      include: { book: { include: BOOK_INCLUDE }, wishlist: { select: { ownerId: true, visibility: true } } }
    });
    if (!item) throw notFound('That book is no longer on the list.');
    if (item.wishlist.visibility === 'PRIVATE') throw notFound('That book is no longer on the list.');
    if (item.wishlist.ownerId === viewer.id) throw badRequest('own_wishlist', 'That is your own list.');
    if (item.status !== 'AVAILABLE') throw conflict('already_reserved', 'Someone else is already sending this one.');

    const { amount } = priceOf(item.book, currency);

    try {
      const order = await prisma.$transaction(async (tx) => {
        /* The order is written first because the claim needs its gift id.
           Both live in the same transaction, so an order whose claim fails
           never exists. */
        const created = await tx.order.create({
          data: {
            number: orderNumber('RG'),
            type: 'GIFT',
            status: 'PENDING',
            customerId: viewer.id,
            currency,
            subtotal: amount, shippingCost: 0, total: amount,
            items: {
              create: {
                bookId: item.bookId,
                titleSnapshot: item.book.title,
                authorSnapshot: item.book.author,
                unitPrice: amount, quantity: 1, lineTotal: amount
              }
            },
            gift: {
              create: {
                donorId: viewer.id,
                recipientId: item.wishlist.ownerId,
                wishlistItemId: item.id,
                anonymous: body.anonymous,
                message: body.message ?? null
              }
            },
            history: { create: { to: 'PENDING', note: 'Gift reserved', actorId: viewer.id } }
          },
          select: { ...DONOR_SELECT, gift: { select: { ...DONOR_SELECT.gift.select, id: true } } }
        });

        /* One conditional statement claims the item: `status: 'AVAILABLE'`
           in the where clause means the second of two racing donors updates
           no rows and is told so. Status and gift id are set together because
           the check constraint requires them to agree — which is exactly the
           guarantee wanted, so the code bends to it rather than the reverse.
           reservedByGiftId is unique as well, so even a lost update cannot
           produce two gifts for one book. */
        const claimed = await tx.wishlistItem.updateMany({
          where: { id: item.id, status: 'AVAILABLE', reservedByGiftId: null },
          data: { status: 'RESERVED', reservedAt: new Date(), reservedByGiftId: created.gift!.id }
        });
        if (claimed.count !== 1) throw conflict('already_reserved', 'Someone else got there first.');

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await audit(viewer.id, 'gift.reserve', 'Order', order.id, { anonymous: body.anonymous }, req.ip);
      reply.code(201);
      return { gift: donorGift(order) };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' || (err as { code?: string }).code === 'P2034') {
        throw conflict('already_reserved', 'Someone else got there first.');
      }
      throw err;
    }
  });

  /** Gifts this account has sent. */
  app.get('/sent', async (req) => {
    const viewer = req.requireViewer();
    const rows = await prisma.order.findMany({
      where: { type: 'GIFT', gift: { donorId: viewer.id } },
      select: DONOR_SELECT, orderBy: { createdAt: 'desc' }, take: 50
    });
    return { gifts: rows.map(donorGift) };
  });

  /** Gifts on the way here. */
  app.get('/received', async (req) => {
    const viewer = req.requireViewer();
    const rows = await prisma.order.findMany({
      where: { type: 'GIFT', gift: { recipientId: viewer.id } },
      select: RECIPIENT_SELECT, orderBy: { createdAt: 'desc' }, take: 50
    });
    return { gifts: rows.map(recipientGift) };
  });

  app.post('/:id/cancel', async (req) => {
    const viewer = req.requireViewer();
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, gift: { select: { id: true, donorId: true, wishlistItemId: true } } }
    });
    if (!order?.gift) throw notFound('No such gift.');
    if (order.gift.donorId !== viewer.id) throw forbidden('That is not your gift.');
    if (!['PENDING', 'AWAITING_RECIPIENT_CONTACT'].includes(order.status)) {
      throw badRequest('too_late', 'A manager has already started on this one. Get in touch and we will sort it out.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.orderStatusHistory.create({
        data: { orderId: id, from: order.status, to: 'CANCELLED', note: 'Cancelled by donor', actorId: viewer.id }
      });
      // The book goes back on the list for someone else.
      if (order.gift!.wishlistItemId) {
        await tx.wishlistItem.updateMany({
          where: { id: order.gift!.wishlistItemId, status: 'RESERVED' },
          data: { status: 'AVAILABLE', reservedByGiftId: null, reservedAt: null }
        });
      }
    });

    await audit(viewer.id, 'gift.cancel', 'Order', id, null, req.ip);
    return { ok: true };
  });

  // ------------------------------------------------------------- random
  /**
   * Pick a stranger with a public list who has something still available.
   * Nothing is bought here: the donor is shown the list and chooses (§19 A).
   */
  app.get('/random/person', async (req) => {
    const viewer = req.requireViewer();
    const { locale, currency } = readContext(req);

    const candidates = await prisma.wishlist.findMany({
      where: {
        visibility: 'PUBLIC',
        ownerId: { not: viewer.id },
        items: { some: { status: 'AVAILABLE' } }
      },
      select: { id: true }
    });
    if (!candidates.length) throw notFound('Nobody has a public list with anything left on it yet.');

    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    const list = await prisma.wishlist.findUniqueOrThrow({
      where: { id: pick.id },
      include: {
        owner: { select: { id: true, profile: { select: { nickname: true, avatarUrl: true } } } },
        items: { where: { status: 'AVAILABLE' }, include: { book: { include: BOOK_INCLUDE } } }
      }
    });

    return {
      wishlist: {
        id: list.id,
        title: list.title,
        owner: { nickname: list.owner.profile?.nickname ?? 'reader', avatarUrl: list.owner.profile?.avatarUrl ?? null },
        availableCount: list.items.length,
        items: list.items.map((i) => ({ id: i.id, note: i.note, book: shopBook(i.book, locale, currency) }))
      }
    };
  });

  /**
   * A stranger and one of their books, both chosen for you (§19 B). Still
   * only a suggestion — it is shown, and confirming is a separate call, so
   * nothing is ever bought by surprise.
   */
  app.get('/random/book', async (req) => {
    const viewer = req.requireViewer();
    const { locale, currency } = readContext(req);

    const pool = await prisma.wishlistItem.findMany({
      where: {
        status: 'AVAILABLE',
        wishlist: { visibility: 'PUBLIC', ownerId: { not: viewer.id } },
        book: { status: 'PUBLISHED' }
      },
      select: { id: true }
    });
    if (!pool.length) throw notFound('Nothing is waiting on a public list just now.');

    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const item = await prisma.wishlistItem.findUniqueOrThrow({
      where: { id: pick.id },
      include: {
        book: { include: BOOK_INCLUDE },
        wishlist: { select: { id: true, title: true, owner: { select: { profile: { select: { nickname: true, avatarUrl: true } } } } } }
      }
    });

    return {
      suggestion: {
        wishlistItemId: item.id,
        note: item.note,
        book: shopBook(item.book, locale, currency),
        wishlist: { id: item.wishlist.id, title: item.wishlist.title },
        owner: {
          nickname: item.wishlist.owner.profile?.nickname ?? 'reader',
          avatarUrl: item.wishlist.owner.profile?.avatarUrl ?? null
        }
      }
    };
  });
}

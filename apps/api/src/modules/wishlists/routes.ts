import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { newToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { readContext } from '../books/public.js';
import { WISHLIST_INCLUDE, ownerWishlist, visitorWishlist, wishlistCard } from './view.js';

const MAX_ITEMS = 120;
const MAX_LISTS = 30;

export default async function wishlistRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- mine
  app.get('/mine', async (req) => {
    const viewer = req.requireViewer();
    const { locale, currency } = readContext(req);
    const lists = await prisma.wishlist.findMany({
      where: { ownerId: viewer.id }, include: WISHLIST_INCLUDE, orderBy: { createdAt: 'asc' }
    });
    return { wishlists: lists.map((w) => ownerWishlist(w, locale, currency)) };
  });

  app.post('/', async (req, reply) => {
    const viewer = req.requireViewer();
    const body = z.object({
      title: z.string().min(1).max(80),
      visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).default('PRIVATE')
    }).parse(req.body);

    const count = await prisma.wishlist.count({ where: { ownerId: viewer.id } });
    if (count >= MAX_LISTS) throw badRequest('too_many_lists', `You can keep up to ${MAX_LISTS} lists.`);

    try {
      const list = await prisma.wishlist.create({
        data: {
          ownerId: viewer.id, title: body.title, visibility: body.visibility,
          shareToken: body.visibility === 'UNLISTED' ? newToken(18) : null
        },
        include: WISHLIST_INCLUDE
      });
      const { locale, currency } = readContext(req);
      reply.code(201);
      return { wishlist: ownerWishlist(list, locale, currency) };
    } catch (err) {
      // The partial unique index is what actually enforces "one public list".
      if (isUniqueViolation(err, 'ownerId')) {
        throw conflict('public_list_exists', 'You already have a public list. Make that one private first.');
      }
      throw err;
    }
  });

  app.patch('/:id', async (req) => {
    const viewer = req.requireViewer();
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      title: z.string().min(1).max(80).optional(),
      visibility: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional()
    }).parse(req.body);

    const list = await prisma.wishlist.findUnique({ where: { id }, select: { ownerId: true, visibility: true } });
    if (!list) throw notFound('No such list.');
    if (list.ownerId !== viewer.id) throw forbidden('That is not your list.');

    // The share token exists only while the list is unlisted; turning the mode
    // off and on again mints a new one, which is how a link gets revoked.
    const shareToken = body.visibility === undefined ? undefined
      : body.visibility === 'UNLISTED' ? newToken(18) : null;

    try {
      const updated = await prisma.wishlist.update({
        where: { id }, data: { ...body, ...(shareToken !== undefined ? { shareToken } : {}) },
        include: WISHLIST_INCLUDE
      });
      const { locale, currency } = readContext(req);
      return { wishlist: ownerWishlist(updated, locale, currency) };
    } catch (err) {
      if (isUniqueViolation(err, 'ownerId')) {
        throw conflict('public_list_exists', 'You already have a public list. Make that one private first.');
      }
      throw err;
    }
  });

  app.delete('/:id', async (req, reply) => {
    const viewer = req.requireViewer();
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const list = await prisma.wishlist.findUnique({
      where: { id },
      select: { ownerId: true, items: { where: { status: 'RESERVED' }, select: { id: true } } }
    });
    if (!list) throw notFound('No such list.');
    if (list.ownerId !== viewer.id) throw forbidden('That is not your list.');
    if (list.items.length) {
      throw badRequest('list_has_reserved_items', 'Someone is already buying something from this list, so it cannot be deleted yet.');
    }
    await prisma.wishlist.delete({ where: { id } });
    reply.code(204);
  });

  // ---------------------------------------------------------------- items
  app.post('/:id/items', async (req, reply) => {
    const viewer = req.requireViewer();
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      bookSlug: z.string().min(1).max(200),
      note: z.string().max(280).optional()
    }).parse(req.body);

    const [list, book] = await Promise.all([
      prisma.wishlist.findUnique({ where: { id }, select: { ownerId: true, _count: { select: { items: true } } } }),
      prisma.book.findFirst({ where: { slug: body.bookSlug, status: 'PUBLISHED' }, select: { id: true } })
    ]);
    if (!list) throw notFound('No such list.');
    if (list.ownerId !== viewer.id) throw forbidden('That is not your list.');
    if (!book) throw notFound('No such book.');
    if (list._count.items >= MAX_ITEMS) throw badRequest('list_full', `A list holds up to ${MAX_ITEMS} books.`);

    try {
      // Quantity is always one (§17), so the pair is unique and a second add
      // is a no-op rather than a second copy.
      await prisma.wishlistItem.create({
        data: { wishlistId: id, bookId: book.id, note: body.note ?? null, position: list._count.items }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('already_on_list', 'That book is already on this list.');
      throw err;
    }

    const full = await prisma.wishlist.findUniqueOrThrow({ where: { id }, include: WISHLIST_INCLUDE });
    const { locale, currency } = readContext(req);
    reply.code(201);
    return { wishlist: ownerWishlist(full, locale, currency) };
  });

  app.delete('/:id/items/:itemId', async (req, reply) => {
    const viewer = req.requireViewer();
    const { id, itemId } = z.object({ id: z.string().min(1), itemId: z.string().min(1) }).parse(req.params);

    const item = await prisma.wishlistItem.findUnique({
      where: { id: itemId }, select: { wishlistId: true, status: true, wishlist: { select: { ownerId: true } } }
    });
    if (!item || item.wishlistId !== id) throw notFound('No such item.');
    if (item.wishlist.ownerId !== viewer.id) throw forbidden('That is not your list.');
    if (item.status !== 'AVAILABLE') {
      throw badRequest('item_reserved', 'Someone is already buying this one, so it cannot be removed.');
    }
    await prisma.wishlistItem.delete({ where: { id: itemId } });
    reply.code(204);
  });

  // ------------------------------------------------------------- browsing
  /** The home page's block. Open to everyone — a shop window nobody can see
   *  into is not a shop window. Giving still needs an account. */
  app.get('/public', async (req) => {
    const { locale, currency } = readContext(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);

    const lists = await prisma.wishlist.findMany({
      where: { visibility: 'PUBLIC', items: { some: { status: 'AVAILABLE' } } },
      include: WISHLIST_INCLUDE, orderBy: { updatedAt: 'desc' }, take: q.limit
    });
    return { wishlists: lists.map((w) => wishlistCard(w, locale, currency)) };
  });

  app.get('/:id', async (req) => {
    const viewer = req.viewer;
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { locale, currency } = readContext(req);

    const list = await prisma.wishlist.findUnique({ where: { id }, include: WISHLIST_INCLUDE });
    if (!list) throw notFound('No such list.');

    if (viewer && list.ownerId === viewer.id) return { wishlist: ownerWishlist(list, locale, currency), mine: true };
    // A private list is invisible, and an unlisted one is only reachable by
    // its token — so neither is found by guessing an id.
    if (list.visibility !== 'PUBLIC') throw notFound('No such list.');
    return { wishlist: visitorWishlist(list, locale, currency), mine: false };
  });

  /** The share link. The token is the whole secret, so it is matched on its
   *  own and the id is not part of the route. */
  app.get('/shared/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(8).max(100) }).parse(req.params);
    const { locale, currency } = readContext(req);

    const list = await prisma.wishlist.findUnique({ where: { shareToken: token }, include: WISHLIST_INCLUDE });
    if (!list || list.visibility !== 'UNLISTED') throw notFound('That link does not lead anywhere.');
    return { wishlist: visitorWishlist(list, locale, currency), mine: list.ownerId === req.viewer?.id };
  });
}

/**
 * Prisma reports a unique violation by the COLUMNS the index covers, not by
 * the index name, so matching on `wishlists_one_public_per_owner` never fired
 * and a second public list came back as a generic 409. `ownerId` is the only
 * unique index on this table that covers it, so that is what to match.
 */
function isUniqueViolation(err: unknown, ...columns: string[]): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return false;
  if (!columns.length) return true;
  const target = e.meta?.target;
  const named = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return columns.some((c) => named.some((n) => n.includes(c)));
}

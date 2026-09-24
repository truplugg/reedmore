import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, type OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

/**
 * The manager's workflow (§20, §25).
 *
 * A gift order walks a longer road than a regular one, because the shop has
 * to ask the recipient where to send it without ever telling the donor. The
 * statuses below are that conversation, and the address a manager records
 * here is never reachable from any donor-facing route.
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  PENDING:                    ['AWAITING_RECIPIENT_CONTACT', 'READY_FOR_PROCESSING', 'PROCESSING', 'CANCELLED'],
  AWAITING_RECIPIENT_CONTACT: ['RECIPIENT_CONTACTED', 'CANCELLED'],
  RECIPIENT_CONTACTED:        ['AWAITING_ADDRESS', 'READY_FOR_PROCESSING', 'CANCELLED'],
  AWAITING_ADDRESS:           ['READY_FOR_PROCESSING', 'CANCELLED'],
  READY_FOR_PROCESSING:       ['PROCESSING', 'CANCELLED'],
  PROCESSING:                 ['SHIPPED', 'CANCELLED'],
  SHIPPED:                    ['DELIVERED'],
  DELIVERED:                  [],
  CANCELLED:                  []
};

const ORDER_INCLUDE = {
  items: true,
  customer: { select: { id: true, email: true, profile: { select: { nickname: true } } } },
  shippingAddress: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  gift: {
    include: {
      donor: { select: { id: true, profile: { select: { nickname: true, avatarUrl: true } } } },
      recipient: { select: { id: true, email: true, profile: { select: { nickname: true, phone: true } } } }
    }
  }
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * The staff view. A manager needs contact details to do the job, so this
 * shape carries them — and this shape is only ever produced behind
 * `order.address.read` / `gift.process`.
 */
function managerOrder(o: OrderRow, canSeeAddress: boolean) {
  return {
    id: o.id,
    number: o.number,
    type: o.type,
    status: o.status,
    currency: o.currency,
    subtotal: o.subtotal, shippingCost: o.shippingCost, discount: o.discount, total: o.total,
    shippingCountry: o.shippingCountry,
    paymentProvider: o.paymentProvider, paymentStatus: o.paymentStatus, paidAt: o.paidAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    notes: o.notes,
    customer: o.customer
      ? { id: o.customer.id, email: o.customer.email, nickname: o.customer.profile?.nickname ?? null }
      : { id: null, email: o.customerEmailSnapshot, nickname: o.customerNameSnapshot },
    items: o.items.map((i) => ({
      title: i.titleSnapshot, author: i.authorSnapshot,
      unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal
    })),
    shippingAddress: canSeeAddress ? o.shippingAddress : null,
    gift: o.gift
      ? {
          anonymous: o.gift.anonymous,
          message: o.gift.message,
          donor: o.gift.donor?.profile
            ? { id: o.gift.donor.id, nickname: o.gift.donor.profile.nickname }
            : null,
          // The recipient's contact details are the manager's working material
          // and appear nowhere else in the API.
          recipient: canSeeAddress && o.gift.recipient
            ? {
                id: o.gift.recipient.id,
                email: o.gift.recipient.email,
                nickname: o.gift.recipient.profile?.nickname ?? null,
                phone: o.gift.recipient.profile?.phone ?? null
              }
            : o.gift.recipient?.profile
              ? { id: null, email: null, nickname: o.gift.recipient.profile.nickname, phone: null }
              : null,
          recipientContactedAt: o.gift.recipientContactedAt?.toISOString() ?? null,
          addressReceivedAt: o.gift.addressReceivedAt?.toISOString() ?? null,
          managerNotes: o.gift.managerNotes
        }
      : null,
    history: o.history.map((h) => ({
      from: h.from, to: h.to, note: h.note, at: h.createdAt.toISOString(), actorId: h.actorId
    }))
  };
}

export default async function adminOrderRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const viewer = req.requirePermission('order.read', 'gift.read');
    const q = z.object({
      type: z.enum(['REGULAR', 'GIFT']).optional(),
      status: z.string().max(40).optional(),
      search: z.string().max(80).optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(req.query);

    // A reader who only holds gift.read sees gift orders, and vice versa.
    const allowedTypes = [
      ...(viewer.permissions.has('order.read') ? ['REGULAR' as const] : []),
      ...(viewer.permissions.has('gift.read') ? ['GIFT' as const] : [])
    ];
    const type = q.type && allowedTypes.includes(q.type) ? [q.type] : allowedTypes;

    const where: Prisma.OrderWhereInput = {
      type: { in: type },
      ...(q.status ? { status: q.status as OrderStatus } : {}),
      ...(q.search ? {
        OR: [
          { number: { contains: q.search, mode: 'insensitive' } },
          { customer: { email: { contains: q.search, mode: 'insensitive' } } }
        ]
      } : {})
    };

    const canSeeAddress = viewer.permissions.has('order.address.read');
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.order.count({ where })
    ]);
    return { items: rows.map((o) => managerOrder(o, canSeeAddress)), total, page: q.page, perPage: q.perPage };
  });

  app.get('/:id', async (req) => {
    const viewer = req.requirePermission('order.read', 'gift.read');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw notFound('No such order.');
    if (order.type === 'GIFT' && !viewer.permissions.has('gift.read')) throw forbidden();
    if (order.type === 'REGULAR' && !viewer.permissions.has('order.read')) throw forbidden();
    return { order: managerOrder(order, viewer.permissions.has('order.address.read')) };
  });

  app.post('/:id/status', async (req) => {
    const viewer = req.requirePermission('order.write', 'gift.process');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      status: z.enum([
        'PENDING', 'AWAITING_RECIPIENT_CONTACT', 'RECIPIENT_CONTACTED', 'AWAITING_ADDRESS',
        'READY_FOR_PROCESSING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'
      ]),
      note: z.string().max(500).optional()
    }).parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id }, select: { status: true, type: true, gift: { select: { id: true, wishlistItemId: true } } }
    });
    if (!order) throw notFound('No such order.');
    if (order.type === 'GIFT' && !viewer.permissions.has('gift.process')) throw forbidden();
    if (order.type === 'REGULAR' && !viewer.permissions.has('order.write')) throw forbidden();

    if (!NEXT[order.status].includes(body.status)) {
      throw badRequest('bad_transition', `An order cannot go from ${order.status} to ${body.status}.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: body.status } });
      await tx.orderStatusHistory.create({
        data: { orderId: id, from: order.status, to: body.status, note: body.note ?? null, actorId: viewer.id }
      });

      if (order.gift) {
        if (body.status === 'RECIPIENT_CONTACTED') {
          await tx.giftOrderData.update({ where: { id: order.gift.id }, data: { recipientContactedAt: new Date() } });
        }
        if (body.status === 'READY_FOR_PROCESSING') {
          await tx.giftOrderData.update({ where: { id: order.gift.id }, data: { addressReceivedAt: new Date() } });
        }
        // Delivered means the wish is granted; cancelled puts it back.
        if (body.status === 'DELIVERED' && order.gift.wishlistItemId) {
          await tx.wishlistItem.updateMany({
            where: { id: order.gift.wishlistItemId },
            data: { status: 'FULFILLED', fulfilledAt: new Date() }
          });
        }
        if (body.status === 'CANCELLED' && order.gift.wishlistItemId) {
          await tx.wishlistItem.updateMany({
            where: { id: order.gift.wishlistItemId, status: 'RESERVED' },
            data: { status: 'AVAILABLE', reservedByGiftId: null, reservedAt: null }
          });
        }
      }
    });

    await audit(viewer.id, 'order.status', 'Order', id, { from: order.status, to: body.status }, req.ip);
    const full = await prisma.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    return { order: managerOrder(full, viewer.permissions.has('order.address.read')) };
  });

  /** Record where a gift is going. Recipients give this to a manager
   *  directly; it never passes through the donor. (§20) */
  app.post('/:id/shipping-address', async (req) => {
    const viewer = req.requirePermission('gift.process', 'order.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      fullName: z.string().min(1).max(120),
      phone: z.string().max(40).optional(),
      country: z.enum(['DE', 'UA']),
      city: z.string().min(1).max(80),
      postalCode: z.string().min(1).max(20),
      line1: z.string().min(1).max(160),
      line2: z.string().max(160).optional(),
      pickupPoint: z.string().max(120).optional()
    }).parse(req.body);

    const order = await prisma.order.findUnique({ where: { id }, select: { id: true, shippingAddressId: true } });
    if (!order) throw notFound('No such order.');

    const address = order.shippingAddressId
      ? await prisma.shippingAddress.update({ where: { id: order.shippingAddressId }, data: body })
      : await prisma.shippingAddress.create({ data: body });

    await prisma.order.update({
      where: { id }, data: { shippingAddressId: address.id, shippingCountry: body.country }
    });
    await audit(viewer.id, 'order.address', 'Order', id, { country: body.country }, req.ip);
    return { ok: true };
  });

  app.post('/:id/notes', async (req) => {
    const viewer = req.requirePermission('order.write', 'gift.process');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ notes: z.string().max(4000).nullable() }).parse(req.body);
    await prisma.order.update({ where: { id }, data: { notes: body.notes } });
    await audit(viewer.id, 'order.notes', 'Order', id, null, req.ip);
    return { ok: true };
  });
}

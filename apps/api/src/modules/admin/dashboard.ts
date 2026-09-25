import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { PermissionKey } from '../../lib/permissions.js';

/**
 * The admin dashboard (§10).
 *
 * One request, because a dashboard that fires fifteen is a dashboard that
 * loads in pieces. Every figure here is a count or a sum the database can
 * do itself; nothing is computed by walking rows in Node.
 *
 * Money is reported per currency and never added across them. There is no
 * exchange rate in this repository and this is exactly the sort of screen
 * that would quietly introduce one (§4).
 */

const OPEN_STATUSES = [
  'PENDING',
  'AWAITING_RECIPIENT_CONTACT',
  'RECIPIENT_CONTACTED',
  'AWAITING_ADDRESS',
  'READY_FOR_PROCESSING',
  'PROCESSING'
] as const;

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    /* The dashboard shows whatever the viewer may see — but "whatever" can
       be nothing, and a reader with an account is not staff. One staff
       permission is the price of admission; which blocks appear is decided
       below, per permission. */
    const viewer = req.requirePermission(
      'book.read', 'order.read', 'gift.read', 'article.read',
      'user.read', 'media.read', 'theme.read', 'settings.write', 'audit.read'
    );
    const can = (k: PermissionKey) => req.can(k);
    const q = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const since = new Date(Date.now() - q.days * 86_400_000);

    /* Each block is skipped outright when the viewer may not see it, rather
       than fetched and hidden by the browser (§31). A content editor's
       dashboard never has the revenue figures in the response at all. */
    const wantsCatalog = can('book.read');
    const wantsOrders = can('order.read') || can('gift.read');
    const wantsPeople = can('user.read');
    const wantsJournal = can('article.read');

    const [
      books, drafts, lowStock,
      orderCounts, revenue, openOrders, giftsAwaiting,
      users, newUsers,
      articles, scheduled,
      recent
    ] = await Promise.all([
      wantsCatalog ? prisma.book.count() : null,
      wantsCatalog ? prisma.book.count({ where: { status: 'DRAFT' } }) : null,
      wantsCatalog ? prisma.inventory.count({ where: { onHand: { lte: 3 } } }) : null,

      wantsOrders
        ? prisma.order.groupBy({ by: ['status'], _count: { _all: true } })
        : null,
      /* Grouped by currency so the two never meet in one total. */
      wantsOrders
        ? prisma.order.groupBy({
            by: ['currency'],
            where: { createdAt: { gte: since }, status: { notIn: ['CANCELLED'] } },
            _sum: { total: true },
            _count: { _all: true }
          })
        : null,
      wantsOrders ? prisma.order.count({ where: { status: { in: [...OPEN_STATUSES] } } }) : null,
      can('gift.read')
        ? prisma.order.count({
            where: { type: 'GIFT', status: { in: ['AWAITING_RECIPIENT_CONTACT', 'AWAITING_ADDRESS'] } }
          })
        : null,

      wantsPeople ? prisma.user.count({ where: { status: 'ACTIVE' } }) : null,
      wantsPeople ? prisma.user.count({ where: { createdAt: { gte: since } } }) : null,

      wantsJournal ? prisma.article.count({ where: { deletedAt: null } }) : null,
      wantsJournal
        ? prisma.article.count({ where: { deletedAt: null, scheduledFor: { gt: new Date() } } })
        : null,

      can('audit.read')
        ? prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 12,
            include: { actor: { select: { id: true, email: true, profile: { select: { nickname: true } } } } }
          })
        : null
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of orderCounts ?? []) byStatus[row.status] = row._count._all;

    return {
      viewer: { id: viewer.id, permissions: [...viewer.permissions] },
      windowDays: q.days,
      catalog: wantsCatalog ? { books, drafts, lowStock } : null,
      orders: wantsOrders
        ? {
            open: openOrders,
            giftsAwaiting,
            byStatus,
            /* [{ currency: 'EUR', totalMinor, count }] — never summed together. */
            revenue: (revenue ?? []).map((r) => ({
              currency: r.currency,
              totalMinor: r._sum.total ?? 0,
              count: r._count._all
            }))
          }
        : null,
      people: wantsPeople ? { active: users, joined: newUsers } : null,
      journal: wantsJournal ? { articles, scheduled } : null,
      recent: (recent ?? []).map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        at: r.createdAt,
        /* A staff display name, or the email's local part — never a full
           address on a screen that may be shown to a room. */
        actor: r.actor
          ? r.actor.profile?.nickname ?? r.actor.email.split('@')[0]
          : null
      }))
    };
  });
}

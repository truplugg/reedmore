import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

/**
 * Site settings and the audit log (§11, §25).
 *
 * Every money figure here is entered twice, once per currency, for the same
 * reason as a book's price: there is no exchange rate in this repository and
 * a settings screen is where one would sneak in (§4).
 */

const minor = z.number().int().min(0).max(100_000_00);

const settingsBody = z.object({
  siteName: z.string().min(1).max(120).optional(),
  defaultLocale: z.enum(['UK', 'DE', 'EN']).optional(),
  defaultCurrency: z.enum(['EUR', 'UAH']).optional(),
  freeShippingEurCents: minor.optional(),
  freeShippingUahCents: minor.optional(),
  shippingFlatEurCents: minor.optional(),
  shippingFlatUahCents: minor.optional(),
  contactEmail: z.string().email().max(200).nullish(),
  activeThemeId: z.string().nullish()
});

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    req.requirePermission('settings.write');
    const s = await prisma.siteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    return { settings: s };
  });

  app.patch('/', async (req) => {
    const viewer = req.requirePermission('settings.write');
    const body = settingsBody.parse(req.body);

    if (body.activeThemeId) {
      const theme = await prisma.theme.findUnique({
        where: { id: body.activeThemeId },
        select: { id: true, publishedVersionId: true }
      });
      if (!theme) throw badRequest('unknown_theme', 'No such theme.');
      /* A theme nobody has published has no version to serve, and switching
         to it would leave the shop unstyled. */
      if (!theme.publishedVersionId) {
        throw badRequest('theme_unpublished', 'Publish that theme before the shop can wear it.');
      }
    }

    const before = await prisma.siteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const after = await prisma.siteSettings.update({ where: { id: 1 }, data: body });

    const changed = Object.keys(body).filter(
      (k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]
    );
    if (changed.length) await audit(viewer.id, 'settings.update', 'settings', '1', { changed }, req.ip);
    return { settings: after };
  });

  app.get('/audit', async (req) => {
    req.requirePermission('audit.read');
    const q = z.object({
      entity: z.string().max(40).optional(),
      entityId: z.string().max(60).optional(),
      action: z.string().max(60).optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(req.query);

    const where = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {})
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage, take: q.perPage,
        include: { actor: { select: { id: true, email: true, profile: { select: { nickname: true } } } } }
      }),
      prisma.auditLog.count({ where })
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id, action: r.action, entity: r.entity, entityId: r.entityId,
        meta: r.meta, at: r.createdAt,
        /* The actor's own email is shown here, because the audit log is for
           the owner and knowing who did it is the point. Nothing about a
           customer is in this table. */
        actor: r.actor ? { id: r.actor.id, name: r.actor.profile?.nickname ?? null, email: r.actor.email } : null
      })),
      total, page: q.page, perPage: q.perPage
    };
  });
}

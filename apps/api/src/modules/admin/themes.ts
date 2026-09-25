import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound, badRequest, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { TOKEN_SLOTS } from '../../lib/theme-tokens.js';
import { slugify } from '../../lib/slug.js';

/**
 * Themes (§5, §6, §34).
 *
 * A theme is structured data and nothing else: a fixed set of named colour
 * slots plus a handful of decorative choices from closed lists. No CSS text,
 * no markup, no URLs. The server compiles the tokens into a :root block, so
 * anything that got in here would reach every page — which is precisely why
 * the schema below refuses everything it does not recognise.
 *
 * Editing never touches what readers see. A draft is a new version row; the
 * live site is whatever `publishedVersionId` points at. Publishing moves that
 * pointer, and rolling back moves it to an older row that was never deleted.
 */

/**
 * A colour slot holds one of exactly two shapes, and nothing else can be
 * spelled in either of them:
 *
 *   #rrggbb     an opaque colour
 *   #rrggbbaa   one that is already translucent, such as a tinted surface
 *   "18 34 56"  red green blue as bare channels, for the slots the stylesheet
 *               composes an alpha onto — rgb(var(--overlay) / 0.5). A hex
 *               cannot be used there, which is why the third form exists.
 *
 * That is the whole vocabulary, checked against every theme the shop ships.
 * None of the three can carry a function call, a url() or a second
 * declaration, so a theme cannot become a way to write CSS into every
 * page (§34).
 */
const hex = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const channels = z.string()
  .regex(/^\d{1,3} \d{1,3} \d{1,3}$/)
  .refine((v) => v.split(' ').every((n) => Number(n) <= 255), 'Channels run 0 to 255.');
const colour = z.union([hex, channels]);

const tokens = z.object({
  colorScheme: z.enum(['light', 'dark']),
  colors: z.record(z.string(), colour),
  decor: z.object({
    ornamentMotif: z.enum(['star', 'rhomb', 'cross', 'zig']),
    ornamentOpacity: z.number().min(0).max(1),
    grain: z.number().min(0).max(1),
    heroFigure: z.enum(['none', 'leaves', 'blossom', 'sun', 'snow']),
    bandTrim: z.enum(['zig', 'rhomb', 'none'])
  })
}).strict();

/** A theme missing a slot renders an unstyled page, so a draft may be saved
 *  half-filled but may never be published that way. */
function missingSlots(t: z.infer<typeof tokens>): string[] {
  return TOKEN_SLOTS.filter((slot) => !t.colors[slot]);
}

function themeView(t: {
  id: string; key: string; name: string; description: string | null;
  season: string; system: boolean; publishedVersionId: string | null;
  updatedAt: Date;
  versions?: { id: string; version: number; label: string | null; createdAt: Date; tokens: unknown }[];
}) {
  const published = t.versions?.find((v) => v.id === t.publishedVersionId);
  const latest = t.versions?.[0];
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    season: t.season,
    system: t.system,
    updatedAt: t.updatedAt,
    publishedVersion: published ? { id: published.id, version: published.version, label: published.label } : null,
    /* A draft exists when the newest version is not the published one. */
    hasDraft: !!latest && latest.id !== t.publishedVersionId,
    versions: (t.versions ?? []).map((v) => ({
      id: v.id, version: v.version, label: v.label, createdAt: v.createdAt,
      isPublished: v.id === t.publishedVersionId
    }))
  };
}

const VERSION_SELECT = {
  id: true, version: true, label: true, createdAt: true, tokens: true
} as const;

export default async function themeRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    req.requirePermission('theme.read');
    const rows = await prisma.theme.findMany({
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      include: { versions: { select: VERSION_SELECT, orderBy: { version: 'desc' } } }
    });
    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 }, select: { activeThemeId: true } });
    return { items: rows.map(themeView), activeThemeId: settings?.activeThemeId ?? null };
  });

  /** The live tokens plus the newest draft, which is what an editor opens. */
  app.get('/:id', async (req) => {
    req.requirePermission('theme.read');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const theme = await prisma.theme.findUnique({
      where: { id },
      include: { versions: { select: VERSION_SELECT, orderBy: { version: 'desc' } } }
    });
    if (!theme) throw notFound('No such theme.');
    const latest = theme.versions[0] ?? null;
    const published = theme.versions.find((v) => v.id === theme.publishedVersionId) ?? null;
    return {
      theme: themeView(theme),
      /* What the editor edits: the newest row, draft or published alike. */
      draft: latest ? latest.tokens : null,
      live: published ? published.tokens : null,
      slots: TOKEN_SLOTS
    };
  });

  app.post('/', async (req, reply) => {
    const viewer = req.requirePermission('theme.write');
    const body = z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(400).nullish(),
      season: z.enum(['NONE', 'SPRING', 'SUMMER', 'AUTUMN', 'WINTER']).default('NONE'),
      /** Start from an existing theme rather than from an empty page. */
      basedOn: z.string().min(1).optional(),
      tokens: tokens.optional()
    }).parse(req.body);

    const key = slugify(body.name);
    if (await prisma.theme.findUnique({ where: { key }, select: { id: true } })) {
      throw conflict('key_taken', 'A theme with that name already exists.');
    }

    let seed = body.tokens ?? null;
    if (!seed && body.basedOn) {
      const from = await prisma.theme.findUnique({
        where: { id: body.basedOn },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { tokens: true } } }
      });
      if (!from) throw notFound('No theme to copy from.');
      seed = from.versions[0]?.tokens as never;
    }
    if (!seed) throw badRequest('no_tokens', 'A new theme needs either tokens or a theme to copy.');
    const parsed = tokens.parse(seed);

    const theme = await prisma.theme.create({
      data: {
        key, name: body.name, description: body.description ?? null,
        season: body.season, system: false,
        versions: { create: { version: 1, label: 'Draft', tokens: parsed as never, createdById: viewer.id } }
      },
      include: { versions: { select: VERSION_SELECT, orderBy: { version: 'desc' } } }
    });

    await audit(viewer.id, 'theme.create', 'theme', theme.id, { key }, req.ip);
    reply.code(201);
    return { theme: themeView(theme) };
  });

  /** Saving writes a new version. Nothing an editor does is destructive. */
  app.post('/:id/draft', async (req) => {
    const viewer = req.requirePermission('theme.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ tokens, label: z.string().max(80).nullish() }).parse(req.body);

    const theme = await prisma.theme.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } } }
    });
    if (!theme) throw notFound('No such theme.');

    const head = theme.versions[0];
    /* Overwrite the head only while it is still a draft; a published version
       is a record of what readers were served and is never edited in place. */
    const editable = head && head.id !== theme.publishedVersionId;

    const version = editable
      ? await prisma.themeVersion.update({
          where: { id: head.id },
          data: { tokens: body.tokens as never, label: body.label ?? 'Draft' },
          select: VERSION_SELECT
        })
      : await prisma.themeVersion.create({
          data: {
            themeId: id, version: (head?.version ?? 0) + 1,
            label: body.label ?? 'Draft', tokens: body.tokens as never, createdById: viewer.id
          },
          select: VERSION_SELECT
        });

    await prisma.theme.update({ where: { id }, data: { updatedAt: new Date() } });
    await audit(viewer.id, 'theme.draft', 'theme', id, { version: version.version }, req.ip);
    return { version: { id: version.id, version: version.version, label: version.label },
             missing: missingSlots(body.tokens) };
  });

  app.post('/:id/publish', async (req) => {
    const viewer = req.requirePermission('theme.publish');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      /** Omitted: publish the newest version. Given: roll back to that one. */
      versionId: z.string().min(1).optional(),
      /** Also make this the theme the shop is served in. */
      activate: z.boolean().default(false)
    }).parse(req.body ?? {});

    const theme = await prisma.theme.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } }
    });
    if (!theme) throw notFound('No such theme.');

    const target = body.versionId
      ? theme.versions.find((v) => v.id === body.versionId)
      : theme.versions[0];
    if (!target) throw notFound('No such version of this theme.');

    /* A half-filled theme renders an unstyled page. It may be saved; it may
       not be served. */
    const gaps = missingSlots(tokens.parse(target.tokens));
    if (gaps.length) {
      throw badRequest('incomplete_theme',
        `This theme has no colour for ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? ` and ${gaps.length - 5} more` : ''}.`);
    }

    await prisma.theme.update({ where: { id }, data: { publishedVersionId: target.id } });
    if (body.activate) {
      await prisma.siteSettings.upsert({
        where: { id: 1 }, update: { activeThemeId: id }, create: { id: 1, activeThemeId: id }
      });
    }

    await audit(viewer.id, body.versionId ? 'theme.rollback' : 'theme.publish', 'theme', id,
      { version: target.version, activated: body.activate }, req.ip);

    const after = await prisma.theme.findUnique({
      where: { id }, include: { versions: { select: VERSION_SELECT, orderBy: { version: 'desc' } } }
    });
    return { theme: themeView(after!) };
  });

  app.delete('/:id', async (req, reply) => {
    const viewer = req.requirePermission('theme.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const theme = await prisma.theme.findUnique({ where: { id }, select: { id: true, key: true, system: true } });
    if (!theme) throw notFound('No such theme.');
    if (theme.system) throw badRequest('system_theme', 'The themes the shop ships with cannot be deleted.');

    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 }, select: { activeThemeId: true } });
    if (settings?.activeThemeId === id) {
      throw badRequest('theme_in_use', 'This is the theme the shop is wearing. Switch to another one first.');
    }

    await prisma.theme.delete({ where: { id } });
    await audit(viewer.id, 'theme.delete', 'theme', id, { key: theme.key }, req.ip);
    reply.code(204);
  });
}

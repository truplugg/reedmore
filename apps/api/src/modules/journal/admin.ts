import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound, conflict, badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { slugify } from '../../lib/slug.js';
import { documentSchema, readingMinutes } from './blocks.js';

/**
 * The journal, staff side (§13).
 *
 * Articles carry three languages like everything else, and like everything
 * else the translations are entered, never generated. An article with no
 * German body is served its Ukrainian one rather than a machine's guess.
 */

const ARTICLE_INCLUDE = {
  author: { select: { id: true, profile: { select: { nickname: true } } } },
  category: true,
  coverMedia: true,
  tags: { include: { tag: true } }
} satisfies Prisma.ArticleInclude;

type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof ARTICLE_INCLUDE }>;

function staffArticle(a: ArticleRow) {
  return {
    id: a.id,
    slug: a.slug,
    status: a.status,
    title: a.title, titleEn: a.titleEn, titleDe: a.titleDe,
    excerpt: a.excerpt, excerptEn: a.excerptEn, excerptDe: a.excerptDe,
    content: a.content, contentEn: a.contentEn, contentDe: a.contentDe,
    cover: a.coverMedia ? { id: a.coverMedia.id, url: a.coverMedia.url, alt: a.coverMedia.alt } : null,
    category: a.category
      ? { id: a.category.id, slug: a.category.slug,
          nameUk: a.category.nameUk, nameEn: a.category.nameEn, nameDe: a.category.nameDe }
      : null,
    tags: a.tags.map((t) => ({ id: t.tag.id, slug: t.tag.slug, label: t.tag.label })),
    author: a.author ? { id: a.author.id, name: a.author.profile?.nickname ?? null } : null,
    seoTitle: a.seoTitle, seoDescription: a.seoDescription,
    readingMinutes: a.readingMinutes,
    publishedAt: a.publishedAt, scheduledFor: a.scheduledFor,
    createdAt: a.createdAt, updatedAt: a.updatedAt
  };
}

const articleBody = z.object({
  slug: z.string().min(1).max(200).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
  title: z.string().min(1).max(300),
  titleEn: z.string().max(300).nullish(),
  titleDe: z.string().max(300).nullish(),
  excerpt: z.string().max(400).nullish(),
  excerptEn: z.string().max(400).nullish(),
  excerptDe: z.string().max(400).nullish(),
  content: documentSchema,
  contentEn: documentSchema.nullish(),
  contentDe: documentSchema.nullish(),
  coverMediaId: z.string().nullish(),
  categoryId: z.string().nullish(),
  tagIds: z.array(z.string()).max(20).optional(),
  seoTitle: z.string().max(200).nullish(),
  seoDescription: z.string().max(320).nullish(),
  scheduledFor: z.coerce.date().nullish()
});

export default async function adminJournalRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    req.requirePermission('article.read');
    const q = z.object({
      search: z.string().max(120).optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(req.query);

    const where: Prisma.ArticleWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [
            { title: { contains: q.search, mode: 'insensitive' } },
            { titleEn: { contains: q.search, mode: 'insensitive' } },
            { titleDe: { contains: q.search, mode: 'insensitive' } },
            { slug: { contains: q.search, mode: 'insensitive' } }
          ] }
        : {})
    };

    const [rows, total] = await Promise.all([
      prisma.article.findMany({
        where, include: ARTICLE_INCLUDE, orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.perPage, take: q.perPage
      }),
      prisma.article.count({ where })
    ]);
    return { items: rows.map(staffArticle), total, page: q.page, perPage: q.perPage };
  });

  app.get('/:id', async (req) => {
    req.requirePermission('article.read');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const a = await prisma.article.findFirst({ where: { id, deletedAt: null }, include: ARTICLE_INCLUDE });
    if (!a) throw notFound('No such article.');
    return { article: staffArticle(a) };
  });

  app.post('/', async (req, reply) => {
    const viewer = req.requirePermission('article.write');
    const body = articleBody.parse(req.body);
    if (body.status === 'PUBLISHED') req.requirePermission('article.publish');

    const slug = slugify(body.slug || body.title);
    if (await prisma.article.findUnique({ where: { slug }, select: { id: true } })) {
      throw conflict('slug_taken', 'An article with that address already exists.');
    }

    const a = await prisma.article.create({
      data: {
        slug,
        authorId: viewer.id,
        status: body.status ?? 'DRAFT',
        title: body.title,
        titleEn: body.titleEn ?? null,
        titleDe: body.titleDe ?? null,
        excerpt: body.excerpt ?? null,
        excerptEn: body.excerptEn ?? null,
        excerptDe: body.excerptDe ?? null,
        content: body.content as never,
        contentEn: (body.contentEn ?? null) as never,
        contentDe: (body.contentDe ?? null) as never,
        readingMinutes: readingMinutes(body.content),
        coverMediaId: body.coverMediaId ?? null,
        categoryId: body.categoryId ?? null,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        scheduledFor: body.scheduledFor ?? null,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        ...(body.tagIds?.length
          ? { tags: { create: body.tagIds.map((tagId) => ({ tagId })) } }
          : {})
      },
      include: ARTICLE_INCLUDE
    });

    await audit(viewer.id, 'article.create', 'article', a.id, { slug }, req.ip);
    reply.code(201);
    return { article: staffArticle(a) };
  });

  app.patch('/:id', async (req) => {
    const viewer = req.requirePermission('article.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = articleBody.partial({ title: true, content: true }).parse(req.body);

    const before = await prisma.article.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('No such article.');
    if (body.status && body.status !== before.status) req.requirePermission('article.publish');

    const data: Prisma.ArticleUncheckedUpdateInput = scalars(body);
    if (body.slug) {
      const slug = slugify(body.slug);
      const clash = await prisma.article.findUnique({ where: { slug }, select: { id: true } });
      if (clash && clash.id !== id) throw conflict('slug_taken', 'That address is taken.');
      data.slug = slug;
    }
    /* Published once, dated once: re-publishing an article does not pretend
       it is new. */
    if (body.status === 'PUBLISHED' && !before.publishedAt) data.publishedAt = new Date();

    if (body.tagIds) {
      await prisma.articleTagOnArticle.deleteMany({ where: { articleId: id } });
      if (body.tagIds.length) {
        await prisma.articleTagOnArticle.createMany({
          data: body.tagIds.map((tagId) => ({ articleId: id, tagId }))
        });
      }
    }

    const a = await prisma.article.update({ where: { id }, data, include: ARTICLE_INCLUDE });
    await audit(viewer.id, 'article.update', 'article', id, { fields: Object.keys(body) }, req.ip);
    return { article: staffArticle(a) };
  });

  app.post('/:id/status', async (req) => {
    const viewer = req.requirePermission('article.publish');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { status, scheduledFor } = z.object({
      status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']),
      scheduledFor: z.coerce.date().nullish()
    }).parse(req.body);

    const before = await prisma.article.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('No such article.');
    if (scheduledFor && scheduledFor.getTime() < Date.now()) {
      throw badRequest('past_schedule', 'A scheduled time has to be in the future.');
    }

    const a = await prisma.article.update({
      where: { id },
      data: {
        status,
        scheduledFor: scheduledFor ?? null,
        publishedAt: status === 'PUBLISHED' && !before.publishedAt ? new Date() : before.publishedAt
      },
      include: ARTICLE_INCLUDE
    });
    await audit(viewer.id, 'article.status', 'article', id, { from: before.status, to: status }, req.ip);
    return { article: staffArticle(a) };
  });

  app.delete('/:id', async (req, reply) => {
    const viewer = req.requirePermission('article.delete');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const a = await prisma.article.findFirst({ where: { id, deletedAt: null }, select: { id: true, slug: true } });
    if (!a) throw notFound('No such article.');
    /* Soft, like books: a published address that starts 404ing is a broken
       link on somebody else's site. */
    await prisma.article.update({ where: { id }, data: { deletedAt: new Date(), status: 'HIDDEN' } });
    await audit(viewer.id, 'article.delete', 'article', id, { slug: a.slug }, req.ip);
    reply.code(204);
  });

  app.get('/meta/taxonomy', async (req) => {
    req.requirePermission('article.read');
    const [categories, tags] = await Promise.all([
      prisma.articleCategory.findMany({ orderBy: { nameUk: 'asc' } }),
      prisma.articleTag.findMany({ orderBy: { label: 'asc' } })
    ]);
    return { categories, tags };
  });
}

/** Fields an edit maps straight through, with undefined meaning "leave alone".
 *  Creating spells its fields out instead, because create has required ones
 *  and a shared builder can only promise them with a cast. */
function scalars(b: Partial<z.infer<typeof articleBody>>): Prisma.ArticleUncheckedUpdateInput {
  const d: Prisma.ArticleUncheckedUpdateInput = {};
  const copy = [
    'status', 'title', 'titleEn', 'titleDe', 'excerpt', 'excerptEn', 'excerptDe',
    'coverMediaId', 'categoryId', 'seoTitle', 'seoDescription', 'scheduledFor'
  ] as const;
  for (const k of copy) if (k in b) (d as Record<string, unknown>)[k] = b[k] ?? null;
  if (b.content) { d.content = b.content as never; d.readingMinutes = readingMinutes(b.content); }
  if ('contentEn' in b) d.contentEn = (b.contentEn ?? null) as never;
  if ('contentDe' in b) d.contentDe = (b.contentDe ?? null) as never;
  return d;
}

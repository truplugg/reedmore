import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { BOOK_INCLUDE, adminBook } from './view.js';
import { slugify } from '../../lib/slug.js';
import { bookSearchClauses, isbnDigitsOf } from '../../lib/search.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour.');
const minor = z.number().int().min(0).max(100_000_00);

/** Everything the admin form can set. The 3D model is a template the admin
 *  never edits directly (§12) — it takes covers and a few material choices. */
const bookBody = z.object({
  slug: z.string().min(1).max(200).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
  featured: z.boolean().optional(),

  title: z.string().min(1).max(300),
  titleEn: z.string().max(300).nullish(),
  titleDe: z.string().max(300).nullish(),
  author: z.string().min(1).max(200),
  authorEn: z.string().max(200).nullish(),
  publisher: z.string().max(200).nullish(),
  year: z.number().int().min(1400).max(2200).nullish(),
  isbn: z.string().max(32).nullish(),
  language: z.string().max(12).nullish(),
  pages: z.number().int().min(1).max(20000).nullish(),
  binding: z.enum(['HARD', 'SOFT']).optional(),
  sizeLabel: z.string().max(60).nullish(),
  paperLabel: z.string().max(80).nullish(),
  weightGrams: z.number().int().min(1).max(20000).nullish(),

  blurb: z.string().max(600).nullish(),
  blurbEn: z.string().max(600).nullish(),
  blurbDe: z.string().max(600).nullish(),
  about: z.string().max(4000).nullish(),
  aboutEn: z.string().max(4000).nullish(),
  aboutDe: z.string().max(4000).nullish(),

  // Both, always, entered by hand. Nothing here converts. (§4)
  priceEurCents: minor,
  priceUahCents: minor,
  salePriceEurCents: minor.nullish(),
  salePriceUahCents: minor.nullish(),

  frontCoverMediaId: z.string().nullish(),
  backCoverMediaId: z.string().nullish(),
  coverStyle: z.string().max(24).nullish(),
  coverMotif: z.string().max(24).nullish(),
  endpaper: z.string().max(24).nullish(),
  paperColor: hex.nullish(),
  inkColor: hex.nullish(),
  accentColor: hex.nullish(),
  spineColor: hex.nullish(),
  depthMm: z.number().int().min(4).max(90).nullish(),

  categoryId: z.string().nullish(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  stockOnHand: z.number().int().min(0).max(100000).optional(),

  seoTitle: z.string().max(200).nullish(),
  seoDescription: z.string().max(320).nullish()
}).refine((b) => b.salePriceEurCents == null || b.salePriceEurCents < b.priceEurCents,
  { path: ['salePriceEurCents'], message: 'A sale price must be below the list price.' })
  .refine((b) => b.salePriceUahCents == null || b.salePriceUahCents < b.priceUahCents,
  { path: ['salePriceUahCents'], message: 'A sale price must be below the list price.' });

async function syncTags(bookId: string, labels: string[]) {
  const wanted = new Map(labels.map((l) => [slugify(l), l]));
  await prisma.bookTagOnBook.deleteMany({ where: { bookId, tag: { slug: { notIn: [...wanted.keys()] } } } });
  for (const [slug, label] of wanted) {
    const tag = await prisma.bookTag.upsert({ where: { slug }, update: { label }, create: { slug, label } });
    await prisma.bookTagOnBook.upsert({
      where: { bookId_tagId: { bookId, tagId: tag.id } }, update: {}, create: { bookId, tagId: tag.id }
    });
  }
}

function toData(b: z.infer<typeof bookBody>): Prisma.BookUncheckedUpdateInput {
  const { tags, stockOnHand, slug, ...rest } = b;
  void tags; void stockOnHand; void slug;
  const data = rest as Prisma.BookUncheckedUpdateInput;
  /* isbnDigits is derived, so it has to follow the same rule as the field it
     derives from: an omitted isbn means "leave it alone", not "clear it".
     Setting it unconditionally silently emptied the column on every partial
     update, and ISBN search stopped finding the book. */
  if ('isbn' in b) data.isbnDigits = isbnDigitsOf(b.isbn);
  return data;
}

export default async function adminBookRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    req.requirePermission('book.read');
    const q = z.object({
      search: z.string().max(120).optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
      categoryId: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(req.query);

    const where: Prisma.BookWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search ? { OR: bookSearchClauses(q.search) } : {})
    };

    const [rows, total] = await Promise.all([
      prisma.book.findMany({ where, include: BOOK_INCLUDE, orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.book.count({ where })
    ]);
    return { items: rows.map(adminBook), total, page: q.page, perPage: q.perPage };
  });

  app.get('/:id', async (req) => {
    req.requirePermission('book.read');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const book = await prisma.book.findUnique({ where: { id }, include: BOOK_INCLUDE });
    if (!book) throw notFound('No such book.');
    return { book: adminBook(book) };
  });

  app.post('/', async (req, reply) => {
    const viewer = req.requirePermission('book.write');
    const body = bookBody.parse(req.body);

    if (body.status === 'PUBLISHED') req.requirePermission('book.publish');

    const slug = slugify(body.slug || body.title);
    if (await prisma.book.findUnique({ where: { slug }, select: { id: true } })) {
      throw conflict('slug_taken', 'A book with that address already exists.');
    }

    const book = await prisma.book.create({
      data: {
        ...(toData(body) as Prisma.BookUncheckedCreateInput),
        slug,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        inventory: { create: { onHand: body.stockOnHand ?? 0 } }
      }
    });
    if (body.tags?.length) await syncTags(book.id, body.tags);

    await audit(viewer.id, 'book.create', 'Book', book.id, { slug, status: book.status }, req.ip);
    const full = await prisma.book.findUniqueOrThrow({ where: { id: book.id }, include: BOOK_INCLUDE });
    reply.code(201);
    return { book: adminBook(full) };
  });

  app.patch('/:id', async (req) => {
    const viewer = req.requirePermission('book.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = bookBody.parse(req.body);

    const before = await prisma.book.findUnique({ where: { id }, select: { status: true, slug: true } });
    if (!before) throw notFound('No such book.');
    if (body.status && body.status !== before.status) req.requirePermission('book.publish');

    const slug = body.slug ? slugify(body.slug) : before.slug;
    if (slug !== before.slug) {
      const clash = await prisma.book.findUnique({ where: { slug }, select: { id: true } });
      if (clash && clash.id !== id) throw conflict('slug_taken', 'A book with that address already exists.');
    }

    const becomingPublic = body.status === 'PUBLISHED' && before.status !== 'PUBLISHED';
    await prisma.book.update({
      data: { ...toData(body), slug, ...(becomingPublic ? { publishedAt: new Date() } : {}) },
      where: { id }
    });
    if (body.tags) await syncTags(id, body.tags);
    if (body.stockOnHand != null) {
      await prisma.inventory.upsert({
        where: { bookId: id }, update: { onHand: body.stockOnHand }, create: { bookId: id, onHand: body.stockOnHand }
      });
    }

    await audit(viewer.id, 'book.update', 'Book', id, { slug, status: body.status }, req.ip);
    const full = await prisma.book.findUniqueOrThrow({ where: { id }, include: BOOK_INCLUDE });
    return { book: adminBook(full) };
  });

  app.post('/:id/status', async (req) => {
    const viewer = req.requirePermission('book.publish');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { status } = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']) }).parse(req.body);

    const book = await prisma.book.update({
      where: { id },
      data: { status, ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
      include: BOOK_INCLUDE
    });
    await audit(viewer.id, 'book.status', 'Book', id, { status }, req.ip);
    return { book: adminBook(book) };
  });

  app.delete('/:id', async (req, reply) => {
    const viewer = req.requirePermission('book.delete');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    // A book that has been bought is part of the record. Hide it instead;
    // the order items keep their own snapshot of the title either way.
    const sold = await prisma.orderItem.count({ where: { bookId: id } });
    if (sold > 0) {
      await prisma.book.update({ where: { id }, data: { status: 'HIDDEN' } });
      await audit(viewer.id, 'book.hide_instead_of_delete', 'Book', id, { sold }, req.ip);
      throw badRequest('book_has_orders', `That book appears in ${sold} order${sold === 1 ? '' : 's'}, so it was hidden rather than deleted.`);
    }

    await prisma.book.delete({ where: { id } });
    await audit(viewer.id, 'book.delete', 'Book', id, null, req.ip);
    reply.code(204);
  });

  app.get('/meta/categories', async (req) => {
    req.requirePermission('book.read');
    const categories = await prisma.bookCategory.findMany({ orderBy: { position: 'asc' } });
    return { categories };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Currency, Locale, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { localeFromAcceptLanguage, currencyForLocale, isLocale, isCurrency } from '../../lib/locale.js';
import { BOOK_INCLUDE, shopBook } from './view.js';
import { bookSearchClauses } from '../../lib/search.js';

/**
 * Locale and currency for a request, in order of authority: what the query
 * asks for, then what the signed-in account saved, then the browser's own
 * Accept-Language (§3). The user's choice always wins and is what the client
 * stores (§4).
 */
export function readContext(req: FastifyRequest): { locale: Locale; currency: Currency } {
  const q = req.query as Record<string, unknown>;
  const locale = isLocale(q.locale) ? q.locale
    : req.viewer?.locale ?? localeFromAcceptLanguage(req.headers['accept-language']);
  const currency = isCurrency(q.currency) ? q.currency
    : req.viewer?.currency ?? currencyForLocale(locale);
  return { locale, currency };
}

const SORTS = ['pop', 'new', 'priceUp', 'priceDown', 'title'] as const;


export default async function publicBookRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { locale, currency } = readContext(req);
    const q = z.object({
      search: z.string().max(120).optional(),
      category: z.string().max(60).optional(),
      binding: z.enum(['HARD', 'SOFT']).optional(),
      tag: z.string().max(60).optional(),
      featured: z.coerce.boolean().optional(),
      slugs: z.string().max(2000).optional(),
      sort: z.enum(SORTS).default('pop'),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(60).default(12)
    }).parse(req.query);

    // A published book is the only kind the shop can see, at every entry point.
    const where: Prisma.BookWhereInput = {
      status: 'PUBLISHED',
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.binding ? { binding: q.binding } : {}),
      ...(q.featured ? { featured: true } : {}),
      ...(q.tag ? { tags: { some: { tag: { slug: q.tag } } } } : {}),
      ...(q.slugs ? { slug: { in: q.slugs.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60) } } : {}),
      ...(q.search ? { OR: bookSearchClauses(q.search) } : {})
    };

    const priceField = currency === 'EUR' ? 'priceEurCents' : 'priceUahCents';
    const orderBy: Prisma.BookOrderByWithRelationInput[] =
      q.sort === 'new' ? [{ publishedAt: 'desc' }, { year: 'desc' }]
      : q.sort === 'priceUp' ? [{ [priceField]: 'asc' } as never]
      : q.sort === 'priceDown' ? [{ [priceField]: 'desc' } as never]
      : q.sort === 'title' ? [{ title: 'asc' }]
      : [{ featured: 'desc' }, { publishedAt: 'desc' }];

    const [rows, total] = await Promise.all([
      prisma.book.findMany({ where, include: BOOK_INCLUDE, orderBy, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.book.count({ where })
    ]);

    return {
      items: rows.map((b) => shopBook(b, locale, currency)),
      total, page: q.page, perPage: q.perPage,
      pages: Math.max(1, Math.ceil(total / q.perPage)),
      locale, currency
    };
  });

  app.get('/facets', async (req) => {
    const { locale } = readContext(req);
    const [categories, bindings] = await Promise.all([
      prisma.bookCategory.findMany({
        orderBy: { position: 'asc' },
        include: { _count: { select: { books: { where: { status: 'PUBLISHED' } } } } }
      }),
      prisma.book.groupBy({ by: ['binding'], where: { status: 'PUBLISHED' }, _count: true })
    ]);

    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: locale === 'EN' ? c.nameEn : locale === 'DE' ? c.nameDe : c.nameUk,
        count: c._count.books
      })),
      bindings: bindings.map((b) => ({ id: b.binding, count: b._count }))
    };
  });

  app.get('/:slug', async (req) => {
    const { locale, currency } = readContext(req);
    const { slug } = z.object({ slug: z.string().min(1).max(200) }).parse(req.params);

    const book = await prisma.book.findFirst({
      where: { slug, status: 'PUBLISHED' }, include: BOOK_INCLUDE
    });
    if (!book) throw notFound('No such book.');

    const related = await prisma.book.findMany({
      where: {
        status: 'PUBLISHED', id: { not: book.id },
        ...(book.categoryId ? { categoryId: book.categoryId } : {})
      },
      include: BOOK_INCLUDE, orderBy: { featured: 'desc' }, take: 3
    });

    return {
      book: shopBook(book, locale, currency),
      related: related.map((b) => shopBook(b, locale, currency))
    };
  });
}

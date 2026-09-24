import type { Currency, Locale, Prisma } from '@prisma/client';
import { priceOf } from '../../lib/money.js';

/**
 * Two audiences, two shapes.
 *
 * The shop never sees draft fields, stock counts it has no business knowing,
 * or the other currency's price. Staff see everything. Keeping these as
 * separate functions — rather than one with a flag — is what stops a field
 * leaking into the public shape by accident (§33).
 */

export const BOOK_INCLUDE = {
  category: true,
  tags: { include: { tag: true } },
  inventory: true,
  frontCoverMedia: { select: { url: true, width: true, height: true, alt: true } },
  backCoverMedia: { select: { url: true, width: true, height: true, alt: true } }
} satisfies Prisma.BookInclude;

export type BookWithRelations = Prisma.BookGetPayload<{ include: typeof BOOK_INCLUDE }>;

function pickLocale<T>(locale: Locale, uk: T, en: T | null, de: T | null): T {
  if (locale === 'EN') return (en ?? uk);
  if (locale === 'DE') return (de ?? en ?? uk);
  return uk;
}

/** What the shop front renders. */
export function shopBook(b: BookWithRelations, locale: Locale, currency: Currency) {
  const { amount, was } = priceOf(b, currency);
  const onHand = b.inventory ? b.inventory.onHand - b.inventory.reserved : 0;

  return {
    id: b.slug,
    slug: b.slug,
    title: pickLocale(locale, b.title, b.titleEn, b.titleDe),
    author: pickLocale(locale, b.author, b.authorEn, null),
    publisher: b.publisher,
    year: b.year,
    isbn: b.isbn,
    pages: b.pages,
    binding: b.binding,
    sizeLabel: b.sizeLabel,
    paperLabel: b.paperLabel,
    language: b.language,
    blurb: pickLocale(locale, b.blurb, b.blurbEn, b.blurbDe),
    about: pickLocale(locale, b.about, b.aboutEn, b.aboutDe),

    currency,
    price: amount,
    listPrice: was,

    // Availability as a band, not a number: the exact count is the shop's
    // business, and "3 left" is all a reader needs.
    availability: onHand <= 0 ? 'out' : onHand <= 3 ? 'low' : 'in',
    lowStock: onHand > 0 && onHand <= 3 ? onHand : null,

    featured: b.featured,
    category: b.category ? { slug: b.category.slug, name: pickLocale(locale, b.category.nameUk, b.category.nameEn, b.category.nameDe) } : null,
    tags: b.tags.map((t) => t.tag.label),

    cover: {
      front: b.frontCoverMedia?.url ?? null,
      back: b.backCoverMedia?.url ?? null,
      style: b.coverStyle,
      motif: b.coverMotif,
      pal: { paper: b.paperColor, ink: b.inkColor, accent: b.accentColor },
      spine: b.spineColor
    },
    endpaper: b.endpaper,
    depthMm: b.depthMm,
    seo: { title: b.seoTitle, description: b.seoDescription }
  };
}

/** What the admin edits. Both prices, both drafts, the real stock. */
export function adminBook(b: BookWithRelations) {
  return {
    id: b.id,
    slug: b.slug,
    status: b.status,
    featured: b.featured,
    title: b.title, titleEn: b.titleEn, titleDe: b.titleDe,
    author: b.author, authorEn: b.authorEn,
    publisher: b.publisher, year: b.year, isbn: b.isbn, language: b.language,
    pages: b.pages, binding: b.binding,
    sizeLabel: b.sizeLabel, paperLabel: b.paperLabel, weightGrams: b.weightGrams,
    blurb: b.blurb, blurbEn: b.blurbEn, blurbDe: b.blurbDe,
    about: b.about, aboutEn: b.aboutEn, aboutDe: b.aboutDe,
    priceEurCents: b.priceEurCents, priceUahCents: b.priceUahCents,
    salePriceEurCents: b.salePriceEurCents, salePriceUahCents: b.salePriceUahCents,
    cover: {
      frontMediaId: b.frontCoverMediaId, front: b.frontCoverMedia?.url ?? null,
      backMediaId: b.backCoverMediaId, back: b.backCoverMedia?.url ?? null,
      style: b.coverStyle, motif: b.coverMotif,
      pal: { paper: b.paperColor, ink: b.inkColor, accent: b.accentColor },
      spine: b.spineColor
    },
    endpaper: b.endpaper,
    depthMm: b.depthMm,
    categoryId: b.categoryId,
    category: b.category ? { id: b.category.id, slug: b.category.slug, nameUk: b.category.nameUk } : null,
    tags: b.tags.map((t) => ({ id: t.tag.id, slug: t.tag.slug, label: t.tag.label })),
    stock: { onHand: b.inventory?.onHand ?? 0, reserved: b.inventory?.reserved ?? 0 },
    seoTitle: b.seoTitle, seoDescription: b.seoDescription,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    publishedAt: b.publishedAt?.toISOString() ?? null
  };
}

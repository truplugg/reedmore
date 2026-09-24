import type { Currency, Locale, Prisma } from '@prisma/client';
import { BOOK_INCLUDE, shopBook } from '../books/view.js';

export const WISHLIST_INCLUDE = {
  owner: { select: { id: true, profile: { select: { nickname: true, avatarUrl: true } } } },
  items: { include: { book: { include: BOOK_INCLUDE } }, orderBy: { position: 'asc' as const } }
} satisfies Prisma.WishlistInclude;

export type WishlistWithRelations = Prisma.WishlistGetPayload<{ include: typeof WISHLIST_INCLUDE }>;

/** Nickname and avatar. Nothing else about a person is ever public (§16, §18). */
function publicOwner(w: WishlistWithRelations) {
  return {
    nickname: w.owner.profile?.nickname ?? 'reader',
    avatarUrl: w.owner.profile?.avatarUrl ?? null
  };
}

/**
 * The owner's own view: every item, its state, and the share link.
 */
export function ownerWishlist(w: WishlistWithRelations, locale: Locale, currency: Currency) {
  return {
    id: w.id,
    title: w.title,
    visibility: w.visibility,
    shareToken: w.shareToken,
    itemCount: w.items.length,
    createdAt: w.createdAt.toISOString(),
    items: w.items.map((i) => ({
      id: i.id,
      note: i.note,
      status: i.status,
      /* The owner is told an item is spoken for, but not by whom and not
         when — a surprise is the whole point of the feature. */
      book: shopBook(i.book, locale, currency)
    }))
  };
}

/**
 * What anyone else sees. No owner id, no email, no address, no gift
 * bookkeeping — and reserved items are simply not offered again.
 */
export function visitorWishlist(w: WishlistWithRelations, locale: Locale, currency: Currency) {
  const available = w.items.filter((i) => i.status === 'AVAILABLE');
  return {
    id: w.id,
    title: w.title,
    owner: publicOwner(w),
    itemCount: w.items.length,
    availableCount: available.length,
    items: available.map((i) => ({
      id: i.id,
      note: i.note,
      book: shopBook(i.book, locale, currency)
    }))
  };
}

/** The card on the home page (§18): a face, a name, a few covers, a count. */
export function wishlistCard(w: WishlistWithRelations, locale: Locale, currency: Currency) {
  const available = w.items.filter((i) => i.status === 'AVAILABLE');
  return {
    id: w.id,
    title: w.title,
    owner: publicOwner(w),
    itemCount: w.items.length,
    availableCount: available.length,
    covers: available.slice(0, 4).map((i) => {
      const b = shopBook(i.book, locale, currency);
      return { slug: b.slug, title: b.title, author: b.author, cover: b.cover };
    })
  };
}

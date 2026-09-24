import type { Prisma } from '@prisma/client';

/**
 * Free-text search over a book.
 *
 * The ISBN clause is only added when the query actually contains an ISBN's
 * worth of digits. Two things go wrong otherwise: `contains: ''` is true of
 * every row, and a sentinel like `\u0000` is rejected outright by Postgres as
 * an invalid byte sequence. Leaving the clause out is the only correct answer.
 */
export function bookSearchClauses(search: string): Prisma.BookWhereInput[] {
  const text = search.trim();
  if (!text) return [];

  const clauses: Prisma.BookWhereInput[] = [
    { title: { contains: text, mode: 'insensitive' } },
    { titleEn: { contains: text, mode: 'insensitive' } },
    { titleDe: { contains: text, mode: 'insensitive' } },
    { author: { contains: text, mode: 'insensitive' } },
    { authorEn: { contains: text, mode: 'insensitive' } },
    { publisher: { contains: text, mode: 'insensitive' } },
    { slug: { contains: text, mode: 'insensitive' } }
  ];

  const digits = isbnDigitsOf(text);
  if (digits && digits.length >= 5) clauses.push({ isbnDigits: { contains: digits } });
  return clauses;
}

/** Digits only, so a search matches whatever hyphenation was typed in. */
export function isbnDigitsOf(isbn: string | null | undefined): string | null {
  const d = String(isbn ?? '').replace(/[^\dxX]/gi, '').toUpperCase();
  return d.length >= 5 ? d : null;
}

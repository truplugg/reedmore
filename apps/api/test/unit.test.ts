import { describe, it, expect } from 'vitest';
import { priceOf, formatMoney } from '../src/lib/money.js';
import { localeFromAcceptLanguage, currencyForLocale } from '../src/lib/locale.js';
import { slugify } from '../src/lib/slug.js';
import { bookSearchClauses, isbnDigitsOf } from '../src/lib/search.js';
import { ROLE_PERMISSIONS, ALL_PERMISSIONS } from '../src/lib/permissions.js';

describe('prices', () => {
  const book = { priceEurCents: 1200, priceUahCents: 58000, salePriceEurCents: 900, salePriceUahCents: null };

  it('reads the column for the currency, never a conversion', () => {
    expect(priceOf({ ...book, salePriceEurCents: null }, 'EUR').amount).toBe(1200);
    expect(priceOf({ ...book, salePriceEurCents: null }, 'UAH').amount).toBe(58000);
  });

  it('applies a sale price only in the currency it was set for', () => {
    expect(priceOf(book, 'EUR')).toEqual({ amount: 900, was: 1200 });
    expect(priceOf(book, 'UAH')).toEqual({ amount: 58000, was: null });
  });

  it('ignores a sale price that is not actually lower', () => {
    expect(priceOf({ ...book, salePriceEurCents: 1500 }, 'EUR')).toEqual({ amount: 1200, was: null });
  });

  it('formats each currency in its own convention', () => {
    expect(formatMoney(1250, 'EUR')).toContain('12,50');
    expect(formatMoney(58000, 'UAH')).toContain('580');
  });
});

describe('locale detection', () => {
  it('picks the supported language with the highest q', () => {
    expect(localeFromAcceptLanguage('pl,de;q=0.9,en;q=0.8')).toBe('DE');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('EN');
    expect(localeFromAcceptLanguage('uk-UA,uk;q=0.9,ru;q=0.8')).toBe('UK');
  });

  it('ignores the region subtag', () => {
    expect(localeFromAcceptLanguage('de-AT')).toBe('DE');
    expect(localeFromAcceptLanguage('de-CH,de;q=0.9')).toBe('DE');
  });

  it('falls back to English for anything unsupported', () => {
    expect(localeFromAcceptLanguage('ja,ko;q=0.9')).toBe('EN');
    expect(localeFromAcceptLanguage('')).toBe('EN');
    expect(localeFromAcceptLanguage(undefined)).toBe('EN');
  });

  it('skips a language listed at q=0', () => {
    expect(localeFromAcceptLanguage('de;q=0,uk;q=0.5')).toBe('UK');
  });

  it('suggests a first currency without forcing it', () => {
    expect(currencyForLocale('UK')).toBe('UAH');
    expect(currencyForLocale('DE')).toBe('EUR');
    expect(currencyForLocale('EN')).toBe('EUR');
  });
});

describe('slugs', () => {
  it('transliterates Ukrainian', () => {
    expect(slugify('Інтернат')).toBe('internat');
    expect(slugify('Записки українського самашедшого')).toBe('zapysky-ukrainskoho-samashedshoho');
  });
  it('handles German umlauts', () => {
    expect(slugify('Über den Büchern')).toBe('ueber-den-buechern');
  });
  it('never returns an empty slug', () => {
    expect(slugify('???')).toBe('item');
    expect(slugify('')).toBe('item');
  });
});

describe('search clauses', () => {
  it('leaves the ISBN clause out when the query has no digits', () => {
    const clauses = bookSearchClauses('Zhadan');
    expect(clauses.some((c) => 'isbnDigits' in c)).toBe(false);
  });

  it('adds it when the query looks like an ISBN, whatever the hyphenation', () => {
    const a = bookSearchClauses('978-966-97679-2-0');
    const b = bookSearchClauses('9789669767920');
    const pick = (cs: typeof a) => cs.find((c) => 'isbnDigits' in c) as { isbnDigits: { contains: string } };
    expect(pick(a).isbnDigits.contains).toBe('9789669767920');
    expect(pick(b).isbnDigits.contains).toBe('9789669767920');
  });

  it('never emits an empty contains, which would match every row', () => {
    for (const q of ['Zhadan', 'поезія', 'a', '  ']) {
      for (const c of bookSearchClauses(q)) {
        const value = Object.values(c)[0] as { contains?: string } | undefined;
        expect(value?.contains).not.toBe('');
      }
    }
  });

  it('normalises an ISBN for storage', () => {
    expect(isbnDigitsOf('978-617-585-088-2')).toBe('9786175850882');
    expect(isbnDigitsOf('n/a')).toBeNull();
    expect(isbnDigitsOf(null)).toBeNull();
  });
});

describe('roles', () => {
  it('gives the super admin every permission there is', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toBe('*');
  });

  it('keeps a customer out of every staff permission', () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
  });

  it('does not let a catalogue manager touch orders or roles', () => {
    const granted = ROLE_PERMISSIONS.CATALOG_MANAGER as string[];
    expect(granted).not.toContain('order.read');
    expect(granted).not.toContain('role.write');
    expect(granted).not.toContain('theme.publish');
  });

  it('does not let a content editor publish books', () => {
    const granted = ROLE_PERMISSIONS.CONTENT_EDITOR as string[];
    expect(granted).not.toContain('book.publish');
    expect(granted).toContain('article.publish');
  });

  it('only grants permissions that exist', () => {
    for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
      if (grants === '*') continue;
      for (const key of grants) {
        expect(ALL_PERMISSIONS, `${role} grants unknown permission ${key}`).toContain(key);
      }
    }
  });
});

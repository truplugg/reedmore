import type { Currency, Locale } from '@prisma/client';

/** Exactly three (§3). Anything else falls back to English. */
export const LOCALES = ['DE', 'UK', 'EN'] as const;
export const DEFAULT_LOCALE: Locale = 'EN';

export const LOCALE_TAGS: Record<Locale, string> = { DE: 'de', UK: 'uk', EN: 'en' };
export const TAG_TO_LOCALE: Record<string, Locale> = { de: 'DE', uk: 'UK', en: 'EN' };

/**
 * Pick a locale from an Accept-Language header (§3). Quality values are
 * honoured, region subtags are ignored (de-AT is still German), and anything
 * unsupported falls through to English rather than to the first thing listed.
 */
export function localeFromAcceptLanguage(header?: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0] ?? '';
    const hit = TAG_TO_LOCALE[base];
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

/** A sensible first currency for a locale. The user's own choice always wins
 *  and is what gets stored — this is only the opening guess (§4). */
export function currencyForLocale(locale: Locale): Currency {
  return locale === 'UK' ? 'UAH' : 'EUR';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
export function isCurrency(value: unknown): value is Currency {
  return value === 'EUR' || value === 'UAH';
}

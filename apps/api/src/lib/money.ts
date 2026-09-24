import type { Currency } from '@prisma/client';

/**
 * Money is an integer of minor units, everywhere, always. Ridmore does not
 * convert between currencies: a book carries a price in each, entered by hand,
 * and the shop picks a column (§4). So there is no rate in this file, and
 * there should never be one.
 */
export const MINOR_UNITS: Record<Currency, number> = { EUR: 100, UAH: 100 };

export interface PricedBook {
  priceEurCents: number;
  priceUahCents: number;
  salePriceEurCents?: number | null;
  salePriceUahCents?: number | null;
}

/** The price actually charged, and the one it was struck through from. */
export function priceOf(book: PricedBook, currency: Currency): { amount: number; was: number | null } {
  const list = currency === 'EUR' ? book.priceEurCents : book.priceUahCents;
  const sale = currency === 'EUR' ? book.salePriceEurCents : book.salePriceUahCents;
  if (sale != null && sale < list) return { amount: sale, was: list };
  return { amount: list, was: null };
}

const LOCALE_FOR: Record<Currency, string> = { EUR: 'de-DE', UAH: 'uk-UA' };

export function formatMoney(minor: number, currency: Currency, locale?: string): string {
  return new Intl.NumberFormat(locale ?? LOCALE_FOR[currency], {
    style: 'currency', currency, minimumFractionDigits: currency === 'UAH' ? 0 : 2
  }).format(minor / MINOR_UNITS[currency]);
}

export function assertMinor(n: unknown, field: string): number {
  if (!Number.isInteger(n) || (n as number) < 0) {
    throw new Error(`${field} must be a non-negative integer of minor units, got ${String(n)}`);
  }
  return n as number;
}

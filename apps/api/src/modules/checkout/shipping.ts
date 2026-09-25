import type { Country, Currency } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * What delivery costs (§22).
 *
 * Two countries, two currencies, and a figure entered by hand for each.
 * Nothing here divides one currency by another, because there is no rate in
 * this repository and a shipping calculator is the second most likely place
 * for one to appear (§4).
 *
 * Germany is served in euro and Ukraine in hryvnia, but the two choices are
 * independent everywhere else in the shop, so this takes the currency it is
 * given rather than deriving it from the country.
 */

export interface ShippingQuote {
  currency: Currency;
  country: Country;
  /** What the basket comes to before delivery. */
  subtotal: number;
  /** Zero once the basket is over the threshold. */
  shippingCost: number;
  /** The figure delivery becomes free at, so the page can say how far off. */
  freeFrom: number;
  total: number;
}

export async function quoteShipping(
  subtotal: number,
  currency: Currency,
  country: Country
): Promise<ShippingQuote> {
  const s = await prisma.siteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const freeFrom = currency === 'EUR' ? s.freeShippingEurCents : s.freeShippingUahCents;
  const flat = currency === 'EUR' ? s.shippingFlatEurCents : s.shippingFlatUahCents;

  /* An empty basket is not free delivery, it is no delivery. Charging the
     flat rate on nothing would put a shop's postage in an empty cart. */
  const shippingCost = subtotal === 0 || subtotal >= freeFrom ? 0 : flat;

  return { currency, country, subtotal, shippingCost, freeFrom, total: subtotal + shippingCost };
}

/* ============================================================
   RIDMORE — EU shipping estimate
   Weight-banded rates per destination group, with the carrier
   and transit window each group actually uses.
   ============================================================ */

import { money, price, freeFrom, cartEntries, get } from './store.js';
import { t, getLang } from './i18n.js';
import { esc } from './covers.js';
import { cartSubtotal } from './cart.js';

/* Ridmore ships to exactly two countries (§4), and each carries its own
   rates in each currency — nothing is converted at the till. Amounts are
   integers of minor units. */
const COUNTRIES = {
  de: {
    de: 'Deutschland', uk: 'Німеччина', en: 'Germany',
    carrier: 'DHL', days: '2–4',
    base: { EUR: 490, UAH: 25000 }, perKg: { EUR: 190, UAH: 9500 }
  },
  ua: {
    de: 'Ukraine', uk: 'Україна', en: 'Ukraine',
    carrier: 'Нова пошта', days: '1–3',
    base: { EUR: 190, UAH: 8000 }, perKg: { EUR: 60, UAH: 2500 }
  }
};

export const SHIP_TO = COUNTRIES;

const AVG_BOOK_G = 380;

export function estimate({ country = 'de', books = 2, subtotal = 0, currency = 'EUR' }) {
  const c = COUNTRIES[country] || COUNTRIES.de;
  const cur = c.base[currency] != null ? currency : 'EUR';
  const kg = Math.max(0.3, (books * AVG_BOOK_G + 180) / 1000);
  const raw = c.base[cur] + Math.ceil(Math.max(0, kg - 0.5) * 2) / 2 * c.perKg[cur];
  const free = subtotal >= freeFrom(cur);
  return { country: c, kg, currency: cur, cost: free ? 0 : Math.round(raw / 10) * 10, free };
}

export function initDelivery() {
  const form = document.getElementById('calc');
  if (!form) return;
  const country = form.querySelector('#calc-country');
  const qty = form.querySelector('#calc-qty');
  const out = form.querySelector('#calc-out');

  /* The label comes from the active language; the shop speaks three. */
  const fillCountries = () => {
    const lang = getLang();
    const current = country.value;
    country.innerHTML = Object.entries(COUNTRIES)
      .map(([id, c]) => `<option value="${id}">${esc(c[lang] ?? c.en)}</option>`).join('');
    country.value = current && COUNTRIES[current] ? current : (get('country') ?? 'de');
  };

  function run() {
    const books = Math.max(1, Math.min(20, Number(qty.value) || 1));
    const sub = cartSubtotal();
    const currency = get('currency') || 'EUR';
    const r = estimate({ country: country.value, books, subtotal: sub, currency });
    const goods = sub || 0;

    out.innerHTML = `
      <div class="calc__line"><dt>${esc(t('del.carrier'))}</dt><dd>${esc(r.country.carrier)}</dd></div>
      <div class="calc__line"><dt>${esc(t('del.eta'))}</dt><dd>${esc(r.country.days)} ${esc(t('del.days'))}</dd></div>
      <div class="calc__line"><dt>${esc(t('del.cost'))}</dt><dd>${r.free ? esc(t('del.freeNow')) : money(r.cost)}</dd></div>
      ${goods ? `<div class="calc__line calc__total"><dt>${esc(t('del.total'))}</dt><dd>${money(goods + r.cost)}</dd></div>` : ''}
      ${!r.free ? `<div class="calc__free"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>${esc(t('del.free'))} ${money(freeFrom(currency))}</div>` : ''}`;
  }

  fillCountries();
  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.querySelector('#calc-use-cart')?.addEventListener('click', () => {
    const n = cartEntries().reduce((a, [, q]) => a + q, 0);
    qty.value = Math.max(1, n);
    run();
  });
  document.addEventListener('ridmore:refresh', () => { fillCountries(); run(); });
  run();
}

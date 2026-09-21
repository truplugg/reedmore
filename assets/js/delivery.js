/* ============================================================
   READMORE — EU shipping estimate
   Weight-banded rates per destination group, with the carrier
   and transit window each group actually uses.
   ============================================================ */

import { money, FREE_FROM_UAH, cartEntries } from './store.js';
import { t, getLang } from './i18n.js';
import { esc } from './covers.js';
import { cartSubtotal } from './cart.js';

/* base rate in UAH per parcel band, by destination zone */
const ZONES = {
  ua: { ua: 'Україна',            en: 'Ukraine',        carrier: 'Нова пошта',  days: '1–3',  base: 80,  perKg: 25 },
  pl: { ua: 'Польща',             en: 'Poland',         carrier: 'InPost',      days: '2–4',  base: 260, perKg: 90 },
  cz: { ua: 'Чехія, Словаччина',  en: 'Czechia, Slovakia', carrier: 'DPD',      days: '3–5',  base: 330, perKg: 110 },
  de: { ua: 'Німеччина, Австрія', en: 'Germany, Austria',  carrier: 'DHL',      days: '3–5',  base: 360, perKg: 120 },
  nl: { ua: 'Бенілюкс',           en: 'Benelux',        carrier: 'DPD',         days: '4–6',  base: 380, perKg: 125 },
  fr: { ua: 'Франція',            en: 'France',         carrier: 'Colissimo',   days: '4–6',  base: 400, perKg: 130 },
  it: { ua: 'Італія, Іспанія',    en: 'Italy, Spain',   carrier: 'GLS',         days: '5–7',  base: 430, perKg: 140 },
  nordic: { ua: 'Скандинавія',    en: 'Nordics',        carrier: 'PostNord',    days: '5–8',  base: 470, perKg: 150 },
  balt: { ua: 'Балтія',           en: 'Baltics',        carrier: 'Omniva',      days: '3–5',  base: 310, perKg: 100 },
  other: { ua: 'Інші країни ЄС',  en: 'Rest of the EU', carrier: 'DPD',         days: '5–9',  base: 450, perKg: 145 }
};

const AVG_BOOK_G = 380;

export function estimate({ zone = 'pl', books = 2, subtotalUAH = 0 }) {
  const z = ZONES[zone] || ZONES.pl;
  const kg = Math.max(0.3, (books * AVG_BOOK_G + 180) / 1000);   /* +180 g for the box */
  const raw = z.base + Math.ceil(Math.max(0, kg - 0.5) * 2) / 2 * z.perKg;
  const free = subtotalUAH >= FREE_FROM_UAH && zone !== 'other';
  return { zone: z, kg, cost: free ? 0 : Math.round(raw / 5) * 5, free };
}

export function initDelivery() {
  const form = document.getElementById('calc');
  if (!form) return;
  const country = form.querySelector('#calc-country');
  const qty = form.querySelector('#calc-qty');
  const out = form.querySelector('#calc-out');

  const lang = () => (getLang() === 'en' ? 'en' : 'ua');
  const fillCountries = () => {
    const current = country.value;
    country.innerHTML = Object.entries(ZONES)
      .map(([id, z]) => `<option value="${id}">${esc(z[lang()])}</option>`).join('');
    country.value = current && ZONES[current] ? current : 'pl';
  };

  function run() {
    const books = Math.max(1, Math.min(20, Number(qty.value) || 1));
    const sub = cartSubtotal();
    const r = estimate({ zone: country.value, books, subtotalUAH: sub });
    const goods = sub || 0;

    out.innerHTML = `
      <div class="calc__line"><dt>${esc(t('del.carrier'))}</dt><dd>${esc(r.zone.carrier)}</dd></div>
      <div class="calc__line"><dt>${esc(t('del.eta'))}</dt><dd>${esc(r.zone.days)} ${esc(t('del.days'))}</dd></div>
      <div class="calc__line"><dt>${esc(t('del.cost'))}</dt><dd>${r.free ? esc(t('del.freeNow')) : money(r.cost)}</dd></div>
      ${goods ? `<div class="calc__line calc__total"><dt>${esc(t('del.total'))}</dt><dd>${money(goods + r.cost)}</dd></div>` : ''}
      ${!r.free ? `<div class="calc__free"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>${esc(t('del.free'))} ${money(FREE_FROM_UAH)}</div>` : ''}`;
  }

  fillCountries();
  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.querySelector('#calc-use-cart')?.addEventListener('click', () => {
    const n = cartEntries().reduce((a, [, q]) => a + q, 0);
    qty.value = Math.max(1, n);
    run();
  });
  document.addEventListener('readmore:refresh', () => { fillCountries(); run(); });
  run();
}

/**
 * RIDMORE — checkout (§22, §23).
 *
 * Three steps over the shop: where it goes, what it comes to, and the
 * receipt. Two rules shape the whole file.
 *
 * **No figure on this screen is computed here.** The basket is sent to the
 * server as ids and quantities, and every price, the delivery charge and the
 * total come back from it. A total added up in a browser is a total the
 * buyer can edit, so this one is only ever displayed.
 *
 * **No card field exists.** Stripe is not connected, and the page says so
 * rather than miming a form. When a provider is connected the server starts
 * answering /payment-methods differently and this screen picks it up — the
 * card option is drawn from that answer, not from a constant here.
 */

import { api } from './api.js';
import { cartEntries, clearCart, get } from './store.js';
import { findBook } from './catalog.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { currentViewer } from './api.js';

let dialog, bodyEl, stepsEl;
let step = 'address';
let quote = null;
let placed = null;
let methods = null;

/** The address as typed. Kept across steps so going back loses nothing. */
const form = {
  fullName: '', phone: '', country: 'UA', city: '',
  postalCode: '', line1: '', line2: '', pickupPoint: '',
  email: '', notes: '', save: true, method: 'on_delivery'
};

/* ---------- little builders ---------- */

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

/** The server sends minor units and a currency; this only formats them. */
function money(minor, currency) {
  const tag = currency === 'UAH' ? 'uk-UA' : 'de-DE';
  return new Intl.NumberFormat(tag, {
    style: 'currency', currency, minimumFractionDigits: currency === 'UAH' ? 0 : 2
  }).format(minor / 100);
}

const cartItems = () => cartEntries()
  .map(([id, quantity]) => ({ bookId: id, quantity }))
  .filter((i) => i.quantity > 0);

/* ---------- steps ---------- */

function drawSteps() {
  const order = ['address', 'review', 'done'];
  const labels = { address: t('co.stepAddress'), review: t('co.stepReview'), done: t('co.stepDone') };
  const at = order.indexOf(step);
  stepsEl.replaceChildren(...order.map((s, i) => el('li', {
    class: `co__step${i === at ? ' is-now' : ''}${i < at ? ' is-done' : ''}`,
    'aria-current': i === at ? 'step' : null,
    text: labels[s]
  })));
}

function field(key, label, opts = {}) {
  const input = el('input', {
    class: 'co__input', type: opts.type ?? 'text', value: form[key] ?? '',
    placeholder: opts.placeholder ?? '', autocomplete: opts.autocomplete ?? 'on',
    oninput: (e) => { form[key] = e.target.value; e.target.classList.remove('is-bad'); }
  });
  input.dataset.field = key;
  return el('label', { class: 'co__field' }, el('span', { class: 'co__label', text: label }), input);
}

/** Step one: where it goes. */
function stepAddress() {
  const signedIn = !!currentViewer();

  const country = el('div', { class: 'co__country' },
    [['UA', t('co.ua')], ['DE', t('co.de')]].map(([code, label]) =>
      el('label', {},
        el('input', { type: 'radio', name: 'co-country', value: code, checked: form.country === code,
          onchange: () => { form.country = code; } }),
        el('span', { text: label }))));

  return el('form', { class: 'co__form', novalidate: true, onsubmit: (e) => { e.preventDefault(); toReview(); } },
    el('div', { class: 'co__field' }, el('span', { class: 'co__label', text: t('co.country') }), country),
    el('div', { class: 'co__grid' },
      field('fullName', t('co.name'), { autocomplete: 'name' }),
      field('phone', t('co.phone'), { type: 'tel', autocomplete: 'tel' })),
    signedIn ? null : el('div', { class: 'co__grid co__grid--wide' },
      field('email', t('co.email'), { type: 'email', autocomplete: 'email' })),
    el('div', { class: 'co__grid' },
      field('city', t('co.city'), { autocomplete: 'address-level2' }),
      field('postalCode', t('co.postal'), { autocomplete: 'postal-code' })),
    el('div', { class: 'co__grid co__grid--wide' },
      field('line1', t('co.line1'), { autocomplete: 'address-line1' }),
      field('pickupPoint', t('co.pickup'), { placeholder: t('co.pickupHint') }),
      field('notes', t('co.notes'))),
    signedIn ? el('label', { class: 'co__method' },
      el('input', { type: 'checkbox', checked: form.save, onchange: (e) => { form.save = e.target.checked; } }),
      el('span', {}, t('co.saveAddress'))) : null,
    el('div', { class: 'co__actions' },
      el('button', { class: 'btn btn--ghost', type: 'button', text: t('co.back'), onclick: close }),
      el('button', { class: 'btn btn--primary btn--lg', type: 'submit', text: t('co.toReview') })));
}

/** The fields a parcel cannot arrive without. */
function missingFields() {
  const need = ['fullName', 'city', 'postalCode', 'line1'];
  if (!currentViewer()) need.push('email');
  return need.filter((k) => !String(form[k] ?? '').trim());
}

async function toReview() {
  const gaps = missingFields();
  if (gaps.length) {
    for (const k of gaps) bodyEl.querySelector(`[data-field="${k}"]`)?.classList.add('is-bad');
    bodyEl.querySelector('.is-bad')?.focus();
    toast(t('co.fillRequired'));
    return;
  }
  step = 'review';
  await render();
}

/** Step two: what the server says it comes to. */
function stepReview() {
  if (!quote) return el('p', { class: 'co__note', text: t('co.pricing') });

  const currency = quote.currency;
  const lines = el('div', { class: 'co__lines' },
    quote.lines.map((l) => el('div', { class: 'co__line' },
      el('div', {},
        el('b', { text: l.title }),
        el('small', { text: `${l.author ?? ''} · ${l.quantity} × ${money(l.unitPrice, currency)}` })),
      el('span', { class: 'co__sum', text: money(l.lineTotal, currency) }))));

  const short = Math.max(0, quote.freeFrom - quote.subtotal);
  const totals = el('div', { class: 'co__totals' },
    el('div', { class: 'co__row' }, el('span', { text: t('cart.sub') }), el('span', { text: money(quote.subtotal, currency) })),
    el('div', { class: 'co__row' },
      el('span', { text: t('cart.ship') }),
      quote.shippingCost === 0
        ? el('span', { class: 'co__free', text: t('co.free') })
        : el('span', { text: money(quote.shippingCost, currency) })),
    short > 0 ? el('p', { class: 'co__note co__note--start', style: 'margin:0',
      text: `${t('cart.goal')} ${money(short, currency)}` }) : null,
    el('div', { class: 'co__row co__row--sum' },
      el('span', { text: t('cart.total') }), el('span', { text: money(quote.total, currency) })));

  /* The methods come from the server, so the day a provider is connected
     this list changes without this file being touched. */
  const pay = el('div', { class: 'co__pay' },
    (methods?.methods ?? []).map((m) => el('label', { class: `co__method${m.available ? '' : ' is-off'}` },
      el('input', { type: 'radio', name: 'co-pay', value: m.id, checked: form.method === m.id,
        disabled: !m.available, onchange: () => { form.method = m.id; } }),
      el('span', {}, m.label, m.note ? el('small', { text: m.note }) : null))));

  const ship = el('p', { class: 'co__note co__note--start' },
    `${form.fullName}, ${form.country === 'UA' ? t('co.ua') : t('co.de')}, ${form.city}, ${form.postalCode}, ${form.line1}`
    + (form.pickupPoint ? ` · ${form.pickupPoint}` : ''));

  return el('div', {},
    lines, totals,
    el('h3', { class: 'co__label', text: t('co.shipTo') }), ship,
    el('h3', { class: 'co__label', style: 'margin-top:1rem', text: t('co.payment') }), pay,
    el('div', { class: 'co__actions' },
      el('button', { class: 'btn btn--ghost', type: 'button', text: t('co.back'),
        onclick: async () => { step = 'address'; await render(); } }),
      el('button', { class: 'btn btn--primary btn--lg', type: 'button', text: t('co.place'),
        onclick: place })));
}

async function place(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = t('co.placing');
  try {
    const res = await api.placeOrder({
      items: cartItems(),
      address: {
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        country: form.country,
        city: form.city.trim(),
        postalCode: form.postalCode.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || null,
        pickupPoint: form.pickupPoint.trim() || null,
        save: !!currentViewer() && form.save
      },
      email: currentViewer() ? undefined : form.email.trim(),
      notes: form.notes.trim() || null
    });
    placed = res.order;
    /* The basket is emptied only once an order exists to have taken it. */
    clearCart();
    step = 'done';
    await render();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = t('co.place');
    toast(err?.message ?? t('co.failed'));
  }
}

/** Step three: the receipt, honest about payment. */
function stepDone() {
  const o = placed;
  return el('div', { class: 'co__done' },
    tickMark(),
    el('p', { class: 'co__number', text: o.number }),
    el('p', { class: 'co__note', text: t('co.thanks') }),
    el('div', { class: 'co__totals', style: 'max-width:26rem;margin-inline:auto' },
      el('div', { class: 'co__row co__row--sum' },
        el('span', { text: t('cart.total') }), el('span', { text: money(o.total, o.currency) }))),
    el('p', { class: 'co__note', text: o.payment.provider === 'NONE' ? t('co.payLater') : t('co.payNext') }),
    el('div', { class: 'co__actions' },
      el('button', { class: 'btn btn--primary btn--lg', type: 'button', text: t('co.close'), onclick: close })));
}

/* ---------- the tick ----------
   Built in the SVG namespace, because document.createElement('svg') makes
   an unknown HTML element that lays out and paints nothing — the receipt
   had a 56-pixel hole where this belonged. */
const SVG_NS = 'http://www.w3.org/2000/svg';

function tickMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'co__mark');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');

  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', '12');
  ring.setAttribute('cy', '12');
  ring.setAttribute('r', '10');
  ring.setAttribute('opacity', '0.35');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M7.5 12.4 10.8 15.7 16.8 9');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  svg.append(ring, path);
  return svg;
}

/* ---------- shell ---------- */

async function render() {
  drawSteps();
  if (step === 'review' && !quote) {
    bodyEl.replaceChildren(el('p', { class: 'co__note', text: t('co.pricing') }));
    try {
      [quote, methods] = await Promise.all([
        api.quoteCart({ items: cartItems(), country: form.country }),
        methods ? Promise.resolve(methods) : api.paymentMethods()
      ]);
    } catch (err) {
      step = 'address';
      toast(err?.message ?? t('co.failed'));
      drawSteps();
    }
  }
  const view = step === 'address' ? stepAddress() : step === 'review' ? stepReview() : stepDone();
  bodyEl.replaceChildren(view);
  bodyEl.querySelector('input, button')?.focus({ preventScroll: true });
}

export function openCheckout() {
  if (!dialog) return;
  if (!cartItems().length) { toast(t('cart.empty')); return; }

  const viewer = currentViewer();
  /* An account already knows most of this; a guest fills it in once. */
  if (viewer) {
    form.fullName ||= viewer.nickname ?? '';
    form.email = viewer.email ?? '';
  }
  form.country = get('currency') === 'UAH' ? 'UA' : 'DE';

  step = 'address';
  quote = null;
  placed = null;
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add('is-open'));
  document.body.classList.add('is-locked');
  render();
}

function close() {
  dialog.classList.remove('is-open');
  document.body.classList.remove('is-locked');
  setTimeout(() => { dialog.hidden = true; }, 280);
  /* Leaving after the receipt should not drop the buyer back into a review
     of a basket that is already gone. */
  if (step === 'done') { step = 'address'; quote = null; }
}

export function initCheckout() {
  dialog = document.getElementById('checkout-dialog');
  if (!dialog) return;
  bodyEl = document.getElementById('co-body');
  stepsEl = document.getElementById('co-steps');

  dialog.querySelector('[data-act="close"]')?.addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.hidden) close();
  });
}

/* ============================================================
   RIDMORE — cart drawer and wishlist
   ============================================================ */

import { cartEntries, cartCount, setQty, money, price, get, freeFrom, toggleWish, inWish, subscribe } from './store.js';
import { thumbHTML, esc } from './covers.js';
import { findBook } from './catalog.js';
import { t } from './i18n.js';
import { toast, clearToasts } from './ui.js';
import { stagger } from './motion.js';

let drawer, scrim, body, foot, goal;

export function cartSubtotal() {
  return cartEntries().reduce((sum, [id, q]) => {
    const b = findBook(id);
    return b ? sum + price(b).amount * q : sum;
  }, 0);
}

function lineHTML(book, qty) {
  return `
    <div class="line" data-id="${esc(book.id)}">
      ${thumbHTML(book)}
      <div>
        <p class="line__title">${esc(book.title)}</p>
        <p class="line__author">${esc(book.author)}</p>
        <div class="line__controls">
          <div class="qty">
            <button type="button" data-act="dec" aria-label="−1">−</button>
            <output class="num">${qty}</output>
            <button type="button" data-act="inc" aria-label="+1">+</button>
          </div>
          <button type="button" class="line__remove" data-act="drop">${esc(t('cart.remove'))}</button>
        </div>
      </div>
      <div class="line__price num">${money(price(book).amount * qty)}</div>
    </div>`;
}

export function renderCart() {
  if (!body) return;
  const entries = cartEntries().map(([id, q]) => [findBook(id), q]).filter(([b]) => b);
  const sub = cartSubtotal();

  body.innerHTML = entries.length
    ? entries.map(([b, q]) => lineHTML(b, q)).join('')
    : `<div class="empty">
         <svg class="empty__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 5.5v15"/></svg>
         <h3>${esc(t('cart.empty'))}</h3>
         <p class="prose">${esc(t('cart.emptyNote'))}</p>
         <button class="btn btn--ghost" data-act="close-cart">${esc(t('cart.emptyCta'))}</button>
       </div>`;

  /* named for what it is, so it cannot shadow the #cart-goal element */
  const freeAt = freeFrom();
  const left = Math.max(0, freeAt - sub);
  goal.innerHTML = entries.length ? `
    <div class="ship-goal__txt">${left > 0
      ? `${esc(t('cart.goal'))} <b>${money(left)}</b>`
      : `<b>${esc(t('cart.goalDone'))}</b>`}</div>
    <div class="ship-goal__bar"><div class="ship-goal__fill" style="inline-size:${Math.min(100, (sub / freeAt) * 100).toFixed(1)}%"></div></div>` : '';

  stagger(body, '.line');
  foot.querySelector('#cart-sub').textContent = money(sub);
  foot.querySelector('#cart-total').textContent = money(sub);
  foot.querySelector('#cart-ship').textContent = left > 0 ? t('cart.shipCalc') : money(0);
  foot.hidden = entries.length === 0;

  const n = cartCount();
  document.querySelectorAll('[data-count="cart"]').forEach((el) => {
    const grew = n > (Number(el.textContent) || 0);
    el.textContent = n;
    el.hidden = n === 0;
    if (grew) {
      el.classList.remove('is-pop');
      void el.offsetWidth;             /* restart the animation */
      el.classList.add('is-pop');
    }
  });
}

export function renderWishCount() {
  const n = get('wish').length;
  document.querySelectorAll('[data-count="wish"]').forEach((el) => {
    el.textContent = n;
    el.hidden = n === 0;
  });
  document.querySelectorAll('[data-act="wish"]').forEach((btn) => {
    const on = inWish(btn.dataset.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none');
  });
}

export function openCart() {
  clearToasts();
  drawer.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    scrim.classList.add('is-on');
  });
  document.body.classList.add('is-locked');
  drawer.querySelector('.drawer__head button')?.focus();
}

export function closeCart() {
  drawer.classList.remove('is-open');
  scrim.classList.remove('is-on');
  document.body.classList.remove('is-locked');
  setTimeout(() => { drawer.hidden = true; scrim.hidden = true; }, 320);
}

export function wish(id) {
  const book = findBook(id);
  const added = toggleWish(id);
  toast(`${book ? '«' + book.title + '» ' : ''}${added ? t('cart.wishAdd') : t('cart.wishRemove')}`);
}

export function initCart() {
  drawer = document.getElementById('cart');
  scrim = document.getElementById('scrim');
  body = document.getElementById('cart-body');
  foot = document.getElementById('cart-foot');
  goal = document.getElementById('cart-goal');
  if (!drawer) return;

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const line = btn.closest('.line');
    if (btn.dataset.act === 'close-cart') return closeCart();
    if (!line) return;
    const id = line.dataset.id;
    const current = Number(line.querySelector('output').textContent) || 1;
    if (btn.dataset.act === 'inc') setQty(id, current + 1);
    if (btn.dataset.act === 'dec') setQty(id, current - 1);
    if (btn.dataset.act === 'drop') setQty(id, 0);
  });

  document.getElementById('cart-checkout')?.addEventListener('click', async () => {
    const { openCheckout } = await import('./checkout.js');
    closeCart();
    openCheckout();
  });

  scrim.addEventListener('click', closeCart);
  drawer.querySelector('[data-act="close"]')?.addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeCart();
  });

  subscribe((what) => {
    if (what === 'cart' || what === 'currency') renderCart();
    if (what === 'wish') renderWishCount();
  });

  renderCart();
  renderWishCount();
}

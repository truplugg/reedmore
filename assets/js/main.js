/* ============================================================
   READMORE — bootstrap
   ============================================================ */

import { BOOKS } from './data/books.js';
import { installCustomBooks } from './custom.js';
import { bookHTML, mountBooks } from './book3d.js';
import { initCatalog, render as renderShelf, findBook, applyFilter, showWishlist } from './catalog.js';
import { initCart, renderCart, renderWishCount, openCart, wish } from './cart.js';
import { initDialog, openDialog, closeDialog, dialogBookId } from './dialog.js';
import { initDelivery } from './delivery.js';
import { initPalette } from './palette.js';
import { initReveals, initBand, initHero, initCounters, initOrnaments, initParallax } from './motion.js';
import { initShell, initSectionSpy, toast } from './ui.js';
import { addToCart, subscribe, get } from './store.js';
import { t } from './i18n.js';

document.documentElement.classList.add('js');

/* books added from the admin desk join the catalogue before anything renders */
installCustomBooks(BOOKS);

/* ---------- the shelf of new arrivals ---------- */
function newestFirst(n = 14) {
  return [...BOOKS]
    .sort((a, x) =>
      (x.custom ? 1 : 0) - (a.custom ? 1 : 0) ||
      (x.badge === 'new' ? 1 : 0) - (a.badge === 'new' ? 1 : 0) ||
      x.year - a.year)
    .slice(0, n);
}

/**
 * The rail drifts right to left like the band above it. The loop is
 * seamless because the same set is laid out twice and the track travels
 * exactly one set plus one gap; the second set is a decoration, so it is
 * hidden from assistive tech and taken out of the tab order.
 */
function renderRail() {
  const rail = document.getElementById('rail');
  if (!rail) return;
  const group = newestFirst().map((b) => bookHTML(b)).join('');
  rail.innerHTML = `
    <div class="rail__track">
      <div class="rail__group">${group}</div>
      <div class="rail__group rail__group--echo" aria-hidden="true">${group}</div>
    </div>`;
  rail.querySelectorAll('.rail__group--echo button').forEach((btn) => { btn.tabIndex = -1; });
  mountBooks(rail, { onDetails: openDialog });
}

/* ---------- the hero book ---------- */
function renderHeroBook() {
  const slot = document.querySelector('.hero__book');
  if (!slot) return;
  const featured = findBook('slovnyk-viyny') || BOOKS[0];
  slot.innerHTML = bookHTML(featured, { mode: 'open' });
  slot.querySelector('.book')?.classList.add('book--solo');
  mountBooks(slot, { onDetails: openDialog });
}

/* ---------- one place handles buying from anywhere ---------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;

  if (act === 'add' && id) {
    const book = findBook(id);
    addToCart(id, 1);
    toast(`«${book.title}» ${t('cart.added')}`, {
      label: t('a11y.cart'),
      run: openCart
    });
    btn.textContent = t('book.added');
    setTimeout(() => { btn.textContent = t('book.add'); }, 1400);
  }

  if (act === 'wish' && id) wish(id);

  if (act === 'cart') openCart();

  if (act === 'wishlist') showWishlist();

  if (act === 'collection') {
    applyFilter({ genre: btn.dataset.genre, tag: btn.dataset.tag });
  }
});

/* anchors that point at a filtered catalogue */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-filter]');
  if (!link) return;
  e.preventDefault();
  const { genre, tag } = link.dataset;
  applyFilter({ genre, tag });
});

/* ---------- boot ---------- */
function redrawAll() {
  renderHeroBook();
  renderRail();
  renderShelf();
  renderCart();
  renderWishCount();
  initReveals();
  initCounters();
  const open = dialogBookId();
  if (open) { closeDialog(); setTimeout(() => openDialog(open), 20); }
  document.dispatchEvent(new CustomEvent('readmore:refresh'));
}

function boot() {
  initShell({ onLangChange: redrawAll });
  renderHeroBook();
  renderRail();
  initCatalog({ onDetails: openDialog });
  initCart();
  initDialog();
  initDelivery();
  initPalette({ onPick: openDialog });
  initBand();
  initSectionSpy();
  initReveals();
  initOrnaments();
  initCounters();
  initParallax();
  initHero();

  /* prices live in one currency at a time, so a change redraws
     everything that shows one */
  subscribe((what) => {
    if (what !== 'currency') return;
    renderHeroBook();
    renderRail();
    renderShelf();
    const open = dialogBookId();
    if (open) { closeDialog(); setTimeout(() => openDialog(open), 20); }
    document.dispatchEvent(new CustomEvent('readmore:refresh'));
  });

  document.addEventListener('shelf:rendered', () => {
    initReveals();
    renderWishCount();
  });

  /* the wishlist counter reflects hearts rendered after boot */
  renderWishCount();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

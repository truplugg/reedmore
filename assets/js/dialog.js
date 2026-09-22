/* ============================================================
   READMORE — the full record for one book
   ============================================================ */

import { BOOKS } from './data/books.js';
import { bookHTML, setBookView, stars, closeOpenBook } from './book3d.js';
import { thumbHTML, esc } from './covers.js';
import { money, addToCart, inWish } from './store.js';
import { t, getLang } from './i18n.js';
import { findBook, applyFilter } from './catalog.js';
import { toast } from './ui.js';
import { stagger } from './motion.js';
import { openCart } from './cart.js';

let dialog, panel, visual, scroll, lastFocus = null, currentId = null;

function specRows(book) {
  const rows = [
    [t('spec.publisher'), book.publisher],
    [t('spec.year'), book.year],
    [t('spec.pages'), book.pages],
    [t('spec.size'), book.size],
    [t('spec.binding'), book.binding],
    [t('spec.paper'), book.paper],
    [t('spec.weight'), `${book.weight} г`],
    [t('spec.lang'), t('spec.langUk')],
    ['ISBN', book.isbn]
  ];
  if (book.translator) rows.splice(1, 0, [t('spec.translator'), book.translator]);
  return rows.map(([k, v]) =>
    `<div class="spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function stockLine(book) {
  if (book.badge === 'preorder') return `<span class="stock stock--pre"><i class="stock__dot"></i>${esc(t('book.preorder'))}</span>`;
  if (book.stock === 0) return `<span class="stock stock--out"><i class="stock__dot"></i>${esc(t('book.out'))}</span>`;
  if (book.stock <= 6) return `<span class="stock stock--low"><i class="stock__dot"></i>${esc(t('book.low'))} ${book.stock}</span>`;
  return `<span class="stock"><i class="stock__dot"></i>${esc(t('book.inStock'))}</span>`;
}

function related(book) {
  const near = BOOKS.filter((b) => b.id !== book.id && b.genre === book.genre).slice(0, 3);
  if (!near.length) return '';
  return `
    <div>
      <h4 class="field__label" style="margin-block-end:.7rem">${esc(t('book.related'))}</h4>
      <div class="related">
        ${near.map((b) => `
          <button class="related__item" type="button" data-act="swap" data-id="${esc(b.id)}">
            ${thumbHTML(b)}
            <span class="related__text">
              <span class="related__t">${esc(b.title)}</span>
              <span class="related__a">${esc(b.author)}</span>
            </span>
            <span class="related__p num">${money(b.price)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

const VIEWS = ['front', 'spread', 'back'];

let view = 'spread';

function showView(next) {
  const book = visual?.querySelector('.book');
  if (!book) return;
  view = next;
  setBookView(book, view);
  visual.querySelectorAll('#dialog-views button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}

/* the book itself is a control too: tapping it walks the three faces */
const nextView = () => VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];

export function openDialog(id) {
  const book = findBook(id);
  if (!book || !dialog) return;
  currentId = id;
  lastFocus = document.activeElement;

  const lang = getLang();
  const title = lang === 'en' && book.titleEn ? book.titleEn : book.title;
  const about = lang === 'en' && book.aboutEn ? book.aboutEn : book.about;

  /* the record is where the object gets looked at properly, so all
     three faces are on offer rather than left to a hover */
  visual.innerHTML = bookHTML(book, { mode: 'open' })
    + `<div class="seg seg--views" id="dialog-views" role="group" aria-label="${esc(t('view.label'))}">
         ${VIEWS.map((v) => `<button type="button" data-view="${v}"
             aria-pressed="${v === 'spread'}">${esc(t('view.' + v))}</button>`).join('')}
       </div>`;
  visual.querySelector('.book')?.classList.add('book--solo');
  requestAnimationFrame(() => showView('spread'));

  scroll.innerHTML = `
    <div class="dialog__eyebrow">
      ${book.badge ? `<span class="badge badge--${book.badge}">${esc(t('badge.' + book.badge))}</span>` : ''}
      ${stockLine(book)}
    </div>
    <h2>${esc(title)}</h2>
    <p class="dialog__author">${esc(lang === 'en' && book.authorEn ? book.authorEn : book.author)} · <span class="num">${book.year}</span></p>
    <p class="dialog__rating">${stars(book.rating)} <span class="book__author num">(${book.reviews})</span></p>
    <p class="dialog__blurb">${esc(about)}</p>
    <div class="dialog__buy">
      <span class="dialog__price num">${book.oldPrice ? `<s>${money(book.oldPrice)}</s>` : ''}${money(book.price)}</span>
      <button class="btn btn--primary" data-act="add" data-id="${esc(book.id)}">${esc(t('book.add'))}</button>
      <button class="btn btn--ghost" data-act="wish" data-id="${esc(book.id)}" aria-pressed="${inWish(book.id)}">
        <svg class="btn__icon" viewBox="0 0 24 24" fill="${inWish(book.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6C19 15.4 12 20 12 20Z"/></svg>
        ${esc(t('book.wish'))}
      </button>
    </div>
    <dl class="specs">${specRows(book)}</dl>
    <div class="tags">${book.tags.map((tag) =>
      `<button class="tag" data-act="tag" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('')}</div>
    ${related(book)}`;

  stagger(scroll, ':scope > *');
  dialog.hidden = false;
  document.getElementById('scrim').hidden = false;
  requestAnimationFrame(() => {
    dialog.classList.add('is-open');
    document.getElementById('scrim').classList.add('is-on');
  });
  document.body.classList.add('is-locked');
  panel.querySelector('.dialog__close').focus();
  scroll.scrollTop = 0;
}

export function closeDialog() {
  if (!dialog || dialog.hidden) return;
  dialog.classList.remove('is-open');
  const scrim = document.getElementById('scrim');
  if (!document.getElementById('cart').classList.contains('is-open')) {
    scrim.classList.remove('is-on');
    document.body.classList.remove('is-locked');
    setTimeout(() => { scrim.hidden = true; }, 320);
  }
  setTimeout(() => { dialog.hidden = true; closeOpenBook(); }, 320);
  lastFocus?.focus?.();
  currentId = null;
}

export function initDialog() {
  dialog = document.getElementById('book-dialog');
  if (!dialog) return;
  panel = dialog.querySelector('.dialog__panel');
  visual = dialog.querySelector('.dialog__visual');
  scroll = dialog.querySelector('.dialog__scroll');

  visual.addEventListener('click', (e) => {
    const btn = e.target.closest('#dialog-views button');
    if (btn) { showView(btn.dataset.view); return; }
    if (e.target.closest('.book__trigger')) showView(nextView());
  });

  panel.querySelector('.dialog__close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });
  document.getElementById('scrim').addEventListener('click', closeDialog);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.hidden) { e.stopPropagation(); closeDialog(); }
  });

  scroll.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'tag') { closeDialog(); applyFilter({ tag: btn.dataset.tag }); }
    if (act === 'swap') openDialog(btn.dataset.id);
  });

  /* keep focus inside the panel while it is open */
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

export const dialogBookId = () => currentId;

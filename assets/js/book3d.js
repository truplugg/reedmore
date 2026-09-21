/* ============================================================
   READMORE — the book object
   One component, two behaviours:
     turn  — the shelf. Pointing at a book turns it toward the
             reader and returns its colour; its neighbours fall
             to grey. A second activation opens the record.
     open  — hero and record. The cover swings on its spine to
             show the endpaper and the first page.
   Mouse hovers, a finger taps, the keyboard focuses.
   ============================================================ */

import { coverHTML, endpaperSVG, deviceSVG, esc } from './covers.js';
import { money, inWish } from './store.js';
import { t } from './i18n.js';

export const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function badges(book) {
  const out = [];
  if (book.badge) out.push(`<span class="badge badge--${book.badge}">${esc(t('badge.' + book.badge))}</span>`);
  if (book.oldPrice) out.push(`<span class="badge badge--sale">${esc(t('badge.sale'))}</span>`);
  if (book.stock > 0 && book.stock <= 6 && book.badge !== 'last') {
    out.push(`<span class="badge badge--last">${esc(t('badge.last'))} ${book.stock}</span>`);
  }
  /* always rendered: an empty row keeps every title on one baseline */
  return `<div class="book__badges">${out.slice(0, 2).join('')}</div>`;
}

export function stars(rating) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return `<span class="rating"><span class="rating__stars" aria-hidden="true">★★★★★<span class="rating__fill" style="inline-size:${pct}%">★★★★★</span></span><span class="num">${rating.toFixed(1)}</span></span>`;
}

function colophon(book) {
  const rows = [
    [t('spec.pages'), `${book.pages} ${t('book.pages')}`, false],
    [t('spec.size'), book.size, true],
    [t('spec.binding'), book.binding, true],
    [t('spec.paper'), book.paper, true],
    ['ISBN', book.isbn, false]
  ];
  return `<dl class="colophon">${rows.map(([k, v, sec]) =>
    `<dt class="${sec ? 'is-secondary' : ''}">${esc(k)}</dt><dd class="${sec ? 'is-secondary' : ''}">${esc(v)}</dd>`
  ).join('')}</dl>`;
}

const heart = (on) =>
  `<svg class="btn__icon" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6C19 15.4 12 20 12 20Z"/></svg>`;

/**
 * One book.
 *   mode 'turn'  — shelf and rail, with a product card beneath
 *   mode 'open'  — hero and record, cover swings, no card
 */
export function bookHTML(book, { mode = 'turn' } = {}) {
  const p = book.cover.pal;
  const vars = `--cv-paper:${p.paper};--cv-ink:${p.ink};--cv-accent:${p.accent}`;
  const label = `${book.title} — ${book.author}`;
  const open = mode === 'open';

  const inside = open ? `
    <div class="book__face book__face--inside">
      ${endpaperSVG(book.endpaper, book.id)}
      <div class="book__plate"><span>READMORE</span><span>Київ · Warszawa</span></div>
    </div>` : '';

  const page = open ? `
    <div class="book__page">
      <div class="book__folio"><span>${esc(t('book.annotation'))}</span><span class="num">${book.year}</span></div>
      <p class="book__excerpt">${esc(book.blurb)}</p>
      ${deviceSVG()}
      ${colophon(book)}
    </div>` : '';

  const card = open ? '' : `
    <div class="book__card">
      ${badges(book)}
      <h3 class="book__title">${esc(book.title)}</h3>
      <p class="book__author">${esc(book.author)}</p>
      <div class="book__line">
        <span class="book__price">${book.oldPrice ? `<s>${money(book.oldPrice)}</s>` : ''}<span class="${book.oldPrice ? 'is-now' : ''}">${money(book.price)}</span></span>
        ${stars(book.rating)}
      </div>
      <div class="book__actions">
        <button class="btn btn--sm btn--ink" data-act="add" data-id="${esc(book.id)}">${esc(t('book.add'))}</button>
        <button class="btn btn--sm btn--ghost btn--icon" data-act="wish" data-id="${esc(book.id)}"
                aria-pressed="${inWish(book.id)}" aria-label="${esc(t('book.wish'))}">${heart(inWish(book.id))}</button>
      </div>
    </div>`;

  return `
    <article class="book book--${open ? 'open' : 'turn'}" data-id="${esc(book.id)}" style="${vars}">
      <div class="book__head">
      <div class="book__stage">
        <div class="book__body">
          <div class="book__shadow" aria-hidden="true"></div>
          <div class="book__back" aria-hidden="true"></div>
          <div class="book__spine" aria-hidden="true"></div>
          <div class="book__edge" aria-hidden="true"></div>
          <div class="book__block">${page}</div>
          <div class="book__cover">
            <div class="book__face book__face--front">${coverHTML(book)}</div>
            ${inside}
          </div>
        </div>
      </div>
      <span class="book__hint" aria-hidden="true">${esc(t('book.details'))}</span>
      <button class="book__trigger" type="button" data-act="open" data-id="${esc(book.id)}"
              aria-expanded="false" aria-label="${esc(label)}"></button>
      </div>
      ${card}
    </article>`;
}

/* ---------- behaviour ---------- */

let active = null;
let lastPointer = 'mouse';
let activeAtPointerDown = false;

export function closeOpenBook() {
  if (!active) return;
  active.classList.remove('is-active', 'is-open');
  active.querySelector('.book__trigger')?.setAttribute('aria-expanded', 'false');
  active.closest('.shelf, .rail')?.classList.remove('is-browsing');
  active = null;
}

/**
 * The cover swings a full width to the left, so a book near either edge
 * of its container would open off-screen. Solve for the shift that keeps
 * the spread inside the frame; the CSS default covers the rest.
 */
export function placeSpread(book) {
  const stage = book.querySelector('.book__stage');
  const frame = book.closest('.shelf, .rail, .hero__stage, .dialog__visual');
  if (!stage || !frame) return;

  const S = parseFloat(getComputedStyle(book).getPropertyValue('--open-scale')) || 0.9;
  const W = stage.offsetWidth;
  if (!W) return;

  const stageRect = stage.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const pad = 8;

  /* an ancestor may be mid-transition and scaled, so bring the measured
     rects back into the element's own layout space before solving */
  const k = stageRect.width / W || 1;
  const left = (stageRect.left - frameRect.left) / k;
  const frameW = frameRect.width / k;

  /* measured against the rendered spread: hinged at 162° and lifted
     toward the viewer, the cover reaches ~0.99 of a scaled width past
     the body's left edge; REACH folds in the body's own half-width */
  const REACH = 1.52;
  const minX = pad - left - W / 2 + REACH * W * S;
  const maxX = (frameW - pad) - left - W / 2 - 0.5 * W * S;
  const wanted = 0.45 * W;

  const x = minX > maxX ? (minX + maxX) / 2 : Math.min(Math.max(wanted, minX), maxX);
  book.style.setProperty('--open-x', `${Math.round(x)}px`);
}

export function openOne(book) {
  if (active === book) return;
  closeOpenBook();
  book.classList.add('is-active');
  if (book.classList.contains('book--open')) {
    placeSpread(book);
    book.classList.add('is-open');
  }
  book.querySelector('.book__trigger')?.setAttribute('aria-expanded', 'true');
  book.closest('.shelf, .rail')?.classList.add('is-browsing');
  active = book;
}

/* Only a book standing on its own — the hero, the record — follows the
   cursor. On the shelf it would fight the turn and unsettle the grid. */
function tilt(book, e) {
  if (calm() || !fine()) return;
  if (!book.classList.contains('book--solo')) return;
  const stage = book.querySelector('.book__stage');
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  stage.style.setProperty('--ty', `${(x * 17).toFixed(2)}deg`);
  stage.style.setProperty('--tx', `${(-y * 10).toFixed(2)}deg`);
}

function untilt(book) {
  const stage = book.querySelector('.book__stage');
  if (!stage) return;
  stage.style.setProperty('--ty', '0deg');
  stage.style.setProperty('--tx', '0deg');
}

/**
 * Wire a container of books. Delegated, so re-rendering needs no
 * re-binding. `onDetails` gets the id when an already-focused book
 * is activated again.
 */
export function mountBooks(root, { onDetails } = {}) {
  if (!root || root.dataset.booksMounted) return;
  root.dataset.booksMounted = '1';

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (book && root.contains(book)) openOne(book);
  });

  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (!book || book.contains(e.relatedTarget)) return;
    untilt(book);
    if (active === book) closeOpenBook();
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (book) tilt(book, e);
  }, { passive: true });

  /* the state is read at pointerdown, before focus moves, so a first
     tap always gets the turn and only a second one asks for the record */
  root.addEventListener('pointerdown', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    lastPointer = e.pointerType || 'mouse';
    const book = trigger.closest('.book');
    activeAtPointerDown = book?.classList.contains('is-active') ?? false;
    /* A finger gets the turn the moment it lands, rather than waiting for
       the click that follows — which some mobile browsers withhold while
       they decide whether the touch is a scroll. */
    if (lastPointer !== 'mouse' && book && !activeAtPointerDown) openOne(book);
  }, true);

  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    const book = trigger.closest('.book');
    if (!book) return;
    e.preventDefault();

    const viaKeyboard = e.detail === 0;
    const wantsRecord = viaKeyboard || lastPointer === 'mouse' || activeAtPointerDown;

    if (wantsRecord && book.classList.contains('is-active')) {
      onDetails?.(trigger.dataset.id, book);
    } else {
      openOne(book);
    }
  });

  root.addEventListener('focusin', (e) => {
    const book = e.target.closest('.book');
    if (book && e.target.matches('.book__trigger')) openOne(book);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOpenBook();
  });
}

/* keep an open spread in frame when the viewport changes under it */
let resizeTimer;
window.addEventListener('resize', () => {
  if (!active) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => active && placeSpread(active), 120);
});

/* a book left focused by touch lets go when the reader taps elsewhere */
document.addEventListener('pointerdown', (e) => {
  if (!active || e.pointerType === 'mouse') return;
  if (e.target.closest('.book') !== active) closeOpenBook();
}, true);

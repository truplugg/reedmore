/* ============================================================
   READMORE — the opening book
   Markup for one book object plus the behaviour that opens it:
   hover on a fine pointer, tap on a coarse one, focus for the
   keyboard. One book open at a time inside a shelf; the rest
   recede so the open spread has room.
   ============================================================ */

import { coverHTML, esc } from './covers.js';
import { money, inWish } from './store.js';
import { t } from './i18n.js';

export const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BADGE_CLASS = { new: 'new', best: 'best', preorder: 'preorder', last: 'last' };

function badges(book) {
  const out = [];
  if (book.badge) out.push(`<span class="badge badge--${BADGE_CLASS[book.badge]}">${esc(t('badge.' + book.badge))}</span>`);
  if (book.oldPrice) out.push(`<span class="badge badge--sale">${esc(t('badge.sale'))}</span>`);
  if (book.stock > 0 && book.stock <= 6 && book.badge !== 'last') {
    out.push(`<span class="badge badge--last">${esc(t('badge.last'))} ${book.stock}</span>`);
  }
  return out.length ? `<div class="book__badges">${out.slice(0, 2).join('')}</div>` : '';
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

/**
 * One book. `variant` is 'card' (shelf), 'solo' (hero / dialog)
 * or 'list'. Solo books carry no meta block of their own.
 */
export function bookHTML(book, { variant = 'card', reveal = false } = {}) {
  const p = book.cover.pal;
  const vars = `--cv-paper:${p.paper};--cv-ink:${p.ink};--cv-accent:${p.accent}`;
  const label = `${book.title} — ${book.author}`;

  const meta = variant === 'solo' ? '' : `
    <div class="book__meta">
      ${badges(book)}
      <h3 class="book__title">${esc(book.title)}</h3>
      <p class="book__author">${esc(book.author)}</p>
      <div class="book__line">
        <span class="book__price">${book.oldPrice ? `<s>${money(book.oldPrice)}</s>` : ''}${money(book.price)}</span>
        ${stars(book.rating)}
      </div>
      <div class="book__actions">
        <button class="btn btn--sm btn--ghost" data-act="add" data-id="${esc(book.id)}">${esc(t('book.add'))}</button>
        <button class="btn btn--sm btn--quiet" data-act="wish" data-id="${esc(book.id)}"
                aria-pressed="${inWish(book.id)}" aria-label="${esc(t('book.wish'))}">
          <svg class="btn__icon" viewBox="0 0 24 24" fill="${inWish(book.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6C19 15.4 12 20 12 20Z"/></svg>
        </button>
      </div>
    </div>`;

  return `
    <article class="book${reveal ? ' reveal' : ''}" data-id="${esc(book.id)}" style="${vars}">
      <div class="book__stage">
        <div class="book__body">
          <div class="book__shadow" aria-hidden="true"></div>
          <div class="book__block">
            <div class="book__page">
              <div class="book__folio"><span>${esc(t('book.annotation'))}</span><span class="num">${book.year}</span></div>
              <p class="book__excerpt">${esc(book.blurb)}</p>
              ${colophon(book)}
            </div>
          </div>
          <div class="book__cover">
            <div class="book__face book__face--front">${coverHTML(book)}</div>
            <div class="book__face book__face--inside" data-endpaper="${esc(book.endpaper)}">
              <div class="book__plate">
                <span>READMORE</span>
                <span>Київ · Warszawa</span>
              </div>
            </div>
          </div>
        </div>
        <span class="book__hint" aria-hidden="true">${esc(t('book.details'))}</span>
        <button class="book__trigger" type="button" data-act="open" data-id="${esc(book.id)}"
                aria-expanded="false" aria-label="${esc(label)}"></button>
      </div>
      ${meta}
    </article>`;
}

/* ---------- behaviour ---------- */

let openBook = null;
let lastPointer = 'mouse';
let openAtPointerDown = false;

export function closeOpenBook() {
  if (!openBook) return;
  openBook.classList.remove('is-open');
  openBook.querySelector('.book__trigger')?.setAttribute('aria-expanded', 'false');
  openBook.closest('.shelf, .rail')?.classList.remove('is-browsing');
  openBook = null;
}

/* The cover swings a full width to the left, so a book near either edge
   of the grid would open off-screen. Solve for the shift that keeps the
   whole spread inside its container, and fall back to the CSS default. */
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

  /* Measured against the rendered spread: with the cover hinged at 154°
     and lifted toward the viewer, it reaches about 0.94 of a scaled width
     past the body's left edge. REACH folds in the body's own half-width. */
  const REACH = 1.45;
  const minX = pad - left - W / 2 + REACH * W * S;
  const maxX = (frameW - pad) - left - W / 2 - 0.5 * W * S;
  const wanted = 0.45 * W;

  const x = minX > maxX ? (minX + maxX) / 2 : Math.min(Math.max(wanted, minX), maxX);
  book.style.setProperty('--open-x', `${Math.round(x)}px`);
}

export function openOne(book) {
  if (openBook === book) return;
  closeOpenBook();
  placeSpread(book);
  book.classList.add('is-open');
  book.querySelector('.book__trigger')?.setAttribute('aria-expanded', 'true');
  book.closest('.shelf, .rail')?.classList.add('is-browsing');
  openBook = book;
}

function tilt(book, e) {
  if (calm() || !fine()) return;
  const stage = book.querySelector('.book__stage');
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  stage.style.setProperty('--ty', `${(x * 8).toFixed(2)}deg`);
  stage.style.setProperty('--tx', `${(-y * 5).toFixed(2)}deg`);
}

function untilt(book) {
  const stage = book.querySelector('.book__stage');
  if (!stage) return;
  stage.style.setProperty('--ty', '0deg');
  stage.style.setProperty('--tx', '0deg');
}

/**
 * Wire a container of books. Delegated, so re-rendering the shelf
 * needs no re-binding. `onDetails` receives the book id when an
 * already-open book is activated.
 */
export function mountBooks(root, { onDetails } = {}) {
  if (!root || root.dataset.booksMounted) return;
  root.dataset.booksMounted = '1';

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (!book || !root.contains(book)) return;
    openOne(book);
  });

  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (!book) return;
    if (book.contains(e.relatedTarget)) return;
    untilt(book);
    if (openBook === book) closeOpenBook();
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const book = e.target.closest('.book');
    if (book) tilt(book, e);
  }, { passive: true });

  /* Tap: the first one opens the book, the second asks for the full
     record. A mouse has already opened it by hovering, so its click
     goes straight to the record. Focus opens it for the keyboard, which
     is why the state is read at pointerdown — before focus moves. */
  root.addEventListener('pointerdown', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    lastPointer = e.pointerType || 'mouse';
    openAtPointerDown = trigger.closest('.book')?.classList.contains('is-open') ?? false;
  }, true);

  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    const book = trigger.closest('.book');
    if (!book) return;
    e.preventDefault();

    const viaKeyboard = e.detail === 0;
    const wantsRecord = viaKeyboard || lastPointer === 'mouse' || openAtPointerDown;

    if (wantsRecord && book.classList.contains('is-open')) {
      onDetails?.(trigger.dataset.id, book);
    } else {
      openOne(book);
      if (lastPointer !== 'mouse') {
        book.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
      }
    }
  });

  /* Keyboard: focus reveals, Enter or Space opens the record. */
  root.addEventListener('focusin', (e) => {
    const book = e.target.closest('.book');
    if (book && e.target.matches('.book__trigger')) openOne(book);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeOpenBook();
  });
}

/* Keep an open spread in frame when the viewport changes under it. */
let resizeTimer;
window.addEventListener('resize', () => {
  if (!openBook) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => openBook && placeSpread(openBook), 120);
});

/* A book left open by touch closes when the reader taps elsewhere. */
document.addEventListener('pointerdown', (e) => {
  if (!openBook) return;
  if (e.pointerType === 'mouse') return;
  const target = e.target.closest('.book');
  if (target !== openBook) closeOpenBook();
}, true);

/* ============================================================
   RIDMORE — the book object
   One component, two behaviours:
     turn  — the shelf. Pointing at a book turns it toward the
             reader and returns its colour; its neighbours fall
             to grey. A second activation opens the record.
     open  — hero and record. The cover swings on its spine to
             show the endpaper and the first page.
   Mouse hovers, a finger taps, the keyboard focuses.
   ============================================================ */

import { coverHTML, backHTML, endpaperSVG, deviceSVG, esc } from './covers.js';
import { money, price, inWish } from './store.js';
import { t } from './i18n.js';

export const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function badges(book) {
  const out = [];
  if (book.badge) out.push(`<span class="badge badge--${book.badge}">${esc(t('badge.' + book.badge))}</span>`);
  if (book.salePriceEUR != null || book.salePriceUAH != null) out.push(`<span class="badge badge--sale">${esc(t('badge.sale'))}</span>`);
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
  /* 'hero' is 'open' plus the leaves that turn on arrival (§7). */
  const hero = mode === 'hero';
  const open = hero || mode === 'open';

  const inside = open ? `
    <div class="book__face book__face--inside">
      ${endpaperSVG(book.endpaper, book.id)}
      <div class="book__plate"><span>RIDMORE</span><span>Київ · Warszawa</span></div>
    </div>` : '';

  const page = open ? `
    <div class="book__page">
      <div class="book__folio"><span>${esc(t('book.annotation'))}</span><span class="num">${book.year}</span></div>
      <p class="book__excerpt">${esc(book.blurb)}</p>
      ${deviceSVG()}
      ${colophon(book)}
    </div>` : '';

  /* The leaves only exist where they are used. Each is a real sheet with two
     faces, hinged on the spine, so a half-turned page shows its verso rather
     than a mirror of its recto. Five is enough to read as a riffle and cheap
     enough for a phone. */
  const leaves = hero ? `
    <div class="book__leaves" aria-hidden="true">${
      Array.from({ length: 5 }, (_, i) => `
        <div class="book__leaf" style="--i:${i}">
          <div class="book__leafFace book__leafFace--recto"></div>
          <div class="book__leafFace book__leafFace--verso"></div>
        </div>`).join('')
    }</div>` : '';

  const card = open ? '' : `
    <div class="book__card">
      ${badges(book)}
      <h3 class="book__title">${esc(book.title)}</h3>
      <p class="book__author">${esc(book.author)}</p>
      <div class="book__line">
        <span class="book__price">${(() => { const p = price(book); return `${p.was ? `<s>${money(p.was)}</s>` : ''}<span class="${p.was ? 'is-now' : ''}">${money(p.amount)}</span>`; })()}</span>
        ${stars(book.rating)}
      </div>
      <div class="book__actions">
        <button class="btn btn--sm btn--ink" data-act="add" data-id="${esc(book.id)}">${esc(t('book.add'))}</button>
        <button class="btn btn--sm btn--ghost btn--icon" data-act="wish" data-id="${esc(book.id)}"
                aria-pressed="${inWish(book.id)}" aria-label="${esc(t('book.wish'))}">${heart(inWish(book.id))}</button>
      </div>
    </div>`;

  return `
    <article class="book book--${open ? 'open' : 'turn'}${hero ? ' book--hero' : ''}" data-id="${esc(book.id)}" style="${vars}">
      <div class="book__head">
      <div class="book__shadow" aria-hidden="true"></div>
      <div class="book__stage">
        <div class="book__body">
          <div class="book__back" aria-hidden="true">${
            book.cover.back
              ? `<img src="${esc(book.cover.back)}" alt="" draggable="false">`
              : backHTML(book)
          }</div>
          <div class="book__spine" aria-hidden="true"></div>
          <div class="book__edge" aria-hidden="true"></div>
          <div class="book__block">${page}</div>
          ${leaves}
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

/**
 * Put a book on one of its three faces. Used where the reader chooses
 * what to look at rather than pointing at it: the record's view switch.
 *   front  — closed, the artwork forward
 *   spread — the cover swung open on its spine
 *   back   — turned right around, the back board forward
 */
export function setBookView(book, view) {
  if (!book) return;
  if (active && active !== book) closeOpenBook();
  book.classList.add('is-active');
  book.classList.toggle('is-flipped', view === 'back');
  book.classList.toggle('is-cover', view === 'front');
  if (view === 'spread') {
    placeSpread(book);
    book.classList.add('is-open');
  } else {
    book.classList.remove('is-open');
  }
  book.querySelector('.book__trigger')?.setAttribute('aria-expanded', String(view === 'spread'));
  active = book;
}

/**
 * The cursor steers the book a little.
 *
 * A book standing on its own — the hero, the record — gets the full range.
 * On the shelf the range is small on purpose (§8): enough to feel the
 * thickness and catch the spine, not enough to make a grid of covers move
 * about while someone is trying to read it.
 */
function tilt(book, e) {
  if (calm() || !fine()) return;
  const stage = book.querySelector('.book__stage');
  if (!stage) return;

  const solo = book.classList.contains('book--solo');
  const onShelf = !solo && !!book.closest('.shelf, .rail');
  if (!solo && !onShelf) return;

  const styles = getComputedStyle(book);
  /* Both ranges come from custom properties, so the hero — which is
     already laid back 44° — can ask for a gentler one without a second
     code path. */
  const range = solo
    ? {
        y: Number(styles.getPropertyValue('--tilt-solo-y')) || 17,
        x: Number(styles.getPropertyValue('--tilt-solo-x')) || 10
      }
    : {
        y: Number(styles.getPropertyValue('--tilt-shelf-y')) || 13,
        x: Number(styles.getPropertyValue('--tilt-shelf-x')) || 6
      };

  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  stage.style.setProperty('--ty', `${(x * range.y).toFixed(2)}deg`);
  stage.style.setProperty('--tx', `${(-y * range.x).toFixed(2)}deg`);
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

  /* A finger behaves like a cursor, with one rule a cursor does not need:
     the book turns only once the finger has RESTED on it. A flick that
     starts on a cover is a scroll, and a scroll must leave the shelf
     still. So the turn waits out HOLD_MS, and any travel, lift, page
     scroll or cancelled gesture in that window calls the whole thing off.
     Held: the book stays turned, and returns the moment the finger lifts.
     Released before the turn: that was a tap, and a tap asks for the
     record. A book that stands alone (hero, record) has nothing behind
     it, so there the same hold simply toggles the spread. */
  const HOLD_MS = 180;   /* a finger must rest this long to mean "turn" */
  const SLOP = 10;       /* px of travel a held finger is still allowed */
  let press = null;

  const dropPress = () => {
    if (!press) return null;
    clearTimeout(press.timer);
    const p = press;
    press = null;
    return p;
  };

  /* the finger moved on, or the page did: no turn, and undo one already
     under way so a scroll never drags an animation along with it */
  const abandon = () => {
    const p = dropPress();
    if (p?.turned && active === p.book) closeOpenBook();
  };

  root.addEventListener('pointerdown', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    lastPointer = e.pointerType || 'mouse';
    if (lastPointer === 'mouse') return;

    const book = trigger.closest('.book');
    if (!book) return;

    abandon();
    const solo = book.classList.contains('book--open');
    press = {
      book, solo,
      at: performance.now(),
      x: e.clientX, y: e.clientY,
      scroll: window.scrollY,
      turned: false,
      timer: 0
    };
    press.timer = setTimeout(() => {
      if (!press) return;
      press.timer = 0;
      press.turned = true;
      if (solo && book.classList.contains('is-active')) closeOpenBook();
      else openOne(book);
    }, HOLD_MS);
  }, true);

  root.addEventListener('pointermove', (e) => {
    if (!press || e.pointerType === 'mouse') return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) abandon();
  }, { passive: true });

  /* iOS hands the gesture to its own scroller without always sending a
     pointermove first; the page moving under the finger says the same */
  window.addEventListener('scroll', () => {
    if (press && Math.abs(window.scrollY - press.scroll) > 4) abandon();
  }, { passive: true });

  const release = (cancelled) => {
    const p = dropPress();
    if (!p) return;
    if (p.turned) {
      /* the spread on a solo book is what the reader came to see: it
         stays until the next tap. On the shelf the book comes back. */
      if (!p.solo && active === p.book) closeOpenBook();
      return;
    }
    if (!cancelled) onDetails?.(p.book.dataset.id, p.book);
  };
  root.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') release(false); }, true);
  root.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'mouse') release(true); }, true);

  /* mouse and keyboard keep the click path: the book is already turned by
     hover or focus, so the click asks for the record */
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-act="open"]');
    if (!trigger) return;
    e.preventDefault();
    const viaKeyboard = e.detail === 0;
    if (!viaKeyboard && lastPointer !== 'mouse') return;

    const book = trigger.closest('.book');
    if (!book) return;
    if (book.classList.contains('is-active')) onDetails?.(trigger.dataset.id, book);
    else openOne(book);
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

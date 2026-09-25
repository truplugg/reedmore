/* ============================================================
   RIDMORE — motion
   Reveals settle content that is already laid out; the hero book
   performs the interaction once on load so it teaches itself.
   ============================================================ */

import { openOne, fine, calm } from './book3d.js';
import { t } from './i18n.js';

export function initReveals() {
  const items = document.querySelectorAll('.reveal:not(.is-in)');
  if (calm() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  /* anything already in frame is shown at once — the reveal is for
     sections the reader scrolls down to, never for the first screen */
  items.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('is-in');
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const delay = Math.min(i * 55, 280);
      setTimeout(() => el.classList.add('is-in'), delay);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

  items.forEach((el) => { if (!el.classList.contains('is-in')) io.observe(el); });

  /* failsafe: nothing stays invisible, whatever the observer does */
  setTimeout(() => document.querySelectorAll('.reveal:not(.is-in)').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 1.3) el.classList.add('is-in');
  }), 1200);
}

/* ------------------------------------------------------------------
   A drifting rail.

   Both the band of words and the shelf of new arrivals move the same
   way, so they share one mechanism. One number — offset, in pixels —
   is the whole thing. Every frame it advances, and everything the rail
   draws is derived from it in the same paint, so nothing can fall out
   of step with anything else.

   It is deliberately not a native scroller. Handing the drift to
   scrollLeft means fighting the platform for the same number, and on a
   phone the scroll event lands late enough for a companion layer — the
   band's embroidery — to visibly lag. Dragging is ours instead:
   touch-action keeps vertical swipes with the page, a drag moves the
   offset directly, and letting go leaves a fling that decays back into
   the drift, so the rail carries on the moment the finger stops.
   ------------------------------------------------------------------ */

export function initDriftRail({
  root, track, group,
  speed = 30,
  /** Extra work per frame, given the raw offset — the band's trim uses it. */
  paint = null,
  /** Called when a drag was real, so a click can be swallowed. */
  suppressClickAfter = 6,
  pauseWhile = null
} = {}) {
  if (!root || !track || !group) return;

  let span = 0;          /* width of one copy, including the gap after it */
  let offset = 0;
  let fling = 0;         /* what a released drag left behind, px/s */
  let drag = null;
  let onScreen = true;
  let dragged = 0;

  const mod = (n, m) => (m > 0 ? ((n % m) + m) % m : 0);

  const apply = () => {
    root.style.setProperty('--rail-x', mod(offset, span).toFixed(2));
    paint?.(offset);
  };

  /* Enough copies that the window never looks past the end. */
  const stock = () => {
    if (!span) return;
    const need = Math.ceil(root.clientWidth / span) + 2;
    while (track.children.length < need) {
      const copy = group.cloneNode(true);
      copy.classList.add('is-echo');
      copy.setAttribute('aria-hidden', 'true');
      copy.querySelectorAll('button, a, input').forEach((el) => { el.tabIndex = -1; });
      track.append(copy);
    }
  };

  const measure = () => {
    const rect = group.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    span = rect.width + gap;
    stock();
    apply();
  };

  /* ---- dragging ---- */
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, from: offset, at: performance.now(), vx: 0 };
    dragged = 0;
    fling = 0;
    root.classList.add('is-dragging');
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    dragged = Math.max(dragged, Math.abs(dx));
    /* Capture only once it is clearly a drag, so a tap on a book still
       reaches the book. */
    if (dragged > 3 && root.setPointerCapture) {
      try { root.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    }
    const next = drag.from - dx;
    const t = performance.now();
    const dt = (t - drag.at) / 1000;
    if (dt > 0) drag.vx = (next - offset) / dt;
    drag.at = t;
    offset = next;
    apply();
    if (dragged > 3) e.preventDefault();
  });

  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    try { root.releasePointerCapture?.(drag.id); } catch { /* already gone */ }
    fling = Math.max(-2600, Math.min(2600, drag.vx));
    drag = null;
    root.classList.remove('is-dragging');
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag());

  /* A drag that ends on a book must not also open it. */
  root.addEventListener('click', (e) => {
    if (dragged > suppressClickAfter) { e.stopPropagation(); e.preventDefault(); dragged = 0; }
  }, true);

  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(group);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }).observe(root);
  }

  measure();
  requestAnimationFrame(measure);   /* again once webfonts have settled */

  if (calm()) return;               /* still draggable, just never by itself */

  let last = 0;
  const tick = (nowMs) => {
    requestAnimationFrame(tick);
    const dt = last ? Math.min((nowMs - last) / 1000, 0.064) : 0;
    last = nowMs;
    if (!dt || drag || !onScreen || document.hidden) return;

    /* A pause stops the steady drift but never a fling. Letting go of a drag
       with the cursor still resting on the rail would otherwise freeze it
       dead on release, which reads as the drag having broken something. */
    const paused = pauseWhile?.() ?? false;
    if (paused && fling === 0) return;

    offset += ((paused ? 0 : speed) + fling) * dt;
    fling *= Math.exp(-4.2 * dt);
    if (Math.abs(fling) < 1) fling = 0;
    apply();
  };
  requestAnimationFrame(tick);
}

const BAND_TILE = 16;    /* one stitch of the trim, in px */

export function initBand() {
  const band = document.querySelector('.band');
  const rail = band?.querySelector('.band__rail');
  const track = rail?.querySelector('.band__track');
  const group = track?.querySelector('.band__group');
  if (!band || !rail || !track || !group) return;

  initDriftRail({
    root: rail, track, group, speed: 34,
    /* The embroidery takes the same offset modulo one stitch, written in
       the same paint, so it cannot drift away from the words. */
    paint: (offset) => {
      const x = ((offset % BAND_TILE) + BAND_TILE) % BAND_TILE;
      band.style.setProperty('--stitch-x', x.toFixed(2));
    }
  });
}

/** The shelf of new arrivals moves like the band, and can be dragged. */
export function initRail() {
  const rail = document.getElementById('rail');
  const track = rail?.querySelector('.rail__track');
  const group = track?.querySelector('.rail__group');
  if (!rail || !track || !group) return;

  initDriftRail({
    root: rail, track, group, speed: 22,
    /* A book turning under the cursor is being looked at; the shelf waits. */
    pauseWhile: () => rail.matches(':hover, :focus-within') || rail.classList.contains('is-browsing')
  });
}

/* ------------------------------------------------------------------
   The hero book (§7).

   Closed, it arrives; the board swings on its spine; a few leaves go
   over the gutter; it stays open. It runs on every visit, because that
   performance is what the page is for — but it is also the heaviest
   thing on the first screen, so it waits for the browser to have drawn
   everything else, skips itself entirely when the reader has asked for
   less motion, and drops the leaves on a device that cannot afford
   them rather than dropping the book.
   ------------------------------------------------------------------ */

/** Roughly, can this device afford five animated leaves? */
function canAffordLeaves() {
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;
  const saveData = navigator.connection?.saveData === true;
  return !saveData && cores >= 4 && memory >= 3;
}

/** Wait for the first idle moment after paint, so the animation never
 *  competes with the page still laying itself out. */
function whenIdle(fn, timeout = 900) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 180);
}

export function initHero() {
  const book = document.querySelector('.hero__book .book');
  const caption = document.getElementById('hero-hint');
  if (caption) caption.textContent = fine() ? t('hero.hint') : t('hero.hintTouch');
  if (!book) return;

  const leaves = book.querySelectorAll('.book__leaf').length;

  /* Asked for less motion: the book is simply already open. No arrival,
     no swing, no leaves — but still the book, not a placeholder. */
  if (calm()) {
    book.classList.add('is-arrived', 'is-settled');
    openOne(book);
    return;
  }

  if (leaves && !canAffordLeaves()) book.classList.add('is-settled');

  whenIdle(() => {
    requestAnimationFrame(() => book.classList.add('is-arrived'));

    /* The board swings once the book has arrived, and the leaves start
       once the board is out of their way. */
    const openAt = setTimeout(() => {
      openOne(book);

      if (!leaves || book.classList.contains('is-settled')) return;

      const startAt = setTimeout(() => {
        book.classList.add('is-turning');

        /* Settle when the last leaf lands. Driven by animationend on that
           leaf, with a timer behind it in case the tab was hidden through
           the whole thing and the event never came. */
        const last = book.querySelector('.book__leaf:last-child');
        const settle = () => {
          book.classList.remove('is-turning');
          book.classList.add('is-settled');
        };
        last?.addEventListener('animationend', settle, { once: true });
        const styles = getComputedStyle(book);
        const ms = (n) => parseFloat(styles.getPropertyValue(n)) || 0;
        setTimeout(settle, ms('--leaf-ms') + ms('--leaf-gap') * leaves + 400);
      }, 780);   /* let the board get clear of the stack first */
      book.addEventListener('ridmore:cancel-hero', () => clearTimeout(startAt), { once: true });
    }, 420);

    book.addEventListener('ridmore:cancel-hero', () => clearTimeout(openAt), { once: true });
  });
}

/* ------------------------------------------------------------------
   Figures count to their real value once, when they come into view.
   Anything that is not a single number — a range like 3–7 — is left
   alone, because counting to half of it would be a lie.
   ------------------------------------------------------------------ */
const NUM = /^([^\d]*)(\d[\d\s  ]*(?:[.,]\d+)?)([^\d]*)$/;

function countUp(el) {
  const m = el.textContent.trim().match(NUM);
  if (!m) return;
  const [, pre, digits, post] = m;
  const decimals = /[.,]/.test(digits) ? 1 : 0;
  const target = parseFloat(digits.replace(/[\s  ]/g, '').replace(',', '.'));
  if (!isFinite(target) || target <= 0) return;

  let fmt;
  try {
    fmt = new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
  } catch { fmt = { format: (n) => n.toFixed(decimals) }; }

  const dur = 1150;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = pre + fmt.format(target * eased) + post;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initCounters() {
  const els = document.querySelectorAll('.figure__n:not([data-counted])');
  if (!els.length) return;
  if (calm() || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.setAttribute('data-counted', '1'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.setAttribute('data-counted', '1');
      countUp(entry.target);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  els.forEach((el) => io.observe(el));
}

/* The embroidered rule stitches itself in the first time it is seen. */
export function initOrnaments() {
  const rules = document.querySelectorAll('.ornament:not(.is-stitched)');
  if (!rules.length) return;
  if (calm() || !('IntersectionObserver' in window)) {
    rules.forEach((el) => el.classList.add('is-stitched'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-stitched');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.25 });
  rules.forEach((el) => io.observe(el));
}

/* A collection's plate drifts against the scroll while the card is in
   view, which gives the row depth without any of it moving on its own. */
export function initParallax() {
  const cards = [...document.querySelectorAll('.collection')];
  if (!cards.length || calm()) return;

  let ticking = false;
  const frame = () => {
    const vh = window.innerHeight;
    cards.forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const centre = (r.top + r.height / 2 - vh / 2) / vh;   /* -1 … 1 */
      card.querySelector('.collection__art')
        ?.style.setProperty('--art-y', `${(centre * 26).toFixed(1)}px`);
    });
    ticking = false;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();
}

/** Number the children of an overlay so they can arrive in order. */
export function stagger(root, selector) {
  root?.querySelectorAll(selector).forEach((el, i) => {
    el.style.setProperty('--in-i', String(Math.min(i, 9)));
  });
}

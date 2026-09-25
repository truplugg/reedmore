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
  /** Layers that must move in lockstep, each with its own repeat length. */
  companions = [],
  suppressClickAfter = 6,
  pauseWhile = null
} = {}) {
  if (!root || !track || !group) return;

  /* The drift is a real Animation, not a transform written every frame.
     A custom property or a style write goes through the main thread, and a
     rail of forty 3D books cost half its frames that way — measured at 33ms
     between frames, against 16.7 when it stood still. An Animation of a
     transform runs on the compositor, so the drift costs the page nothing;
     the main thread only gets involved while a finger is actually on it. */
  let span = 0;
  let anim = null;
  const extra = [];        /* {el, anim, tile} */
  let drag = null;
  let dragged = 0;
  let hovered = false;
  let fling = 0;

  const build = () => {
    const rect = group.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const next = rect.width + gap;
    if (!next || Math.abs(next - span) < 0.5) return;
    span = next;

    /* Enough copies that the window never looks past the end, and not one
       more: the loop resets every span, so the widest it can reach is span
       plus the rail's own width. */
    const need = Math.max(2, Math.ceil((root.clientWidth + span) / span));
    while (track.children.length < need) {
      const copy = group.cloneNode(true);
      copy.classList.add('is-echo');
      copy.setAttribute('aria-hidden', 'true');
      copy.querySelectorAll('button, a, input').forEach((el) => { el.tabIndex = -1; });
      track.append(copy);
    }

    const was = anim?.currentTime ?? 0;
    anim?.cancel();
    extra.forEach((c) => c.anim?.cancel());
    extra.length = 0;

    const loop = (el, distance) => el.animate(
      [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-distance}px,0,0)` }],
      { duration: (distance / speed) * 1000, iterations: Infinity, easing: 'linear' }
    );

    anim = loop(track, span);
    anim.currentTime = was;

    /* Every companion is a separate Animation, but they all run on one
       clock at one rate and are scrubbed from one number, so the band's
       embroidery cannot drift away from its words. */
    for (const c of companions) {
      const a = loop(c.el, c.tile);
      a.currentTime = was % ((c.tile / speed) * 1000);
      extra.push({ ...c, anim: a });
    }
    if (calm()) { anim.pause(); extra.forEach((c) => c.anim.pause()); }
  };

  const allAnims = () => [anim, ...extra.map((c) => c.anim)].filter(Boolean);

  /** Scrub every layer from one offset in pixels. */
  const seek = (px) => {
    if (!anim) return;
    const ms = (px / speed) * 1000;
    anim.currentTime = ((ms % anim.effect.getTiming().duration) + anim.effect.getTiming().duration)
      % anim.effect.getTiming().duration;
    for (const c of extra) {
      const d = c.anim.effect.getTiming().duration;
      c.anim.currentTime = ((ms % d) + d) % d;
    }
  };

  const offsetPx = () => (anim ? (Number(anim.currentTime) / 1000) * speed : 0);

  const play = () => { if (!calm()) allAnims().forEach((a) => a.play()); };
  const hold = () => allAnims().forEach((a) => a.pause());

  /* ---- hover: a reader pointing at a book, which is not the same event
     as a page scrolling under a cursor that never moved.

     pointerenter fires for both. A reader who simply scrolled past the
     shelf, pointer parked mid-screen as it always is on a laptop, had the
     rail stop and start five times in one gesture and finish stopped —
     measured. That stutter was the whole complaint.

     So a hover has to be earned: the pointer must actually have moved,
     and not while the page itself is moving. Entering counts for nothing.
     Keyboard focus is deliberate by definition, so it still stops the
     rail outright. ---- */
  const point = { x: null, y: null };
  let scrolling = false;
  let scrollEnd = 0;

  const pointOn = () => { if (!hovered) { hovered = true; hold(); } };
  const pointOff = () => { if (hovered) { hovered = false; if (!drag) play(); } };

  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const moved = point.x !== null && (e.clientX !== point.x || e.clientY !== point.y);
    point.x = e.clientX;
    point.y = e.clientY;
    if (moved && !scrolling) pointOn();
  }, { passive: true });

  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    point.x = null;
    point.y = null;
    pointOff();
  });

  window.addEventListener('scroll', () => {
    scrolling = true;
    pointOff();                 /* the page moved, the reader did not */
    clearTimeout(scrollEnd);
    scrollEnd = setTimeout(() => { scrolling = false; }, 160);
  }, { passive: true });

  root.addEventListener('focusin', () => { hovered = true; hold(); });
  root.addEventListener('focusout', () => { hovered = false; if (!drag) play(); });

  /* ---- dragging ---- */
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !anim) return;
    hold();
    drag = { id: e.pointerId, x: e.clientX, from: offsetPx(), at: performance.now(), vx: 0 };
    dragged = 0;
    fling = 0;
    root.classList.add('is-dragging');
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    dragged = Math.max(dragged, Math.abs(dx));
    if (dragged > 3) {
      try { root.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      e.preventDefault();
    }
    const next = drag.from - dx;
    const t = performance.now();
    const dt = (t - drag.at) / 1000;
    if (dt > 0) drag.vx = (next - offsetPx()) / dt;
    drag.at = t;
    seek(next);
  });

  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    try { root.releasePointerCapture?.(drag.id); } catch { /* already gone */ }
    fling = Math.max(-2600, Math.min(2600, drag.vx));
    drag = null;
    root.classList.remove('is-dragging');
    coast();
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag());

  /**
   * What the finger left behind, spent as playback rate rather than as
   * per-frame transforms: still the compositor's job, and it decays back
   * to the resting drift. A fling always plays out, even while hovering —
   * freezing dead on release reads as the drag having broken something.
   */
  function coast() {
    if (calm() || !anim) return;
    let rate = 1 + fling / speed;
    if (!Number.isFinite(rate)) rate = 1;
    let last = 0;

    const step = (t) => {
      const dt = last ? Math.min((t - last) / 1000, 0.064) : 0;
      last = t;
      if (drag) return;                       /* a new drag took over */
      rate = 1 + (rate - 1) * Math.exp(-4.2 * dt);
      const settled = Math.abs(rate - 1) < 0.05;
      allAnims().forEach((a) => { a.playbackRate = settled ? 1 : rate; });
      if (!settled) { play(); requestAnimationFrame(step); return; }
      if (hovered || pauseWhile?.()) hold(); else play();
    };
    play();
    requestAnimationFrame(step);
  }

  /* A drag that ends on a book must not also open it. */
  root.addEventListener('click', (e) => {
    if (dragged > suppressClickAfter) { e.stopPropagation(); e.preventDefault(); dragged = 0; }
  }, true);

  if ('ResizeObserver' in window) new ResizeObserver(build).observe(group);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      /* Off screen it costs nothing to stop, and nothing is missed. */
      if (entry.isIntersecting) { if (!hovered && !drag && !pauseWhile?.()) play(); }
      else hold();
    }).observe(root);
  }

  /* The component may pause it too — a book open on the shelf, say. */
  if (pauseWhile) {
    const watch = new MutationObserver(() => {
      if (drag) return;
      if (pauseWhile()) hold(); else if (!hovered) play();
    });
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  build();
  requestAnimationFrame(build);   /* again once webfonts have settled */
}

const BAND_TILE = 16;    /* one stitch of the trim, in px */

export function initBand() {
  const band = document.querySelector('.band');
  const rail = band?.querySelector('.band__rail');
  const track = rail?.querySelector('.band__track');
  const group = track?.querySelector('.band__group');
  if (!band || !rail || !track || !group) return;

  /* The trim repeats every stitch, the words every copy of the group. Two
     lengths, one clock, one scrub — so they cannot part. */
  const companions = [...band.querySelectorAll('.band__stitch-svg')]
    .map((el) => ({ el, tile: BAND_TILE }));

  initDriftRail({ root: rail, track, group, speed: 34, companions });
}

/** The shelf of new arrivals moves like the band, and can be dragged. */
export function initRail() {
  const rail = document.getElementById('rail');
  const track = rail?.querySelector('.rail__track');
  const group = track?.querySelector('.rail__group');
  if (!rail || !track || !group) return;

  initDriftRail({
    root: rail, track, group, speed: 22,
    /* A book turning under the cursor is being looked at; the shelf waits.
       Hover is the rail's own business; this is the class the book
       component sets while one is open. */
    pauseWhile: () => rail.classList.contains('is-browsing')
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

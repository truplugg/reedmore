/* ============================================================
   READMORE — motion
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

/** The marquee needs its content twice so the loop has no seam. */
export function initMarquee() {
  const track = document.querySelector('.band__track');
  if (!track) return;
  const group = track.querySelector('.band__group');
  if (group && track.children.length === 1) track.append(group.cloneNode(true));
}

/** Open the hero book once, so the reader sees what a cover does. */
export function initHero() {
  const hero = document.querySelector('.hero__book .book');
  const caption = document.getElementById('hero-hint');
  if (caption) caption.textContent = fine() ? t('hero.hint') : t('hero.hintTouch');
  if (!hero) return;
  if (calm()) { openOne(hero); return; }
  setTimeout(() => openOne(hero), 850);
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

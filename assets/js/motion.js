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

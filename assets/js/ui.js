/* ============================================================
   READMORE — shell: header, theme, language, currency, toasts
   ============================================================ */

import { get, set, subscribe, CURRENCIES } from './store.js';
import { setLang, applyI18n, t, LANGS } from './i18n.js';

/* ---------- toasts ---------- */
let stack;
export function clearToasts() {
  if (!stack) stack = document.getElementById('toasts');
  stack?.replaceChildren();
}

export function toast(message, { action } = {}) {
  if (!stack) stack = document.getElementById('toasts');
  if (!stack) return;
  /* the open cart already shows what happened; a toast over it is noise */
  if (document.getElementById('cart')?.classList.contains('is-open')) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast__mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m4 12.5 5 5L20 6.5"/></svg></span><span>${message}</span>${
    action ? `<a href="#" data-toast-action>${action.label}</a>` : ''}`;
  stack.append(el);
  if (action) el.querySelector('[data-toast-action]').addEventListener('click', (e) => {
    e.preventDefault(); action.run(); dismiss();
  });
  const timer = setTimeout(dismiss, 3000);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 280);
  }
}

/* ---------- theme ---------- */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

/* ---------- header ---------- */
export function initShell({ onLangChange } = {}) {
  const header = document.querySelector('.header');
  const progress = document.getElementById('progress');
  const totop = document.getElementById('totop');

  applyTheme(get('theme'));
  setLang(get('lang'));
  document.documentElement.lang = get('lang');
  applyI18n();

  /* header state, reading progress and the back-to-top control
     all read the same scroll frame */
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      header?.classList.toggle('is-stuck', y > 8);
      totop?.classList.toggle('is-on', y > 900);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.inlineSize = `${max > 0 ? Math.min(100, (y / max) * 100) : 0}%`;
      }
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  totop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* theme cycle */
  const themeBtn = document.getElementById('theme-toggle');
  themeBtn?.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(get('theme')) + 1) % THEMES.length];
    set('theme', next);
    applyTheme(next);
    themeBtn.dataset.mode = next;
  });
  if (themeBtn) themeBtn.dataset.mode = get('theme');

  /* currency */
  document.querySelectorAll('[data-switch="currency"]').forEach((sel) => {
    sel.innerHTML = Object.keys(CURRENCIES).map((c) =>
      `<option value="${c}"${c === get('currency') ? ' selected' : ''}>${c}</option>`).join('');
    sel.addEventListener('change', () => set('currency', sel.value));
  });

  /* language */
  document.querySelectorAll('[data-switch="lang"]').forEach((sel) => {
    sel.innerHTML = Object.entries(LANGS).map(([code, label]) =>
      `<option value="${code}"${code === get('lang') ? ' selected' : ''}>${label}</option>`).join('');
    sel.addEventListener('change', () => set('lang', sel.value));
  });

  subscribe((what) => {
    if (what === 'lang') {
      setLang(get('lang'));
      document.documentElement.lang = get('lang');
      applyI18n();
      document.querySelectorAll('[data-switch="lang"]').forEach((s) => { s.value = get('lang'); });
      onLangChange?.();
    }
    if (what === 'currency') {
      document.querySelectorAll('[data-switch="currency"]').forEach((s) => { s.value = get('currency'); });
    }
  });

  /* mobile navigation */
  const burger = document.getElementById('burger');
  const mobilenav = document.getElementById('mobilenav');
  const closeNav = () => {
    burger?.setAttribute('aria-expanded', 'false');
    mobilenav?.classList.remove('is-open');
    document.body.classList.remove('is-locked');
  };
  burger?.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!open));
    mobilenav.classList.toggle('is-open', !open);
    document.body.classList.toggle('is-locked', !open);
  });
  mobilenav?.addEventListener('click', (e) => { if (e.target.closest('a')) closeNav(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

  /* newsletter — the only form on the page, so it is handled here */
  document.getElementById('club-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[type="email"]');
    toast(t('club.done'));
    input.value = '';
    input.blur();
  });
}

/* Mark the nav item for the section currently in view. */
export function initSectionSpy() {
  const links = [...document.querySelectorAll('.nav a[href^="#"]')];
  const sections = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.removeAttribute('aria-current'));
      const active = links.find((a) => a.getAttribute('href') === `#${entry.target.id}`);
      active?.setAttribute('aria-current', 'page');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  sections.forEach((s) => spy.observe(s));
}

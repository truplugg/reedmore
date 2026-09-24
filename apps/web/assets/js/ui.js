/* ============================================================
   RIDMORE — shell: header, theme, language, currency, toasts
   ============================================================ */

import { get, set, subscribe, CURRENCIES } from './store.js';
import { setLang, applyI18n, t, LANGS, detectLang, getLang } from './i18n.js';
import { THEMES, DEFAULT_THEME, applyTheme, isDark } from './themes.js';

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

/* ---------- theme ----------
   The site ships six themes (§5, §6) and a reader picks one. The button
   still does the one thing a reader expects a single tap to do — swap
   between the light ground and the dark one — and a long press or the
   caret opens the whole set, seasons included. The stored preference
   starts unset and follows the operating system until someone chooses.  */
const dark = window.matchMedia('(prefers-color-scheme: dark)');

/** Which theme is actually on the page. */
export function renderedTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}
export { isDark };

/** The pair the one-tap switch moves between, honouring a seasonal choice:
 *  from Autumn a tap goes to Midnight and back to Autumn, not to Paper. */
function counterpart(key) {
  if (isDark(key)) return sessionStorage.getItem('ridmore.lastLight') || 'paper';
  try { sessionStorage.setItem('ridmore.lastLight', key); } catch { /* private window */ }
  return 'midnight';
}

function firstTheme() {
  const stored = get('theme');
  if (stored && THEMES[stored]) return stored;
  return dark.matches ? 'midnight' : 'paper';
}

/**
 * Wire the header's theme control: a button that swaps light and dark, and
 * a menu behind it holding all six.
 */
export function initThemeToggle(btn) {
  if (!btn) return;
  const menu = document.getElementById('theme-menu');

  const paint = () => {
    const now = renderedTheme();
    const lang = getLang();
    btn.dataset.mode = isDark(now) ? 'dark' : 'light';
    const label = isDark(now) ? t('a11y.themeLight') : t('a11y.themeDark');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', `${THEMES[now].name[lang] ?? THEMES[now].name.en} — ${label}`);
    btn.setAttribute('aria-pressed', String(isDark(now)));
    if (!menu) return;
    menu.querySelectorAll('[data-theme-key]').forEach((el) => {
      el.setAttribute('aria-checked', String(el.dataset.themeKey === now));
      const name = THEMES[el.dataset.themeKey]?.name;
      const text = el.querySelector('.themeopt__name');
      if (name && text) text.textContent = name[lang] ?? name.en;
    });
  };

  const pick = (key) => { set('theme', key); applyTheme(key); paint(); };

  applyTheme(firstTheme());
  paint();

  btn.addEventListener('click', (e) => {
    if (e.shiftKey || e.altKey) { toggleMenu(); return; }
    pick(counterpart(renderedTheme()));
  });

  /* A press and hold, or the caret, opens the full set. */
  let holdTimer = 0;
  btn.addEventListener('pointerdown', () => {
    holdTimer = window.setTimeout(() => { holdTimer = 0; toggleMenu(); }, 420);
  });
  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } };
  btn.addEventListener('pointerup', clearHold);
  btn.addEventListener('pointerleave', clearHold);
  btn.addEventListener('pointercancel', clearHold);

  function toggleMenu(force) {
    if (!menu) return;
    const open = force ?? menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('[aria-checked="true"]')?.focus();
  }

  document.getElementById('theme-more')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

  menu?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-theme-key]');
    if (!opt) return;
    pick(opt.dataset.themeKey);
    toggleMenu(false);
    btn.focus();
  });

  document.addEventListener('click', (e) => {
    if (!menu || menu.hidden) return;
    if (e.target.closest('#theme-menu, #theme-toggle, #theme-more')) return;
    toggleMenu(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });

  /* while nothing has been chosen, keep following the operating system */
  const onSystem = () => { if (!get('theme')) { applyTheme(dark.matches ? 'midnight' : 'paper'); paint(); } };
  dark.addEventListener ? dark.addEventListener('change', onSystem) : dark.addListener(onSystem);

  subscribe((what) => { if (what === 'lang') paint(); });
}

/* ---------- header ---------- */
export function initShell({ onLangChange } = {}) {
  const header = document.querySelector('.header');
  const progress = document.getElementById('progress');
  const totop = document.getElementById('totop');

  setLang(get('lang'));
  document.documentElement.lang = get('lang');

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

  /* ----------------------------------------------------------------
     First visit: take the language from the browser, and a first
     currency from that language. Both are only an opening guess — the
     moment the reader picks either one it is stored, and their choice
     wins from then on, in any combination (§3, §4). A reader in Berlin
     may read in Ukrainian and pay in euro, or the other way round.
     ---------------------------------------------------------------- */
  if (!get('lang')) set('lang', detectLang());
  if (!get('currency')) set('currency', get('lang') === 'uk' ? 'UAH' : 'EUR');
  if (!get('country')) set('country', get('lang') === 'uk' ? 'ua' : 'de');
  setLang(get('lang'));
  document.documentElement.lang = get('lang');
  applyI18n();          /* the markup ships in Ukrainian; swap it before paint */

  initThemeToggle(document.getElementById('theme-toggle'));

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
      /* A currency switch changes which price column is read, so every
         price on the page has to be drawn again. */
      onLangChange?.();
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

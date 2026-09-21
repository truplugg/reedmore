/* ============================================================
   READMORE — catalogue: search, filters, sort, paging
   Filter state lives in the URL, so a filtered shelf is a link
   you can send to someone.
   ============================================================ */

import { BOOKS, GENRES, FORMATS } from './data/books.js';
import { bookHTML, mountBooks, closeOpenBook } from './book3d.js';
import { t, getLang } from './i18n.js';
import { esc } from './covers.js';
import { get, set, inWish, subscribe } from './store.js';

const PAGE = 12;

const state = {
  q: '',
  genres: new Set(),
  formats: new Set(),
  sort: 'pop',
  onlyWish: false,
  limit: PAGE
};

let els = {};
let onDetails = null;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’'`ʼ]/g, '');

function matches(book) {
  if (state.onlyWish && !inWish(book.id)) return false;
  if (state.genres.size && !state.genres.has(book.genre)) return false;
  if (state.formats.size && !state.formats.has(book.format)) return false;
  if (!state.q) return true;
  const q = norm(state.q);
  const hay = norm([
    book.title, book.titleEn, book.author, book.authorEn,
    book.publisher, book.isbn, book.tags.join(' '),
    GENRES.find((g) => g.id === book.genre)?.ua
  ].join(' '));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

const SORTS = {
  pop: (a, b) => (b.rating * Math.log(b.reviews + 2)) - (a.rating * Math.log(a.reviews + 2)),
  new: (a, b) => b.year - a.year,
  priceUp: (a, b) => a.price - b.price,
  priceDown: (a, b) => b.price - a.price,
  title: (a, b) => a.title.localeCompare(b.title, 'uk')
};

export function filtered() {
  return BOOKS.filter(matches).sort(SORTS[state.sort] || SORTS.pop);
}

/* ---------- URL <-> state ---------- */
function toURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.genres.size) p.set('g', [...state.genres].join(','));
  if (state.formats.size) p.set('f', [...state.formats].join(','));
  if (state.sort !== 'pop') p.set('s', state.sort);
  if (state.onlyWish) p.set('w', '1');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

function fromURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.sort = SORTS[p.get('s')] ? p.get('s') : 'pop';
  (p.get('g') || '').split(',').filter(Boolean).forEach((g) => state.genres.add(g));
  (p.get('f') || '').split(',').filter(Boolean).forEach((f) => state.formats.add(f));
  state.onlyWish = p.get('w') === '1';
}

/* ---------- rendering ---------- */
function renderChips() {
  const lang = getLang();
  const count = (pred) => BOOKS.filter(pred).length;

  els.genres.innerHTML = [
    `<button class="chip" data-kind="genre" data-value="" aria-pressed="${state.genres.size === 0}">${esc(t('cat.all'))} <span class="chip__n num">${BOOKS.length}</span></button>`,
    ...GENRES.map((g) => `<button class="chip" data-kind="genre" data-value="${esc(g.id)}" aria-pressed="${state.genres.has(g.id)}">${esc(lang === 'en' ? g.en : g.ua)} <span class="chip__n num">${count((b) => b.genre === g.id)}</span></button>`)
  ].join('');

  els.formats.innerHTML = FORMATS.map((f) =>
    `<button class="chip" data-kind="format" data-value="${esc(f.id)}" aria-pressed="${state.formats.has(f.id)}">${esc(lang === 'en' ? f.en : f.ua)} <span class="chip__n num">${count((b) => b.format === f.id)}</span></button>`
  ).join('');
}

export function render() {
  closeOpenBook();
  const list = filtered();
  const shown = list.slice(0, state.limit);

  els.shelf.className = `shelf shelf--${get('view') === 'list' ? 'list' : 'wide'}`;

  els.shelf.innerHTML = shown.length
    ? shown.map((b) => bookHTML(b)).join('')
    : `<div class="empty">
         <svg class="empty__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 5.5v15"/><path d="m9.5 10.5 5 5m0-5-5 5"/></svg>
         <h3>${esc(t('cat.empty'))}</h3>
         <p class="prose">${esc(t('cat.emptyNote'))}</p>
         <button class="btn btn--ghost" data-act="clear">${esc(t('cat.clear'))}</button>
       </div>`;

  els.count.innerHTML = `${esc(t('cat.found'))} <b class="num">${shown.length}</b> ${esc(t('cat.of'))} <b class="num">${list.length}</b>`;
  const moreWrap = els.more.parentElement;
  moreWrap.hidden = shown.length >= list.length;
  els.clear.hidden = !(state.q || state.genres.size || state.formats.size || state.onlyWish);
  if (els.wish) {
    els.wish.setAttribute('aria-pressed', String(state.onlyWish));
    els.wish.querySelector('.chip__n').textContent = get('wish').length;
  }

  renderChips();
  toURL();
  document.dispatchEvent(new CustomEvent('shelf:rendered'));
}

/* ---------- wiring ---------- */
export function initCatalog(opts = {}) {
  onDetails = opts.onDetails;
  els = {
    shelf: document.getElementById('shelf'),
    search: document.getElementById('catalog-search'),
    clearSearch: document.getElementById('catalog-search-clear'),
    genres: document.getElementById('filter-genres'),
    formats: document.getElementById('filter-formats'),
    sort: document.getElementById('catalog-sort'),
    count: document.getElementById('catalog-count'),
    more: document.getElementById('catalog-more'),
    clear: document.getElementById('catalog-clear'),
    wish: document.getElementById('filter-wish'),
    view: document.getElementById('catalog-view')
  };
  if (!els.shelf) return;

  fromURL();
  els.search.value = state.q;
  els.sort.value = state.sort;
  els.view.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.value === get('view'))));

  let typing;
  els.search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = els.search.value.trim();
      state.limit = PAGE;
      els.clearSearch.hidden = !state.q;
      render();
    }, 140);
  });
  els.clearSearch.hidden = !state.q;
  els.clearSearch.addEventListener('click', () => {
    els.search.value = '';
    state.q = '';
    els.clearSearch.hidden = true;
    render();
    els.search.focus();
  });

  const onChip = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const { kind, value } = chip.dataset;
    const bag = kind === 'genre' ? state.genres : state.formats;
    if (!value) bag.clear();
    else if (bag.has(value)) bag.delete(value);
    else bag.add(value);
    state.limit = PAGE;
    render();
  };
  els.genres.addEventListener('click', onChip);
  els.formats.addEventListener('click', onChip);

  els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });

  els.more.addEventListener('click', () => {
    state.limit += PAGE;
    render();
    requestAnimationFrame(() => {
      els.shelf.querySelectorAll('.book')[state.limit - PAGE]
        ?.querySelector('.book__trigger')?.focus({ preventScroll: true });
    });
  });

  els.wish?.addEventListener('click', () => {
    state.onlyWish = !state.onlyWish;
    state.limit = PAGE;
    render();
  });
  subscribe((what) => { if (what === 'wish' && els.wish) render(); });

  els.clear.addEventListener('click', clearAll);
  els.shelf.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="clear"]')) clearAll();
  });

  els.view.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    set('view', btn.dataset.value);
    els.view.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });

  mountBooks(els.shelf, { onDetails: (id) => onDetails?.(id) });
  render();
}

export function clearAll() {
  state.q = '';
  state.onlyWish = false;
  state.genres.clear();
  state.formats.clear();
  state.limit = PAGE;
  if (els.search) { els.search.value = ''; els.clearSearch.hidden = true; }
  render();
}

/** Jump to the catalogue with one filter applied — used by collections and tags. */
export function applyFilter({ genre, tag, q } = {}) {
  clearAll();
  if (genre) state.genres.add(genre);
  if (tag || q) {
    state.q = tag || q;
    if (els.search) { els.search.value = state.q; els.clearSearch.hidden = false; }
  }
  render();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Header heart: show only saved books, in the catalogue itself. */
export function showWishlist() {
  state.onlyWish = true;
  state.limit = PAGE;
  render();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export const findBook = (id) => BOOKS.find((b) => b.id === id);

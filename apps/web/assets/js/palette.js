/* ============================================================
   RIDMORE — command palette (⌘K / Ctrl-K)
   ============================================================ */

import { BOOKS } from './data/books.js';
import { thumbHTML, esc } from './covers.js';
import { money } from './store.js';
import { t } from './i18n.js';

let box, input, list, active = 0, results = [], onPick = null, lastFocus = null;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’'`ʼ]/g, '');

function search(q) {
  if (!q) return BOOKS.slice(0, 7);
  const needle = norm(q);
  return BOOKS
    .map((b) => {
      const title = norm(b.title);
      const author = norm(b.author);
      let score = 0;
      if (title.startsWith(needle)) score += 100;
      else if (title.includes(needle)) score += 60;
      if (author.includes(needle)) score += 45;
      if (norm(b.titleEn).includes(needle) || norm(b.authorEn).includes(needle)) score += 30;
      if (b.tags.some((x) => norm(x).includes(needle))) score += 20;
      if (norm(b.publisher).includes(needle)) score += 12;
      if (b.isbn.includes(q)) score += 80;
      return { b, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, x) => x.score - a.score)
    .slice(0, 8)
    .map((x) => x.b);
}

function render() {
  if (!results.length) {
    list.innerHTML = `<p class="palette__empty">${esc(t('pal.empty'))}</p>`;
    return;
  }
  list.innerHTML = results.map((b, i) => `
    <button class="palette__item${i === active ? ' is-active' : ''}" data-id="${esc(b.id)}" role="option" aria-selected="${i === active}">
      ${thumbHTML(b)}
      <span style="min-width:0">
        <span class="palette__t">${esc(b.title)}</span>
        <span class="palette__a">${esc(b.author)}</span>
      </span>
      <span class="palette__p">${money(b.price)}</span>
    </button>`).join('');
}

function move(step) {
  if (!results.length) return;
  active = (active + step + results.length) % results.length;
  render();
  list.children[active]?.scrollIntoView({ block: 'nearest' });
}

export function openPalette() {
  lastFocus = document.activeElement;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('is-open'));
  input.value = '';
  results = search('');
  active = 0;
  render();
  input.focus();
}

export function closePalette() {
  if (!box || box.hidden) return;
  box.classList.remove('is-open');
  setTimeout(() => { box.hidden = true; }, 180);
  lastFocus?.focus?.();
}

function pick(id) { closePalette(); onPick?.(id); }

export function initPalette(opts = {}) {
  onPick = opts.onPick;
  box = document.getElementById('palette');
  if (!box) return;
  input = box.querySelector('input');
  list = box.querySelector('.palette__list');

  input.addEventListener('input', () => {
    results = search(input.value.trim());
    active = 0;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active].id); }
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.palette__item');
    if (item) pick(item.dataset.id);
  });

  box.addEventListener('click', (e) => { if (e.target === box) closePalette(); });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      box.hidden ? openPalette() : closePalette();
    }
    if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); closePalette(); }
    /* "/" opens search when the reader is not typing somewhere else */
    if (e.key === '/' && box.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      openPalette();
    }
  });

  document.querySelectorAll('[data-act="search"]').forEach((b) =>
    b.addEventListener('click', openPalette));
}

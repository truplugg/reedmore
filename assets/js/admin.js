/* ============================================================
   READMORE — admin desk
   Builds a book from the form, shows it as the same 3D object the
   shop uses, and keeps it in this browser's store. Swap custom.js
   for your API and this file needs no changes.
   ============================================================ */

import { bookHTML } from './book3d.js';
import { coverHTML, esc } from './covers.js';
import {
  normalize, saveBook, deleteBook, customBooks, usedBytes,
  exportJSON, importJSON, slugify
} from './custom.js';
import { toast, initThemeToggle } from './ui.js';

document.documentElement.classList.add('js');

const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#book-form');
const preview = $('#preview');
const spin = $('#spin');
const spinOut = $('#spin-out');

let editingId = null;
let angle = -30;
let spread = false;
let art = { front: null, back: null };

/* the desk shares the shop's theme preference, one switch for both */
initThemeToggle($('#theme-toggle'));

/* ---------- form <-> draft ---------- */
function draft() {
  const d = Object.fromEntries(new FormData(form).entries());
  return normalize({
    id: editingId,
    title: d.title?.trim(),
    author: d.author?.trim(),
    publisher: d.publisher?.trim() || undefined,
    year: d.year || undefined,
    genre: d.genre,
    format: d.format,
    badge: d.badge,
    tags: (d.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    blurb: d.blurb?.trim(),
    about: d.about?.trim(),
    pages: d.pages || undefined,
    size: d.size?.trim() || undefined,
    paper: d.paper?.trim() || undefined,
    binding: d.binding?.trim() || undefined,
    isbn: d.isbn?.trim() || undefined,
    weight: d.weight || undefined,
    price: d.price || undefined,
    oldPrice: d.oldPrice || undefined,
    stock: d.stock === '' ? undefined : d.stock,
    endpaper: d.endpaper,
    cover: {
      style: d.coverStyle,
      motif: d.coverMotif,
      pal: { paper: d.palPaper, ink: d.palInk, accent: d.palAccent },
      front: art.front,
      back: art.back
    }
  });
}

function fill(book) {
  const set = (name, value) => { const el = form.elements[name]; if (el) el.value = value ?? ''; };
  set('title', book.title); set('author', book.author);
  set('publisher', book.publisher); set('year', book.year);
  set('genre', book.genre); set('format', book.format); set('badge', book.badge || '');
  set('tags', (book.tags || []).join(', '));
  set('blurb', book.blurb); set('about', book.about);
  set('pages', book.pages); set('size', book.size); set('paper', book.paper);
  set('binding', book.binding); set('isbn', book.isbn); set('weight', book.weight);
  set('price', book.price); set('oldPrice', book.oldPrice || ''); set('stock', book.stock);
  set('endpaper', book.endpaper);
  set('coverStyle', book.cover.style); set('coverMotif', book.cover.motif);
  set('palPaper', book.cover.pal.paper); set('palInk', book.cover.pal.ink); set('palAccent', book.cover.pal.accent);
  art = { front: book.cover.front, back: book.cover.back };
  paintDrops();
}

/* ---------- preview ---------- */
let pending;
function renderPreview() {
  const book = draft();
  preview.innerHTML = bookHTML(book, { mode: 'open' });
  const el = preview.querySelector('.book');
  el.classList.add('book--solo', 'book--studio');
  el.style.setProperty('--turn-rest', `${angle}deg`);
  if (spread) el.classList.add('is-active', 'is-open');
  bindDrag(el);
}
function schedulePreview() {
  clearTimeout(pending);
  pending = setTimeout(renderPreview, 140);
}

function setAngle(deg) {
  angle = Math.max(-200, Math.min(200, Math.round(deg)));
  spin.value = String(angle);
  spinOut.textContent = `${angle < 0 ? '−' : ''}${Math.abs(angle)}°`;
  preview.querySelector('.book')?.style.setProperty('--turn-rest', `${angle}deg`);
}

/* drag the book itself, which is how you would turn a real one */
function bindDrag(el) {
  let from = 0, base = 0, dragging = false;
  el.addEventListener('pointerdown', (e) => {
    if (spread) return;
    dragging = true; from = e.clientX; base = angle;
    el.classList.add('is-dragging');
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setAngle(base + (e.clientX - from) * 0.55);
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    el.releasePointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}

spin.addEventListener('input', () => setAngle(Number(spin.value)));

$('.adm__views').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  const view = btn.dataset.view;
  if (view === 'spread') {
    spread = !spread;
    btn.setAttribute('aria-pressed', String(spread));
    const el = preview.querySelector('.book');
    el.classList.toggle('is-active', spread);
    el.classList.toggle('is-open', spread);
    if (!spread) setAngle(angle);
    return;
  }
  if (spread) { spread = false; $('[data-view="spread"]').setAttribute('aria-pressed', 'false'); renderPreview(); }
  setAngle(view === 'back' ? 168 : -30);
});

/* ---------- cover images ---------- */
const MAX_EDGE = 860;

/** Shrink to something a browser store can actually hold. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Це не зображення')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let out = '';
      try { out = canvas.toDataURL('image/webp', 0.82); } catch { /* fall through */ }
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.82);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не вдалося прочитати файл')); };
    img.src = url;
  });
}

function paintDrops() {
  ['front', 'back'].forEach((side) => {
    const zone = document.querySelector(`.drop[data-side="${side}"]`);
    const box = $(`#prev-${side}`);
    const clear = document.querySelector(`[data-clear="${side}"]`);
    const has = Boolean(art[side]);
    box.style.backgroundImage = has ? `url("${art[side]}")` : '';
    zone.classList.toggle('is-filled', has);
    clear.hidden = !has;
    zone.querySelector('.drop__hint').textContent = has ? 'Натисніть, щоб замінити' : 'Перетягніть сюди або натисніть';
  });
}

async function accept(side, file) {
  if (!file) return;
  try {
    art[side] = await shrink(file);
    paintDrops();
    renderPreview();
    if (side === 'back') setAngle(168);
  } catch (err) {
    toast(err.message);
  }
}

['front', 'back'].forEach((side) => {
  const zone = document.querySelector(`.drop[data-side="${side}"]`);
  const input = $(`#file-${side}`);
  zone.addEventListener('click', (e) => { if (!e.target.closest('[data-clear]')) input.click(); });
  input.addEventListener('change', () => { accept(side, input.files[0]); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    accept(side, e.dataTransfer.files[0]);
  });
  document.querySelector(`[data-clear="${side}"]`).addEventListener('click', () => {
    art[side] = null; paintDrops(); renderPreview();
  });
});

/* ---------- saving ---------- */
function markBad(names) {
  form.querySelectorAll('.field.is-bad').forEach((f) => f.classList.remove('is-bad'));
  names.forEach((n) => form.elements[n]?.closest('.field')?.classList.add('is-bad'));
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form).entries());
  const missing = ['title', 'author', 'price'].filter((n) => !String(d[n] || '').trim());
  const err = $('#form-error');
  markBad(missing);
  if (missing.length) {
    err.textContent = 'Заповніть назву, автора й ціну — без них книжку не покласти на полицю.';
    err.hidden = false;
    form.elements[missing[0]]?.focus();
    return;
  }
  err.hidden = true;

  const book = draft();
  if (!book.id) book.id = slugify(book.title);
  try {
    saveBook(book);
  } catch (ex) {
    err.textContent = String(ex?.name).includes('Quota')
      ? 'У сховищі браузера скінчилося місце. Видаліть кілька книжок або збережіть їх у JSON і почніть заново.'
      : `Не вдалося зберегти: ${ex?.message || ex}`;
    err.hidden = false;
    return;
  }
  toast(editingId ? `«${book.title}» оновлено` : `«${book.title}» додано до каталогу`, {
    label: 'Відкрити в крамниці',
    run: () => { window.location.href = `index.html?q=${encodeURIComponent(book.title)}`; }
  });
  editingId = book.id;
  $('#delete').hidden = false;
  renderSaved();
});

$('#reset').addEventListener('click', () => {
  form.reset();
  editingId = null;
  art = { front: null, back: null };
  $('#delete').hidden = true;
  $('#form-error').hidden = true;
  markBad([]);
  paintDrops();
  setAngle(-30);
  renderPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#delete').addEventListener('click', () => {
  if (!editingId) return;
  deleteBook(editingId);
  toast('Книжку прибрано з каталогу');
  $('#reset').click();
  renderSaved();
});

/* ---------- saved list ---------- */
function thumb(book) {
  if (book.cover.front) return `<div class="saved__thumb" style="background-image:url('${esc(book.cover.front)}')"></div>`;
  return `<div class="saved__thumb" style="background:${esc(book.cover.pal.paper)};color:${esc(book.cover.pal.ink)}">${coverHTML(book, { compact: true })}</div>`;
}

function renderSaved() {
  const list = customBooks();
  $('#saved-count').textContent = list.length;
  $('#usage').textContent = `${Math.round(usedBytes() / 1024)} КБ у сховищі`;
  const host = $('#saved');
  host.innerHTML = list.length
    ? list.map((b) => `
        <article class="saved" data-id="${esc(b.id)}">
          ${thumb(b)}
          <div>
            <p class="saved__t">${esc(b.title)}</p>
            <p class="saved__a">${esc(b.author)}</p>
            <p class="saved__p">${b.price} ₴</p>
            <div class="saved__row">
              <button type="button" data-act="edit">Редагувати</button>
              <button type="button" data-act="drop" class="is-danger">Видалити</button>
            </div>
          </div>
        </article>`).join('')
    : '<p class="adm__empty">Поки порожньо. Заповніть форму вище — книжка одразу з’явиться в каталозі крамниці.</p>';
}

$('#saved').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.saved').dataset.id;
  const book = customBooks().find((b) => b.id === id);
  if (!book) return;
  if (btn.dataset.act === 'drop') {
    deleteBook(id);
    if (editingId === id) $('#reset').click();
    renderSaved();
    toast('Книжку прибрано з каталогу');
    return;
  }
  editingId = id;
  fill(book);
  $('#delete').hidden = false;
  renderPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------- export / import ---------- */
$('#copy').addEventListener('click', async () => {
  const text = exportJSON();
  try {
    await navigator.clipboard.writeText(text);
    toast('JSON скопійовано — його можна вкласти у data/books.js');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('JSON скопійовано'); }
    catch { toast('Не вдалося скопіювати — спробуйте «Завантажити JSON»'); }
    ta.remove();
  }
});

$('#download').addEventListener('click', () => {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'readmore-books.json';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Якщо файл не завантажився, скористайтеся кнопкою «Скопіювати JSON»');
});

$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async () => {
  const file = $('#import-file').files[0];
  if (!file) return;
  try {
    const n = importJSON(await file.text());
    renderSaved();
    toast(`Імпортовано книжок: ${n}`);
  } catch (ex) {
    toast(`Не вдалося імпортувати: ${ex.message}`);
  }
  $('#import-file').value = '';
});

/* ---------- boot ---------- */
form.addEventListener('input', schedulePreview);
form.addEventListener('change', schedulePreview);
paintDrops();
setAngle(-30);
renderPreview();
renderSaved();

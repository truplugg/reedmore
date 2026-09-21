/* ============================================================
   READMORE — books added from the admin desk
   Stored in this browser under one key. The shop merges them in
   ahead of the base catalogue; the desk reads and writes them.
   Swap this module for your API and nothing else has to change.
   ============================================================ */

const KEY = 'readmore.books.v1';

export const GENRE_IDS = ['proza', 'klasyka', 'poeziia', 'nonfic', 'dytiacha'];
export const COVER_STYLES = ['stack', 'plate', 'band', 'column', 'serif', 'split'];
export const MOTIFS = ['none', 'bars', 'circle', 'arc', 'grid', 'diag', 'dots', 'square', 'wave'];
export const ENDPAPERS = ['star', 'rhomb', 'cross', 'zig'];
export const BADGES = ['', 'new', 'best', 'preorder', 'last'];

const DEFAULTS = {
  title: 'Без назви',
  author: 'Невідомий автор',
  publisher: 'READMORE',
  year: new Date().getFullYear(),
  genre: 'proza',
  tags: [],
  format: 'hard',
  pages: 200,
  size: '130×200 мм',
  paper: 'офсет 70 г/м²',
  binding: 'тверда',
  isbn: '—',
  weight: 320,
  price: 300,
  oldPrice: null,
  rating: 5,
  reviews: 0,
  stock: 10,
  badge: 'new',
  lang: 'uk',
  translator: null,
  blurb: '',
  about: '',
  endpaper: 'star'
};

const PAL = { paper: '#1d3b5c', ink: '#efe9db', accent: '#e0563c' };

/** Fill in everything the shop expects, whatever the desk left out. */
export function normalize(raw = {}) {
  const cover = raw.cover || {};
  const book = {
    ...DEFAULTS,
    ...raw,
    custom: true,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    price: Number(raw.price) || DEFAULTS.price,
    oldPrice: Number(raw.oldPrice) || null,
    pages: Number(raw.pages) || DEFAULTS.pages,
    weight: Number(raw.weight) || DEFAULTS.weight,
    year: Number(raw.year) || DEFAULTS.year,
    stock: Number.isFinite(Number(raw.stock)) ? Number(raw.stock) : DEFAULTS.stock,
    rating: Math.min(5, Math.max(0, Number(raw.rating) || DEFAULTS.rating)),
    reviews: Number(raw.reviews) || 0,
    badge: BADGES.includes(raw.badge) ? (raw.badge || null) : null,
    genre: GENRE_IDS.includes(raw.genre) ? raw.genre : 'proza',
    endpaper: ENDPAPERS.includes(raw.endpaper) ? raw.endpaper : 'star',
    cover: {
      style: COVER_STYLES.includes(cover.style) ? cover.style : 'stack',
      motif: MOTIFS.includes(cover.motif) ? cover.motif : 'bars',
      pal: {
        paper: cover.pal?.paper || PAL.paper,
        ink: cover.pal?.ink || PAL.ink,
        accent: cover.pal?.accent || PAL.accent
      },
      front: cover.front || null,
      back: cover.back || null
    }
  };
  book.titleEn = raw.titleEn || book.title;
  book.authorEn = raw.authorEn || book.author;
  book.blurbEn = raw.blurbEn || book.blurb;
  book.aboutEn = raw.aboutEn || book.about;
  if (!book.blurb) book.blurb = book.about.slice(0, 160);
  if (!book.about) book.about = book.blurb;
  return book;
}

/* ---------- storage ---------- */
function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.books;
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch { return []; }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify({ v: 1, books: list }));
}

export function customBooks() { return read(); }

/** Insert or replace by id, newest first. Throws if storage is full. */
export function saveBook(book) {
  const clean = normalize(book);
  if (!clean.id) clean.id = uniqueId(clean.title, read());
  const list = read().filter((b) => b.id !== clean.id);
  list.unshift({ ...clean, savedAt: Date.now() });
  write(list);
  return clean;
}

export function deleteBook(id) { write(read().filter((b) => b.id !== id)); }

export function clearBooks() { try { localStorage.removeItem(KEY); } catch { /* unavailable */ } }

/** Roughly how much of this browser's store the covers are using. */
export function usedBytes() {
  try { return (localStorage.getItem(KEY) || '').length * 2; } catch { return 0; }
}

/* ---------- ids ---------- */
const UA = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: ''
};

export function slugify(text) {
  return String(text).toLowerCase().split('')
    .map((ch) => (UA[ch] !== undefined ? UA[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'book';
}

function uniqueId(title, existing) {
  const base = slugify(title);
  const taken = new Set(existing.map((b) => b.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/* ---------- shop integration ---------- */
/**
 * Put the desk's books at the head of the catalogue array the shop
 * already holds. Every module shares that one array, so mutating it
 * here is what makes them appear everywhere at once.
 */
export function installCustomBooks(catalogue) {
  const mine = read();
  if (!mine.length) return 0;
  const ids = new Set(mine.map((b) => b.id));
  for (let i = catalogue.length - 1; i >= 0; i -= 1) {
    if (ids.has(catalogue[i].id)) catalogue.splice(i, 1);
  }
  catalogue.unshift(...mine);
  return mine.length;
}

/* ---------- import / export ---------- */
export function exportJSON() {
  return JSON.stringify({ v: 1, books: read() }, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.books;
  if (!Array.isArray(list)) throw new Error('Очікувався масив книжок');
  const existing = read();
  const merged = [...list.map(normalize), ...existing];
  const seen = new Set();
  const unique = merged.filter((b) => (seen.has(b.id) ? false : seen.add(b.id)));
  write(unique);
  return list.length;
}

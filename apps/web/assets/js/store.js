/* ============================================================
   RIDMORE — application state
   One tiny store: preferences, cart and wishlist, with a
   subscribe/emit loop. Every storage access is guarded because
   private windows and blocked site data make it throw.
   ============================================================ */

const KEY = 'ridmore.v1';

/* UAH is the base. Rates are editorial placeholders — wire them
   to your payment provider's daily feed before launch. */
/**
 * Two currencies, and the shop never converts between them (§4).
 *
 * Each book carries a price in each, set by hand, so there is no rate here
 * and there should never be one: the switch picks a column, it does not do
 * arithmetic. A reader in Berlin may pay in hryvnia and one in Kyiv in euro.
 */
export const CURRENCIES = {
  EUR: { sign: '€', locale: 'de-DE', minor: 100, digits: 2, after: true },
  UAH: { sign: '₴', locale: 'uk-UA', minor: 100, digits: 0, after: true }
};
const DEFAULTS = {
  lang: null,        /* null means "not chosen yet" — detect from the browser */
  currency: null,
  country: null,
  theme: 'system',
  view: 'grid',
  cart: {},        /* id -> qty */
  wish: []         /* [id] */
};

/* The shop was called Readmore before it was Ridmore. Anyone who visited
   then still has a cart and a wishlist under the old key, so it is carried
   across once and then removed. */
const LEGACY_KEY = 'readmore.v1';

function read() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(KEY, legacy);
        localStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULTS }; }
}

function write(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const state = read();
const listeners = new Set();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => fn(what, state)); }

export function get(key) { return key ? state[key] : state; }

export function set(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  write(state);
  emit(key);
}

/* ---------- cart ---------- */
export function addToCart(id, qty = 1) {
  state.cart = { ...state.cart, [id]: (state.cart[id] || 0) + qty };
  write(state); emit('cart');
}
export function setQty(id, qty) {
  const next = { ...state.cart };
  if (qty <= 0) delete next[id]; else next[id] = Math.min(qty, 99);
  state.cart = next;
  write(state); emit('cart');
}
export function removeFromCart(id) { setQty(id, 0); }
export function clearCart() { state.cart = {}; write(state); emit('cart'); }
export function cartCount() { return Object.values(state.cart).reduce((a, n) => a + n, 0); }
export function cartEntries() { return Object.entries(state.cart); }

/* ---------- wishlist ---------- */
export function toggleWish(id) {
  const has = state.wish.includes(id);
  state.wish = has ? state.wish.filter((x) => x !== id) : [...state.wish, id];
  write(state); emit('wish');
  return !has;
}
export function inWish(id) { return state.wish.includes(id); }

/* ---------- money ----------
   Amounts are integers of minor units — cents and kopiyky — so nothing here
   ever meets a floating-point rounding error. `price(book)` reads the column
   for the current currency; there is deliberately no conversion function. */

/** The price a book is actually sold at, and the one it was struck from. */
export function price(book, code = state.currency) {
  const cur = CURRENCIES[code] ? code : 'EUR';
  const list = cur === 'EUR' ? book.priceEUR : book.priceUAH;
  const sale = cur === 'EUR' ? book.salePriceEUR : book.salePriceUAH;
  return (sale != null && sale < list) ? { amount: sale, was: list } : { amount: list, was: null };
}

export function money(minor, code = state.currency) {
  const c = CURRENCIES[code] || CURRENCIES.EUR;
  const value = (minor ?? 0) / c.minor;
  let n;
  try {
    n = new Intl.NumberFormat(c.locale, {
      minimumFractionDigits: c.digits, maximumFractionDigits: c.digits
    }).format(value);
  } catch { n = value.toFixed(c.digits); }
  return c.after ? `${n}\u00a0${c.sign}` : `${c.sign}${n}`;
}

/* Free shipping threshold, set per currency rather than converted. */
export const FREE_FROM = { EUR: 5000, UAH: 250000 };
export const freeFrom = (code = state.currency) => FREE_FROM[code] ?? FREE_FROM.EUR;

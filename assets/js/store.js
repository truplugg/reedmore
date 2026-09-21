/* ============================================================
   READMORE — application state
   One tiny store: preferences, cart and wishlist, with a
   subscribe/emit loop. Every storage access is guarded because
   private windows and blocked site data make it throw.
   ============================================================ */

const KEY = 'readmore.v1';

/* UAH is the base. Rates are editorial placeholders — wire them
   to your payment provider's daily feed before launch. */
export const CURRENCIES = {
  UAH: { sign: '₴', rate: 1,    locale: 'uk-UA', step: 5,    after: true  },
  EUR: { sign: '€', rate: 48,   locale: 'de-DE', step: 0.05, after: true  },
  PLN: { sign: 'zł', rate: 11.3, locale: 'pl-PL', step: 0.5,  after: true },
  CZK: { sign: 'Kč', rate: 1.92, locale: 'cs-CZ', step: 1,    after: true },
  GBP: { sign: '£', rate: 56,   locale: 'en-GB', step: 0.05, after: false }
};

const DEFAULTS = {
  lang: 'uk',
  currency: 'EUR',
  theme: 'system',
  view: 'grid',
  cart: {},        /* id -> qty */
  wish: []         /* [id] */
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
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

/* ---------- money ---------- */
export function convert(uah, code = state.currency) {
  const c = CURRENCIES[code] || CURRENCIES.UAH;
  const raw = uah / c.rate;
  return Math.round(raw / c.step) * c.step;
}

export function money(uah, code = state.currency) {
  const c = CURRENCIES[code] || CURRENCIES.UAH;
  const value = convert(uah, code);
  const decimals = c.step < 1 ? 2 : 0;
  let n;
  try {
    n = new Intl.NumberFormat(c.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  } catch { n = value.toFixed(decimals); }
  return c.after ? `${n} ${c.sign}` : `${c.sign}${n}`;
}

/* free shipping threshold, held in the base currency */
export const FREE_FROM_UAH = 2400;

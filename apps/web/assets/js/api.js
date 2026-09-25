/* ============================================================
   RIDMORE — the API client
   One place that knows the shape of a response and the shape
   of an error, so no caller has to guess either.
   ============================================================ */

const BASE = '/api';

/* The reader's own choice of language and currency travels with every read,
   because the server decides which title and which price column to send. */
let context = () => ({});
export function setApiContext(fn) { context = fn; }

function withContext(path) {
  const { locale, currency } = context() ?? {};
  if (!locale && !currency) return path;
  const url = new URL(path, 'http://x');
  if (locale) url.searchParams.set('locale', String(locale).toUpperCase());
  if (currency) url.searchParams.set('currency', currency);
  return url.pathname + url.search;
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
  /** The message to put under a specific form field, if there is one. */
  fieldError(field) {
    return this.details?.find?.((d) => d.path === field)?.message ?? null;
  }
}

/** True when the API is not there at all — a static preview, say. */
export let offline = false;
export const isOffline = () => offline;

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    offline = true;
    throw new ApiError(0, 'offline', 'Cannot reach the shop just now.', null);
  }

  if (res.status === 204) return null;

  /* A static preview has no API: every /api/… path falls through to the
     shop's own index.html, which answers 200 with HTML. Treating that as a
     successful empty response would leave the account button looking alive
     and failing silently, so an unexpected content type is "no API here". */
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    offline = true;
    throw new ApiError(0, 'offline', 'The shop is not reachable from this page.', null);
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* an empty body */ }

  if (!res.ok) {
    const e = payload?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong.', e.details);
  }
  offline = false;
  return payload;
}

export const api = {
  /* --- who am I --- */
  me:              () => request('/auth/me'),
  signUp:          (body) => request('/auth/signup', { method: 'POST', body }),
  signIn:          (body) => request('/auth/login', { method: 'POST', body }),
  signOut:         () => request('/auth/logout', { method: 'POST' }),
  forgotPassword:  (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword:   (body) => request('/auth/reset-password', { method: 'POST', body }),
  changePassword:  (body) => request('/auth/change-password', { method: 'POST', body }),

  /* --- the account's own screen --- */
  account:         () => request('/account'),
  avatars:         () => request('/account/avatars'),
  saveProfile:     (body) => request('/account/profile', { method: 'PATCH', body }),
  deleteAccount:   (password) => request('/account/delete', { method: 'POST', body: { password } }),

  /* --- wishlists --- */
  myWishlists:     () => request(withContext('/wishlists/mine')),
  publicWishlists: (limit = 6) => request(withContext(`/wishlists/public?limit=${limit}`)),
  wishlist:        (id) => request(withContext(`/wishlists/${encodeURIComponent(id)}`)),
  sharedWishlist:  (token) => request(withContext(`/wishlists/shared/${encodeURIComponent(token)}`)),
  createWishlist:  (body) => request('/wishlists', { method: 'POST', body }),
  updateWishlist:  (id, body) => request(`/wishlists/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteWishlist:  (id) => request(`/wishlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToWishlist:   (id, body) => request(`/wishlists/${encodeURIComponent(id)}/items`, { method: 'POST', body }),
  removeFromWishlist: (id, itemId) =>
    request(`/wishlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),

  /* --- gifts --- */
  reserveGift:     (body) => request('/gifts/reserve', { method: 'POST', body }),
  giftsSent:       () => request('/gifts/sent'),
  giftsReceived:   () => request('/gifts/received'),
  cancelGift:      (id) => request(`/gifts/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  randomPerson:    () => request(withContext('/gifts/random/person')),
  randomBook:      () => request(withContext('/gifts/random/book'))
};

/* ---------- the signed-in viewer, held once ---------- */
let viewer = null;
let loaded = false;
const listeners = new Set();

export function onViewer(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(viewer)); }

export function currentViewer() { return viewer; }
export function isSignedIn() { return !!viewer; }
export function can(key) { return viewer?.permissions?.includes(key) ?? false; }
export function isStaff() { return (viewer?.permissions?.length ?? 0) > 0; }

export function setViewer(next) { viewer = next; loaded = true; emit(); }

/** Ask once; every later caller gets the answer already in hand. */
export async function loadViewer({ force = false } = {}) {
  if (loaded && !force) return viewer;
  try {
    const res = await api.me();
    viewer = res?.user ?? null;
  } catch {
    viewer = null;          /* signed out, or no API behind this page */
  }
  loaded = true;
  emit();
  return viewer;
}

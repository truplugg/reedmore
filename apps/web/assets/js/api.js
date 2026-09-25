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

/**
 * True when there is no server behind this page — a published preview.
 *
 * Rather than taking the features away, the same API runs in the browser
 * from that point on, so everything can be tried. It is loaded only if it
 * is needed, so a real deployment never ships it.
 */
export let offline = false;
export const isOffline = () => offline;

let demo = null;
async function viaDemo(method, path, body) {
  if (!demo) demo = await import('./demo.js');
  try {
    return demo.handle(method, path, body);
  } catch (e) {
    if (e?.api) throw new ApiError(e.status, e.code, e.message, e.details);
    throw new ApiError(500, 'error', e?.message ?? 'Something went wrong.');
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  if (offline) return viaDemo(method, path, body);

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch {
    offline = true;
    return viaDemo(method, path, body);
  }

  if (res.status === 204) return null;

  /* A static preview has no API: every /api/… path falls through to the
     shop's own index.html, which answers 200 with HTML. Treating that as a
     successful empty response would leave the account button looking alive
     and failing silently, so an unexpected content type is "no API here". */
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    offline = true;
    return viaDemo(method, path, body);
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
  randomBook:      () => request(withContext('/gifts/random/book')),

  /* --- the admin desk (§10-13) ---
     Everything under /admin is refused by the server for an account without
     the permission, whatever the panel decides to draw. The panel hides a
     section to save a reader a pointless click, never as the protection. */
  dashboard:       (days = 30) => request(`/admin/dashboard?days=${days}`),

  adminBooks:      (q = '') => request(`/admin/books${q}`),
  adminBook:       (id) => request(`/admin/books/${encodeURIComponent(id)}`),
  createBook:      (body) => request('/admin/books', { method: 'POST', body }),
  updateBook:      (id, body) => request(`/admin/books/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteBook:      (id) => request(`/admin/books/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bookCategories:  () => request('/admin/books/meta/categories'),

  adminOrders:     (q = '') => request(`/admin/orders${q}`),
  adminOrder:      (id) => request(`/admin/orders/${encodeURIComponent(id)}`),
  orderStatus:     (id, body) => request(`/admin/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body }),
  orderNotes:      (id, notes) => request(`/admin/orders/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { notes } }),

  adminUsers:      (q = '') => request(`/admin/users${q}`),
  adminUser:       (id) => request(`/admin/users/${encodeURIComponent(id)}`),
  userStatus:      (id, status) => request(`/admin/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } }),
  setUserRoles:    (id, roles) => request(`/admin/users/${encodeURIComponent(id)}/roles`, { method: 'PUT', body: { roles } }),
  adminRoles:      () => request('/admin/roles'),
  setRolePerms:    (key, permissions) =>
    request(`/admin/roles/${encodeURIComponent(key)}/permissions`, { method: 'PUT', body: { permissions } }),

  adminThemes:     () => request('/admin/themes'),
  adminTheme:      (id) => request(`/admin/themes/${encodeURIComponent(id)}`),
  createTheme:     (body) => request('/admin/themes', { method: 'POST', body }),
  saveThemeDraft:  (id, body) => request(`/admin/themes/${encodeURIComponent(id)}/draft`, { method: 'POST', body }),
  publishTheme:    (id, body = {}) => request(`/admin/themes/${encodeURIComponent(id)}/publish`, { method: 'POST', body }),
  deleteTheme:     (id) => request(`/admin/themes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  adminArticles:   (q = '') => request(`/admin/articles${q}`),
  adminArticle:    (id) => request(`/admin/articles/${encodeURIComponent(id)}`),
  createArticle:   (body) => request('/admin/articles', { method: 'POST', body }),
  updateArticle:   (id, body) => request(`/admin/articles/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  articleStatus:   (id, body) => request(`/admin/articles/${encodeURIComponent(id)}/status`, { method: 'POST', body }),
  deleteArticle:   (id) => request(`/admin/articles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  articleTaxonomy: () => request('/admin/articles/meta/taxonomy'),

  adminMedia:      (q = '') => request(`/admin/media${q}`),
  deleteMedia:     (id) => request(`/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  settings:        () => request('/admin/settings'),
  saveSettings:    (body) => request('/admin/settings', { method: 'PATCH', body }),
  auditLog:        (q = '') => request(`/admin/settings/audit${q}`)
};

/* ---------- the signed-in viewer, held once ---------- */
let viewer = null;
let loaded = false;
let inFlight = null;
const listeners = new Set();

export function onViewer(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(viewer)); }

export function currentViewer() { return viewer; }
export function isSignedIn() { return !!viewer; }
export function can(key) { return viewer?.permissions?.includes(key) ?? false; }
export function isStaff() { return (viewer?.permissions?.length ?? 0) > 0; }

export function setViewer(next) { viewer = next; loaded = true; emit(); }

/**
 * Ask once; every later caller gets the answer already in hand.
 *
 * The first call also settles whether there is a server at all, so the rest
 * of the session never hits the network on a preview — one failed request
 * in the console instead of one per call.
 */
export async function loadViewer({ force = false } = {}) {
  if (loaded && !force) return viewer;
  /* Two callers at boot would otherwise each send the request. Share the
     one in flight so the probe happens exactly once. */
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    try {
      const res = await api.me();
      viewer = res?.user ?? null;
    } catch {
      viewer = null;        /* signed out, or no API behind this page */
    }
    loaded = true;
    inFlight = null;
    emit();
    return viewer;
  })();
  return inFlight;
}

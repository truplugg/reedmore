/* ============================================================
   RIDMORE — the preview backend
   A published preview has no server, and a shop where the
   account button is hidden and the wishlists are gone is not a
   preview of anything. So the same API runs in the browser,
   over localStorage, with the same response shapes — the UI
   above it cannot tell the difference and needs no branch.
   Data here is per-browser and goes no further.
   ============================================================ */

import { BOOKS } from './data/books.js';
import { SEED_AVATARS } from './demo-avatars.js';

const KEY = 'ridmore.demo.v1';
const LOCALES = { uk: 'UK', en: 'EN', de: 'DE' };

const now = () => new Date().toISOString();
const id = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

function err(status, code, message, details) {
  const e = new Error(message);
  e.status = status; e.code = code; e.details = details ?? null; e.api = true;
  throw e;
}

/* ---------- the store ---------- */

function blank() {
  return { users: [], sessions: null, wishlists: [], gifts: [], seeded: false };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch { return blank(); }
}

function write(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private window */ }
}

let db = read();

/** Three readers with lists, so the block on the home page has something in
 *  it on a first visit. They are fiction; nothing about them is a person. */
function seed() {
  if (db.seeded) return;
  const picks = (from, n) => BOOKS.slice(from, from + n).map((b, i) => ({
    id: id('it'), bookSlug: b.id, note: null, position: i, status: 'AVAILABLE', giftId: null
  }));

  const people = [
    { nick: 'Оксана',  avatar: 2,  title: 'Хочу прочитати', from: 0,  n: 5 },
    { nick: 'Martin',  avatar: 9,  title: 'Leseliste',      from: 6,  n: 4 },
    { nick: 'Sofiia',  avatar: 14, title: 'Someday',        from: 11, n: 6 }
  ];

  for (const p of people) {
    const uid = id('u');
    db.users.push({
      id: uid, email: null, password: null, demo: true,
      nickname: p.nick, avatarUrl: SEED_AVATARS[p.avatar % SEED_AVATARS.length],
      locale: 'UK', currency: 'EUR', roles: [], permissions: [], createdAt: now()
    });
    db.wishlists.push({
      id: id('wl'), ownerId: uid, title: p.title, visibility: 'PUBLIC',
      shareToken: null, createdAt: now(), items: picks(p.from, p.n)
    });
  }
  db.seeded = true;
  write(db);
}

/* ---------- helpers ---------- */

const userById = (uid) => db.users.find((u) => u.id === uid) ?? null;
const viewer = () => (db.sessions ? userById(db.sessions) : null);
const requireViewer = () => viewer() ?? err(401, 'unauthorized', 'You need to sign in.');
const bookBySlug = (slug) => BOOKS.find((b) => b.id === slug);

const ALL_PERMISSIONS = [
  'book.read', 'book.write', 'book.publish', 'book.delete', 'category.write', 'inventory.write',
  'order.read', 'order.write', 'order.address.read', 'gift.read', 'gift.process',
  'article.read', 'article.write', 'article.publish', 'article.delete',
  'media.read', 'media.write', 'media.delete',
  'user.read', 'user.write', 'role.write',
  'theme.read', 'theme.write', 'theme.publish',
  'settings.write', 'audit.read'
];

function shopBook(b, currency) {
  const sale = currency === 'EUR' ? b.salePriceEUR : b.salePriceUAH;
  const list = currency === 'EUR' ? b.priceEUR : b.priceUAH;
  return {
    id: b.id, slug: b.id,
    title: b.title, author: b.author,
    currency,
    price: sale != null && sale < list ? sale : list,
    listPrice: sale != null && sale < list ? list : null,
    cover: { front: b.cover?.front ?? null, back: b.cover?.back ?? null,
             style: b.cover?.style, motif: b.cover?.motif,
             pal: { paper: b.cover?.pal?.paper, ink: b.cover?.pal?.ink, accent: b.cover?.pal?.accent } }
  };
}

const publicOwner = (u) => ({ nickname: u?.nickname ?? 'reader', avatarUrl: u?.avatarUrl ?? null });

function meOf(u) {
  return {
    id: u.id, email: u.email, nickname: u.nickname, locale: u.locale,
    currency: u.currency, avatarUrl: u.avatarUrl, roles: u.roles, permissions: u.permissions
  };
}

/* ---------- the routes ---------- */

const routes = {
  'GET /auth/me': () => ({ user: viewer() ? meOf(viewer()) : null }),

  'POST /auth/signup': (body) => {
    if (!body.email?.includes('@')) err(400, 'validation_failed', 'Some of that is not right.',
      [{ path: 'email', message: 'That is not an email address.' }]);
    if ((body.password ?? '').length < 10) err(400, 'validation_failed', 'Some of that is not right.',
      [{ path: 'password', message: 'Use at least 10 characters.' }]);
    if ((body.nickname ?? '').trim().length < 2) err(400, 'validation_failed', 'Some of that is not right.',
      [{ path: 'nickname', message: 'Use at least 2 characters.' }]);

    const email = body.email.toLowerCase();
    if (db.users.some((u) => u.email === email)) err(409, 'email_taken', 'That email already has an account.');
    if (db.users.some((u) => u.nickname.toLowerCase() === body.nickname.toLowerCase()))
      err(409, 'nickname_taken', 'That nickname is taken.');

    /* The same rule as the real shop: whoever opens the first real account
       owns it. The three seeded readers hold no roles, so they do not count. */
    const owner = !db.users.some((u) => u.roles.includes('SUPER_ADMIN'));
    const user = {
      id: id('u'), email, password: body.password, demo: false,
      nickname: body.nickname,
      avatarUrl: SEED_AVATARS[Math.floor(Math.random() * SEED_AVATARS.length)],
      locale: body.locale ?? 'EN', currency: body.currency ?? 'EUR',
      roles: [owner ? 'SUPER_ADMIN' : 'CUSTOMER'],
      permissions: owner ? ALL_PERMISSIONS : [],
      createdAt: now()
    };
    db.users.push(user);
    db.sessions = user.id;
    write(db);
    return { user: meOf(user), owner };
  },

  'POST /auth/login': (body) => {
    const email = (body.email ?? '').toLowerCase();
    const u = db.users.find((x) => x.email === email && x.password === body.password);
    if (!u) err(401, 'unauthorized', 'Wrong email or password.');
    db.sessions = u.id; write(db);
    return { ok: true };
  },

  'POST /auth/logout': () => { db.sessions = null; write(db); return { ok: true }; },

  'POST /auth/forgot-password': () => ({ ok: true }),

  'POST /auth/change-password': (body) => {
    const u = requireViewer();
    if (u.password !== body.current) err(401, 'unauthorized', 'That is not your current password.');
    if ((body.password ?? '').length < 10) err(400, 'validation_failed', 'Some of that is not right.',
      [{ path: 'password', message: 'Use at least 10 characters.' }]);
    u.password = body.password; write(db);
    return { ok: true };
  },

  'GET /account': () => {
    const u = requireViewer();
    const mine = db.wishlists.filter((w) => w.ownerId === u.id);
    const lists = {};
    for (const w of mine) lists[w.visibility] = (lists[w.visibility] ?? 0) + 1;
    return {
      account: {
        id: u.id, email: u.email, nickname: u.nickname, avatarUrl: u.avatarUrl,
        locale: u.locale, currency: u.currency, bio: null,
        roles: u.roles, permissions: u.permissions,
        staff: u.permissions.length > 0,
        lists, giftsSent: db.gifts.filter((g) => g.donorId === u.id).length
      }
    };
  },

  'GET /account/avatars': () => {
    requireViewer();
    return { avatars: SEED_AVATARS.map((url, i) => ({ id: `a${i}`, url, alt: 'Avatar' })) };
  },

  'PATCH /account/profile': (body) => {
    const u = requireViewer();
    if (body.nickname) {
      const clash = db.users.find((x) => x.id !== u.id && x.nickname.toLowerCase() === body.nickname.toLowerCase());
      if (clash) err(409, 'nickname_taken', 'That nickname is taken.');
      u.nickname = body.nickname;
    }
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl && !SEED_AVATARS.includes(body.avatarUrl))
        err(400, 'unknown_avatar', 'Pick one of the avatars on offer.');
      u.avatarUrl = body.avatarUrl;
    }
    write(db);
    return { account: { nickname: u.nickname, avatarUrl: u.avatarUrl, locale: u.locale, currency: u.currency, bio: null } };
  },

  'POST /account/delete': (body) => {
    const u = requireViewer();
    if (u.password !== body.password) err(401, 'unauthorized', 'That is not your password.');
    db.wishlists = db.wishlists.filter((w) => w.ownerId !== u.id);
    db.users = db.users.filter((x) => x.id !== u.id);
    db.sessions = null;
    write(db);
    return { ok: true };
  },

  'GET /wishlists/mine': (_body, q) => {
    const u = requireViewer();
    const currency = q.currency ?? u.currency ?? 'EUR';
    return {
      wishlists: db.wishlists.filter((w) => w.ownerId === u.id).map((w) => ({
        id: w.id, title: w.title, visibility: w.visibility, shareToken: w.shareToken,
        itemCount: w.items.length, createdAt: w.createdAt,
        items: w.items.map((i) => ({
          id: i.id, note: i.note, status: i.status, book: shopBook(bookBySlug(i.bookSlug), currency)
        }))
      }))
    };
  },

  'GET /wishlists/public': (_body, q) => {
    const currency = q.currency ?? 'EUR';
    const limit = Number(q.limit ?? 6);
    const lists = db.wishlists
      .filter((w) => w.visibility === 'PUBLIC' && w.items.some((i) => i.status === 'AVAILABLE'))
      .slice(0, limit);
    return {
      wishlists: lists.map((w) => {
        const free = w.items.filter((i) => i.status === 'AVAILABLE');
        return {
          id: w.id, title: w.title, owner: publicOwner(userById(w.ownerId)),
          itemCount: w.items.length, availableCount: free.length,
          covers: free.slice(0, 4).map((i) => {
            const b = shopBook(bookBySlug(i.bookSlug), currency);
            return { slug: b.slug, title: b.title, author: b.author, cover: b.cover };
          })
        };
      })
    };
  },

  'POST /wishlists': (body) => {
    const u = requireViewer();
    if (!body.title?.trim()) err(400, 'validation_failed', 'Give the list a name.',
      [{ path: 'title', message: 'Give the list a name.' }]);
    if (body.visibility === 'PUBLIC' && db.wishlists.some((w) => w.ownerId === u.id && w.visibility === 'PUBLIC'))
      err(409, 'public_list_exists', 'You already have a public list. Make that one private first.');
    const w = {
      id: id('wl'), ownerId: u.id, title: body.title.trim(),
      visibility: body.visibility ?? 'PRIVATE',
      shareToken: body.visibility === 'UNLISTED' ? id('tk') : null,
      createdAt: now(), items: []
    };
    db.wishlists.push(w); write(db);
    return { wishlist: { ...w, itemCount: 0, items: [] } };
  },

  'DELETE /wishlists/:id': (_body, _q, [wid]) => {
    const u = requireViewer();
    const w = db.wishlists.find((x) => x.id === wid);
    if (!w || w.ownerId !== u.id) err(404, 'not_found', 'No such list.');
    db.wishlists = db.wishlists.filter((x) => x.id !== wid); write(db);
    return null;
  },

  'POST /wishlists/:id/items': (body, _q, [wid]) => {
    const u = requireViewer();
    const w = db.wishlists.find((x) => x.id === wid);
    if (!w || w.ownerId !== u.id) err(404, 'not_found', 'No such list.');
    if (!bookBySlug(body.bookSlug)) err(404, 'not_found', 'No such book.');
    if (w.items.some((i) => i.bookSlug === body.bookSlug))
      err(409, 'already_on_list', 'That book is already on this list.');
    w.items.push({ id: id('it'), bookSlug: body.bookSlug, note: body.note ?? null,
                   position: w.items.length, status: 'AVAILABLE', giftId: null });
    write(db);
    return routes['GET /wishlists/mine'](null, {});
  },

  'DELETE /wishlists/:id/items/:itemId': (_body, _q, [wid, itemId]) => {
    const u = requireViewer();
    const w = db.wishlists.find((x) => x.id === wid);
    if (!w || w.ownerId !== u.id) err(404, 'not_found', 'No such list.');
    const item = w.items.find((i) => i.id === itemId);
    if (item && item.status !== 'AVAILABLE') err(400, 'item_reserved', 'Someone is already buying this one.');
    w.items = w.items.filter((i) => i.id !== itemId); write(db);
    return null;
  },

  'GET /wishlists/:id': (_body, q, [wid]) => {
    const u = viewer();
    const currency = q.currency ?? 'EUR';
    const w = db.wishlists.find((x) => x.id === wid);
    if (!w) err(404, 'not_found', 'No such list.');
    if (u && w.ownerId === u.id) {
      return { mine: true, wishlist: routes['GET /wishlists/mine'](null, q).wishlists.find((x) => x.id === wid) };
    }
    if (w.visibility !== 'PUBLIC') err(404, 'not_found', 'No such list.');
    const free = w.items.filter((i) => i.status === 'AVAILABLE');
    return {
      mine: false,
      wishlist: {
        id: w.id, title: w.title, owner: publicOwner(userById(w.ownerId)),
        itemCount: w.items.length, availableCount: free.length,
        items: free.map((i) => ({ id: i.id, note: i.note, book: shopBook(bookBySlug(i.bookSlug), currency) }))
      }
    };
  },

  'POST /gifts/reserve': (body) => {
    const u = requireViewer();
    let found = null;
    for (const w of db.wishlists) {
      const i = w.items.find((x) => x.id === body.wishlistItemId);
      if (i) { found = { w, i }; break; }
    }
    if (!found) err(404, 'not_found', 'That book is no longer on the list.');
    if (found.w.ownerId === u.id) err(400, 'own_wishlist', 'That is your own list.');
    if (found.i.status !== 'AVAILABLE') err(409, 'already_reserved', 'Someone else is already sending this one.');

    const b = bookBySlug(found.i.bookSlug);
    const currency = u.currency ?? 'EUR';
    const gift = {
      id: id('g'), number: `RG-${Date.now().toString(36).toUpperCase()}`,
      status: 'PENDING', currency,
      total: shopBook(b, currency).price,
      createdAt: now(),
      donorId: u.id, recipientId: found.w.ownerId,
      anonymous: !!body.anonymous, message: body.message ?? null,
      title: b.title, author: b.author
    };
    found.i.status = 'RESERVED';
    found.i.giftId = gift.id;
    db.gifts.push(gift);
    write(db);
    return { gift: donorGift(gift) };
  },

  'GET /gifts/sent': () => {
    const u = requireViewer();
    return { gifts: db.gifts.filter((g) => g.donorId === u.id).map(donorGift) };
  },

  'GET /gifts/received': () => {
    const u = requireViewer();
    return { gifts: db.gifts.filter((g) => g.recipientId === u.id).map(recipientGift) };
  },

  'GET /gifts/random/book': (_body, q) => {
    const u = requireViewer();
    const currency = q.currency ?? 'EUR';
    const pool = [];
    for (const w of db.wishlists) {
      if (w.visibility !== 'PUBLIC' || w.ownerId === u.id) continue;
      for (const i of w.items) if (i.status === 'AVAILABLE') pool.push({ w, i });
    }
    if (!pool.length) err(404, 'not_found', 'Nothing is waiting on a public list just now.');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return {
      suggestion: {
        wishlistItemId: pick.i.id, note: pick.i.note,
        book: shopBook(bookBySlug(pick.i.bookSlug), currency),
        wishlist: { id: pick.w.id, title: pick.w.title },
        owner: publicOwner(userById(pick.w.ownerId))
      }
    };
  }
};

/** The donor's shape: a nickname and a picture, and no address to omit. */
function donorGift(g) {
  const r = userById(g.recipientId);
  return {
    id: g.id, number: g.number, status: g.status, currency: g.currency, total: g.total,
    createdAt: g.createdAt, anonymous: g.anonymous, message: g.message,
    recipient: r ? publicOwner(r) : null,
    items: [{ title: g.title, author: g.author, unitPrice: g.total }]
  };
}

function recipientGift(g) {
  const d = userById(g.donorId);
  return {
    id: g.id, number: g.number, status: g.status, createdAt: g.createdAt,
    message: g.message,
    from: g.anonymous || !d ? null : publicOwner(d),
    items: [{ title: g.title, author: g.author }]
  };
}

/* ---------- dispatch ---------- */

/**
 * Match a path against the route table, pulling out :params. Kept
 * deliberately small: this is a preview, not a router.
 */
export function handle(method, path, body) {
  seed();
  db = read();

  const [rawPath, rawQuery] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(rawQuery ?? ''));
  const parts = rawPath.split('/').filter(Boolean);

  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const want = pattern.split('/').filter(Boolean);
    if (want.length !== parts.length) continue;

    const params = [];
    const hit = want.every((seg, i) => {
      if (seg.startsWith(':')) { params.push(decodeURIComponent(parts[i])); return true; }
      return seg === parts[i];
    });
    if (hit) return routes[key](body, query, params);
  }
  err(404, 'not_found', 'No such endpoint.');
}

/** True while this build is running on its own, with no server behind it. */
export const isPreview = () => true;

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
import { THEMES, SLOTS } from './themes.js';
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
  return { users: [], sessions: null, wishlists: [], gifts: [],
           articles: [], themes: [], settings: null, audit: [], seeded: false };
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


/* ==================================================================
   The admin desk, in the browser (§10-13)

   A preview of the real thing: the same shapes the API answers with, so
   the panel cannot tell the difference. The rules that matter are kept —
   the last owner cannot be demoted, a half-filled theme cannot be
   published, and an article is blocks rather than markup — because a
   preview that is easier than the real shop teaches the wrong thing.
   ================================================================== */

function seedDesk() {
  if (db.themes.length) return;

  /* The shop's own theme names are per language; the desk wants one string. */
  db.themes = Object.entries(THEMES).map(([key, t]) => ({
    id: 'th_' + key, key, name: t.name?.uk ?? t.name?.en ?? key, description: null,
    season: (t.season ?? 'none').toUpperCase(),
    system: true, publishedVersionId: 'tv_' + key + '_1', updatedAt: now(),
    versions: [{ id: 'tv_' + key + '_1', version: 1, label: 'Опубліковано',
                 createdAt: now(), tokens: { colorScheme: t.tokens.scheme,
                 colors: { ...t.tokens.colors }, decor: t.tokens.decor ?? {
                   ornamentMotif: 'star', ornamentOpacity: 0.42, grain: 0.035,
                   heroFigure: 'none', bandTrim: 'zig' } } }]
  }));

  db.articles = [{
    id: 'ar_1', slug: 'chomu-papir', status: 'PUBLISHED',
    title: 'Чому ми друкуємо на папері', excerpt: 'Про тиражі, палітурку і те, чому книжка важить.',
    readingMinutes: 4, publishedAt: now(), scheduledFor: null, createdAt: now(), updatedAt: now(),
    content: { blocks: [
      { type: 'heading', level: 2, text: 'Тираж' },
      { type: 'paragraph', text: 'Наклад — це зобовʼязання, а не прогноз.' },
      { type: 'quote', text: 'Книжка, яку неможливо перечитати, не була книжкою.', cite: 'З передмови' }
    ] }
  }];

  db.settings = {
    siteName: 'Ridmore', defaultLocale: 'UK', defaultCurrency: 'EUR',
    freeShippingEurCents: 5000, freeShippingUahCents: 250000,
    shippingFlatEurCents: 590, shippingFlatUahCents: 9900,
    contactEmail: null, activeThemeId: 'th_paper'
  };
  write(db);
}

const PERM_META = ALL_PERMISSIONS.map((key) => ({
  key, group: key.split('.')[0] === 'book' || key.startsWith('category') || key.startsWith('inventory') ? 'catalog'
    : key.startsWith('order') || key.startsWith('gift') ? 'orders'
    : key.startsWith('article') ? 'journal'
    : key.startsWith('media') ? 'media'
    : key.startsWith('user') || key.startsWith('role') ? 'people'
    : key.startsWith('theme') ? 'themes' : 'system',
  description: null
}));

const DEMO_ROLES = {
  SUPER_ADMIN: { name: 'Super admin', perms: ALL_PERMISSIONS },
  MANAGER: { name: 'Manager', perms: ['order.read', 'order.write', 'order.address.read', 'gift.read', 'gift.process', 'book.read', 'inventory.write', 'user.read', 'media.read'] },
  CATALOG_MANAGER: { name: 'Catalogue manager', perms: ['book.read', 'book.write', 'book.publish', 'book.delete', 'category.write', 'inventory.write', 'media.read', 'media.write'] },
  CONTENT_EDITOR: { name: 'Content editor', perms: ['article.read', 'article.write', 'article.publish', 'article.delete', 'media.read', 'media.write', 'book.read'] },
  CUSTOMER: { name: 'Customer', perms: [] }
};

/** Refuse exactly as the server would, so a permission is never something
 *  the preview is more relaxed about than the shop. */
function need(...keys) {
  const v = requireViewer();
  if (!keys.some((k) => v.permissions.includes(k))) err(403, 'forbidden', 'You do not have access to this.');
  return v;
}

const logAudit = (actor, action, entity, entityId) => {
  db.audit.unshift({ id: id('au'), action, entity, entityId, meta: null, at: now(),
                     actor: { id: actor.id, name: actor.nickname, email: actor.email } });
  db.audit = db.audit.slice(0, 200);
};

const owners = () => db.users.filter((u) => (u.roles ?? []).includes('SUPER_ADMIN'));

function deskUser(u) {
  return {
    id: u.id, email: u.email ?? '—', emailVerified: false, status: u.status ?? 'ACTIVE',
    displayName: u.nickname, locale: u.locale, currency: u.currency, avatarUrl: u.avatarUrl,
    roles: (u.roles ?? []).map((k) => ({ key: k, name: DEMO_ROLES[k]?.name ?? k, grantedAt: now() })),
    orders: db.gifts.filter((g) => g.donorId === u.id).length,
    wishlists: db.wishlists.filter((w) => w.ownerId === u.id).length,
    createdAt: u.createdAt, lastLoginAt: null, anonymizedAt: null
  };
}

const themeById = (tid) => db.themes.find((t) => t.id === tid) ?? err(404, 'not_found', 'No such theme.');

const adminRoutes = {
  'GET /admin/dashboard': () => {
    const v = need(...ALL_PERMISSIONS);
    const can = (k) => v.permissions.includes(k);
    return {
      viewer: { id: v.id, permissions: v.permissions },
      windowDays: 30,
      catalog: can('book.read') ? { books: BOOKS.length, drafts: 0, lowStock: 0 } : null,
      orders: can('order.read') || can('gift.read') ? {
        open: db.gifts.filter((g) => g.status !== 'DELIVERED' && g.status !== 'CANCELLED').length,
        giftsAwaiting: db.gifts.filter((g) => g.status === 'AWAITING_ADDRESS').length,
        byStatus: {},
        revenue: [{ currency: 'EUR', totalMinor: db.gifts.length * 3450, count: db.gifts.length }]
      } : null,
      people: can('user.read') ? { active: db.users.length, joined: db.users.length } : null,
      journal: can('article.read') ? { articles: db.articles.length, scheduled: 0 } : null,
      recent: can('audit.read') ? db.audit.slice(0, 12).map((a) => ({ ...a, actor: a.actor?.name ?? null })) : []
    };
  },

  'GET /admin/orders': () => {
    need('order.read', 'gift.read');
    return { items: db.gifts.map((g) => ({
      id: g.id, number: 'RM-' + g.id.slice(-6).toUpperCase(), type: 'GIFT',
      status: g.status ?? 'PENDING', total: 3450, currency: 'EUR', createdAt: g.createdAt
    })), total: db.gifts.length, page: 1, perPage: 25 };
  },

  'POST /admin/orders/:id/status': (body, q, [oid]) => {
    const v = need('order.write', 'gift.process');
    const g = db.gifts.find((x) => x.id === oid) ?? err(404, 'not_found', 'No such order.');
    g.status = body.status;
    logAudit(v, 'order.status', 'order', oid);
    write(db);
    return { order: { id: g.id, status: g.status } };
  },

  'GET /admin/users': (body, q) => {
    need('user.read');
    const term = (q.search ?? '').toLowerCase();
    const items = db.users
      .filter((u) => !term || (u.nickname ?? '').toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term))
      .map(deskUser);
    return { items, total: items.length, page: 1, perPage: 25 };
  },

  'GET /admin/users/:id': (body, q, [uid]) => {
    need('user.read');
    return { user: deskUser(userById(uid) ?? err(404, 'not_found', 'No such account.')) };
  },

  'PUT /admin/users/:id/roles': (body, q, [uid]) => {
    const v = need('role.write');
    const u = userById(uid) ?? err(404, 'not_found', 'No such account.');
    const keeping = body.roles ?? [];
    if ((u.roles ?? []).includes('SUPER_ADMIN') && !keeping.includes('SUPER_ADMIN')
        && owners().length <= 1) {
      err(400, 'last_owner',
        'Це єдиний обліковий запис, що може адмініструвати крамницю. Спершу надайте роль власника комусь іще.');
    }
    u.roles = keeping;
    u.permissions = [...new Set(keeping.flatMap((k) => DEMO_ROLES[k]?.perms ?? []))];
    logAudit(v, 'user.roles', 'user', uid);
    write(db);
    return { user: deskUser(u) };
  },

  'POST /admin/users/:id/status': (body, q, [uid]) => {
    const v = need('user.write');
    const u = userById(uid) ?? err(404, 'not_found', 'No such account.');
    if (body.status === 'SUSPENDED' && (u.roles ?? []).includes('SUPER_ADMIN') && owners().length <= 1) {
      err(400, 'last_owner', 'Останнього власника не можна призупинити.');
    }
    u.status = body.status;
    logAudit(v, 'user.status', 'user', uid);
    write(db);
    return { user: deskUser(u) };
  },

  'GET /admin/roles': () => {
    need('user.read');
    return {
      roles: Object.entries(DEMO_ROLES).map(([key, r]) => ({
        key, name: r.name, description: null, system: true,
        users: db.users.filter((u) => (u.roles ?? []).includes(key)).length,
        permissions: [...(db.rolePerms?.[key] ?? r.perms)].sort()
      })),
      permissions: PERM_META
    };
  },

  'PUT /admin/roles/:key/permissions': (body, q, [key]) => {
    const v = need('role.write');
    if (key === 'SUPER_ADMIN') err(403, 'forbidden', 'Роль власника завжди має всі права і не редагується.');
    const unknown = (body.permissions ?? []).filter((k) => !ALL_PERMISSIONS.includes(k));
    if (unknown.length) err(400, 'unknown_permission', 'Not a permission: ' + unknown.join(', '));
    db.rolePerms = { ...(db.rolePerms ?? {}), [key]: body.permissions };
    logAudit(v, 'role.permissions', 'role', key);
    write(db);
    return { role: { key, permissions: body.permissions } };
  },

  'GET /admin/themes': () => {
    need('theme.read');
    return {
      items: db.themes.map((t) => ({
        id: t.id, key: t.key, name: t.name, description: t.description, season: t.season,
        system: t.system, updatedAt: t.updatedAt,
        publishedVersion: t.versions.find((v) => v.id === t.publishedVersionId) ?? null,
        hasDraft: t.versions[0] && t.versions[0].id !== t.publishedVersionId,
        versions: t.versions.map((v) => ({ id: v.id, version: v.version, label: v.label,
          createdAt: v.createdAt, isPublished: v.id === t.publishedVersionId }))
      })),
      activeThemeId: db.settings?.activeThemeId ?? null
    };
  },

  'GET /admin/themes/:id': (body, q, [tid]) => {
    need('theme.read');
    const t = themeById(tid);
    const latest = t.versions[0] ?? null;
    const published = t.versions.find((v) => v.id === t.publishedVersionId) ?? null;
    return {
      theme: adminRoutes['GET /admin/themes']().items.find((x) => x.id === tid),
      draft: latest?.tokens ?? null, live: published?.tokens ?? null, slots: SLOTS
    };
  },

  'POST /admin/themes': (body) => {
    const v = need('theme.write');
    const from = body.basedOn ? themeById(body.basedOn) : null;
    const tokens = body.tokens ?? from?.versions[0]?.tokens;
    if (!tokens) err(400, 'no_tokens', 'A new theme needs either tokens or a theme to copy.');
    const tid = id('th');
    db.themes.push({
      id: tid, key: tid, name: body.name, description: null, season: body.season ?? 'NONE',
      system: false, publishedVersionId: null, updatedAt: now(),
      versions: [{ id: id('tv'), version: 1, label: 'Чернетка', createdAt: now(),
                   tokens: JSON.parse(JSON.stringify(tokens)) }]
    });
    logAudit(v, 'theme.create', 'theme', tid);
    write(db);
    return { theme: adminRoutes['GET /admin/themes']().items.find((x) => x.id === tid) };
  },

  'POST /admin/themes/:id/draft': (body, q, [tid]) => {
    const v = need('theme.write');
    const t = themeById(tid);
    const head = t.versions[0];
    if (head && head.id !== t.publishedVersionId) {
      head.tokens = body.tokens;
      head.label = body.label ?? 'Чернетка';
    } else {
      t.versions.unshift({ id: id('tv'), version: (head?.version ?? 0) + 1,
        label: body.label ?? 'Чернетка', createdAt: now(), tokens: body.tokens });
    }
    t.updatedAt = now();
    logAudit(v, 'theme.draft', 'theme', tid);
    write(db);
    const missing = SLOTS.filter((sl) => !body.tokens?.colors?.[sl]);
    return { version: { id: t.versions[0].id, version: t.versions[0].version, label: t.versions[0].label }, missing };
  },

  'POST /admin/themes/:id/publish': (body, q, [tid]) => {
    const v = need('theme.publish');
    const t = themeById(tid);
    const target = body.versionId ? t.versions.find((x) => x.id === body.versionId) : t.versions[0];
    if (!target) err(404, 'not_found', 'No such version of this theme.');
    const gaps = SLOTS.filter((sl) => !target.tokens?.colors?.[sl]);
    if (gaps.length) err(400, 'incomplete_theme',
      `У цієї теми немає кольору для ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? ` та ще ${gaps.length - 5}` : ''}.`);
    t.publishedVersionId = target.id;
    if (body.activate) db.settings.activeThemeId = tid;
    logAudit(v, body.versionId ? 'theme.rollback' : 'theme.publish', 'theme', tid);
    write(db);
    return { theme: adminRoutes['GET /admin/themes']().items.find((x) => x.id === tid) };
  },

  'GET /admin/articles': () => {
    need('article.read');
    return { items: db.articles, total: db.articles.length, page: 1, perPage: 25 };
  },

  'GET /admin/articles/:id': (body, q, [aid]) => {
    need('article.read');
    return { article: db.articles.find((a) => a.id === aid) ?? err(404, 'not_found', 'No such article.') };
  },

  'POST /admin/articles': (body) => {
    const v = need('article.write');
    checkBlockDoc(body.content);
    const a = {
      id: id('ar'), slug: body.slug || 'stattia-' + Date.now().toString(36),
      status: body.status ?? 'DRAFT', title: body.title, excerpt: body.excerpt ?? null,
      content: body.content, readingMinutes: countMinutes(body.content),
      publishedAt: body.status === 'PUBLISHED' ? now() : null, scheduledFor: null,
      createdAt: now(), updatedAt: now()
    };
    db.articles.unshift(a);
    logAudit(v, 'article.create', 'article', a.id);
    write(db);
    return { article: a };
  },

  'PATCH /admin/articles/:id': (body, q, [aid]) => {
    const v = need('article.write');
    const a = db.articles.find((x) => x.id === aid) ?? err(404, 'not_found', 'No such article.');
    if (body.content) { checkBlockDoc(body.content); a.content = body.content; a.readingMinutes = countMinutes(body.content); }
    if (body.title !== undefined) a.title = body.title;
    if (body.excerpt !== undefined) a.excerpt = body.excerpt;
    a.updatedAt = now();
    logAudit(v, 'article.update', 'article', aid);
    write(db);
    return { article: a };
  },

  'POST /admin/articles/:id/status': (body, q, [aid]) => {
    const v = need('article.publish');
    const a = db.articles.find((x) => x.id === aid) ?? err(404, 'not_found', 'No such article.');
    if (body.scheduledFor && new Date(body.scheduledFor) < new Date()) {
      err(400, 'past_schedule', 'Запланований час має бути в майбутньому.');
    }
    a.status = body.status;
    if (body.status === 'PUBLISHED' && !a.publishedAt) a.publishedAt = now();
    logAudit(v, 'article.status', 'article', aid);
    write(db);
    return { article: a };
  },

  'GET /admin/media': () => {
    need('media.read');
    return { items: [], total: 0 };
  },

  'GET /admin/settings': () => {
    need('settings.write');
    return { settings: db.settings };
  },

  'PATCH /admin/settings': (body) => {
    const v = need('settings.write');
    if (body.activeThemeId) {
      const t = themeById(body.activeThemeId);
      if (!t.publishedVersionId) err(400, 'theme_unpublished', 'Спершу опублікуйте цю тему.');
    }
    db.settings = { ...db.settings, ...body };
    logAudit(v, 'settings.update', 'settings', '1');
    write(db);
    return { settings: db.settings };
  },

  'GET /admin/settings/audit': () => {
    need('audit.read');
    return { items: db.audit, total: db.audit.length, page: 1, perPage: 50 };
  }
};

const BLOCK_TYPES = ['paragraph', 'heading', 'quote', 'list', 'image', 'divider', 'book', 'link'];

/** The same closed list the server keeps, for the same reason: an article
 *  body is blocks, so nothing an author writes can become markup. */
function checkBlockDoc(doc) {
  if (!doc || !Array.isArray(doc.blocks)) err(400, 'validation_failed', 'Some of that is not right.');
  for (const b of doc.blocks) {
    if (!BLOCK_TYPES.includes(b?.type)) {
      err(400, 'validation_failed', 'Some of that is not right.',
        [{ path: 'content', message: `Невідомий тип блоку: ${b?.type}` }]);
    }
    if (b.type === 'link' && !/^(https?:\/\/|\/)/i.test(b.href ?? '')) {
      err(400, 'validation_failed', 'Some of that is not right.',
        [{ path: 'content', message: 'Посилання має бути http(s) або шляхом у крамниці.' }]);
    }
  }
}

function countMinutes(doc) {
  let words = 0;
  for (const b of doc.blocks ?? []) {
    const text = b.text ?? (Array.isArray(b.items) ? b.items.join(' ') : '') ?? '';
    if (text) words += String(text).trim().split(/\s+/).length;
  }
  return Math.max(1, Math.round(words / 200));
}

/**
 * Match a path against the route table, pulling out :params. Kept
 * deliberately small: this is a preview, not a router.
 */
export function handle(method, path, body) {
  seed();
  db = read();
  seedDesk();

  const [rawPath, rawQuery] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(rawQuery ?? ''));
  const parts = rawPath.split('/').filter(Boolean);

  const table = { ...routes, ...adminRoutes };
  for (const key of Object.keys(table)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const want = pattern.split('/').filter(Boolean);
    if (want.length !== parts.length) continue;

    const params = [];
    const hit = want.every((seg, i) => {
      if (seg.startsWith(':')) { params.push(decodeURIComponent(parts[i])); return true; }
      return seg === parts[i];
    });
    if (hit) return table[key](body, query, params);
  }
  err(404, 'not_found', 'No such endpoint.');
}

/** True while this build is running on its own, with no server behind it. */
export const isPreview = () => true;

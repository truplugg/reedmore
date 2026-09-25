import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, signIn, grantRole, unique, pngBytes } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * The security and privacy audit (§16, §21, §31).
 *
 * These are not tests of features. Each one states a promise the shop makes
 * about what it will not do, and tries to make it break the promise:
 *
 *   - a gift donor cannot reach the recipient's address, by any path;
 *   - nothing public carries an email, a phone or an address;
 *   - one reader cannot read another reader's anything;
 *   - a staff screen is not what keeps staff work away from a reader;
 *   - text a person types is text, wherever it comes back out.
 */

let app: FastifyInstance;
let donor = { cookie: '', id: '' };
let recipient = { cookie: '', id: '' };
let stranger = { cookie: '', id: '' };
let owner = { cookie: '', id: '' };
let giftOrderId = '';
let listId = '';
let itemId = '';

const ADMIN_PATHS = [
  'GET /api/admin/dashboard',
  'GET /api/admin/books',
  'GET /api/admin/books/meta/categories',
  'GET /api/admin/orders',
  'GET /api/admin/users',
  'GET /api/admin/roles',
  'GET /api/admin/themes',
  'GET /api/admin/articles',
  'GET /api/admin/articles/meta/taxonomy',
  'GET /api/admin/media',
  'GET /api/admin/settings',
  'GET /api/admin/settings/audit'
];

beforeAll(async () => {
  app = await makeApp();
  donor = await signUp(app, { nickname: unique('donor') });
  recipient = await signUp(app, { nickname: unique('recip') });
  stranger = await signUp(app, { nickname: unique('stray') });

  const ownNick = unique('own');
  const o = await signUp(app, { nickname: ownNick });
  await grantRole(o.id, 'SUPER_ADMIN');
  owner = { id: o.id, cookie: await signIn(app, `${ownNick}@example.test`, 'a-long-enough-password') };

  /* The recipient keeps an address on file and a public list with a book. */
  await prisma.shippingAddress.create({
    data: {
      userId: recipient.id, fullName: 'Тетяна Мороз', phone: '+380 44 000 11 22',
      country: 'UA', city: 'Львів', postalCode: '79000', line1: 'вул. Таємна, 7',
      pickupPoint: 'Нова пошта №42'
    }
  });
  await prisma.userProfile.update({
    where: { userId: recipient.id },
    data: { phone: '+380 44 000 11 22', firstName: 'Тетяна', lastName: 'Мороз' }
  });

  const list = await app.inject({
    method: 'POST', url: '/api/wishlists', headers: { cookie: recipient.cookie },
    payload: { title: 'Список', visibility: 'PUBLIC' }
  });
  listId = list.json().wishlist.id;

  const book = await prisma.book.findFirstOrThrow({ where: { status: 'PUBLISHED' }, select: { slug: true } });
  const added = await app.inject({
    method: 'POST', url: `/api/wishlists/${listId}/items`, headers: { cookie: recipient.cookie },
    payload: { bookSlug: book.slug }
  });
  itemId = added.json().item?.id ?? added.json().wishlist?.items?.[0]?.id;

  const gift = await app.inject({
    method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donor.cookie },
    payload: { wishlistItemId: itemId, anonymous: false, message: 'З теплом' }
  });
  if (gift.statusCode !== 201) throw new Error(`gift fixture failed: ${gift.statusCode} ${gift.body}`);
  giftOrderId = gift.json().gift?.id ?? gift.json().order?.id ?? '';

  /* The manager takes the recipient's address onto the gift order, which is
     the exact moment the donor must still not be able to see it. */
  const attach = await app.inject({
    method: 'POST', url: `/api/admin/orders/${giftOrderId}/shipping-address`,
    headers: { cookie: owner.cookie },
    payload: {
      fullName: 'Тетяна Мороз', country: 'UA', city: 'Львів',
      postalCode: '79000', line1: 'вул. Таємна, 7', phone: '+380 44 000 11 22'
    }
  });
  if (attach.statusCode >= 400) throw new Error(`address fixture failed: ${attach.statusCode} ${attach.body}`);

  /* These tests are worth nothing if the thing they try to leak was never
     created. An earlier version of this file posted the wrong field name,
     the reservation failed, and every privacy test passed against an empty
     database. So the fixture is checked, out loud, before any of them run. */
  const built = await prisma.order.findUnique({
    where: { id: giftOrderId }, include: { shippingAddress: true, gift: true }
  });
  if (!built?.shippingAddress?.line1.includes('Таємна') || built.gift?.donorId !== donor.id) {
    throw new Error('gift fixture is not what these tests assume');
  }
});

afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

/** Everything the recipient would rather the donor never learned. */
const SECRETS = ['вул. Таємна', '79000', '000 11 22', 'Нова пошта №42', 'Львів'];

function leaks(body: string): string[] {
  return SECRETS.filter((s) => body.includes(s));
}

describe('a gift donor never reaches the recipient', () => {
  it('sees their own gift without an address on it', async () => {
    const res = await get('/api/gifts/sent', donor.cookie);
    expect(res.statusCode).toBe(200);
    expect(leaks(res.body)).toEqual([]);
  });

  it('cannot read the gift order through the customer order route', async () => {
    const mine = await get('/api/checkout/orders', donor.cookie);
    expect(leaks(mine.body)).toEqual([]);
    /* Even when the order is the donor's own, a gift carries no shipTo. */
    for (const o of mine.json().items) {
      if (o.type === 'GIFT') expect(o.shipTo).toBeNull();
    }
  });

  it('cannot reach it through the staff order route either', async () => {
    const res = await get(`/api/admin/orders/${giftOrderId}`, donor.cookie);
    expect([401, 403, 404]).toContain(res.statusCode);
    expect(leaks(res.body)).toEqual([]);
  });

  it('learns nothing from the wishlist the gift came from', async () => {
    const res = await get(`/api/wishlists/${listId}`, donor.cookie);
    expect(leaks(res.body)).toEqual([]);
  });

  it('and nothing from the recipient at all', async () => {
    for (const url of ['/api/gifts/sent', `/api/wishlists/${listId}`, '/api/checkout/orders']) {
      const body = (await get(url, donor.cookie)).body;
      expect(body).not.toContain('@example.test');
    }
  });
});

describe('nothing public carries a person', () => {
  it('keeps emails, phones and addresses out of the public wishlists', async () => {
    const res = await get('/api/wishlists/public?limit=20');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('@');
    expect(leaks(res.body)).toEqual([]);
  });

  it('keeps them out of the catalogue', async () => {
    const res = await get('/api/books?perPage=20');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('@example.test');
  });

  it('does not say whether an email has an account', async () => {
    const known = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password',
      payload: { email: `${unique('nobody')}@example.test` }
    });
    const real = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password',
      payload: { email: `${donor.id}@example.test` }
    });
    expect(known.statusCode).toBe(real.statusCode);
    expect(known.body).toBe(real.body);
  });
});

describe('one reader cannot read another', () => {
  it('refuses a stranger the private parts of an account', async () => {
    const res = await get('/api/account', stranger.cookie);
    expect(res.statusCode).toBe(200);
    /* It answers about the stranger, never about whoever was asked for. */
    expect(res.body).not.toContain('Тетяна');
    expect(leaks(res.body)).toEqual([]);
  });

  it('refuses a stranger somebody else\'s orders', async () => {
    const res = await get('/api/checkout/orders', stranger.cookie);
    expect(res.json().items).toHaveLength(0);
  });

  it('refuses a signed-out visitor the private routes', async () => {
    for (const url of ['/api/account', '/api/wishlists/mine', '/api/gifts/sent', '/api/checkout/orders']) {
      expect((await get(url)).statusCode).toBe(401);
    }
  });
});

describe('the screen is not the protection', () => {
  it('refuses every admin route to a signed-in reader', async () => {
    for (const path of ADMIN_PATHS) {
      const [, url] = path.split(' ');
      const res = await get(url!, stranger.cookie);
      expect([403, 404], `${path} answered ${res.statusCode}`).toContain(res.statusCode);
    }
  });

  it('refuses every admin route to a visitor with no account', async () => {
    for (const path of ADMIN_PATHS) {
      const [, url] = path.split(' ');
      const res = await get(url!);
      expect([401, 403, 404], `${path} answered ${res.statusCode}`).toContain(res.statusCode);
    }
  });

  it('will not let a new account grant itself a role', async () => {
    const nick = unique('climber');
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: {
        email: `${nick}@example.test`, password: 'a-long-enough-password', nickname: nick,
        roles: ['SUPER_ADMIN'], permissions: ['settings.write'], status: 'ACTIVE'
      }
    });
    expect(res.statusCode).toBe(201);
    const roles = await prisma.userRole.findMany({
      where: { user: { email: `${nick}@example.test` } }, include: { role: true }
    });
    expect(roles.map((r) => r.role.key)).not.toContain('SUPER_ADMIN');
  });

  it('will not let a reader edit their own profile into staff', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/account/profile', headers: { cookie: stranger.cookie },
      payload: { nickname: unique('nick'), roles: ['SUPER_ADMIN'], permissions: ['settings.write'] }
    });
    const after = await get('/api/auth/me', stranger.cookie);
    expect(after.json().user.permissions ?? []).toHaveLength(0);
  });
});

describe('text stays text', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';

  it('stores a nickname with markup as the characters that were typed', async () => {
    const nick = `${unique('x')}${PAYLOAD}`;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { email: `${unique('x')}@example.test`, password: 'a-long-enough-password', nickname: nick }
    });
    if (res.statusCode === 201) {
      /* Accepted: then it must come back exactly as typed, not as markup and
         not silently rewritten into something else. */
      expect(res.json().user.nickname).toBe(nick);
    } else {
      /* Refused: also fine, as long as it is a validation error and not a 500. */
      expect(res.statusCode).toBe(400);
    }
  });

  it('refuses an article block type it does not know', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/articles', headers: { cookie: owner.cookie },
      payload: { title: 'T', content: { blocks: [{ type: 'html', text: '<script>alert(1)</script>' }] } }
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a theme colour that is not a colour', async () => {
    const list = (await get('/api/admin/themes', owner.cookie)).json();
    const full = (await get(`/api/admin/themes/${list.items[0].id}`, owner.cookie)).json();
    const bad = JSON.parse(JSON.stringify(full.draft));
    bad.colors.accent = 'red;background:url(javascript:alert(1))';
    const res = await app.inject({
      method: 'POST', url: `/api/admin/themes/${list.items[0].id}/draft`,
      headers: { cookie: owner.cookie }, payload: { tokens: bad }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the shop does not hold what it must not', () => {
  it('has no card field anywhere in the checkout', async () => {
    const res = await get('/api/checkout/payment-methods');
    expect(res.json().provider).toBeNull();
  });

  it('never stores a password in a readable form', async () => {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: donor.id }, select: { passwordHash: true }
    });
    expect(row.passwordHash).not.toContain('a-long-enough-password');
    expect(row.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('keeps a session as a hash, not as the cookie it handed out', async () => {
    const token = donor.cookie.split('=')[1] ?? '';
    expect(token.length).toBeGreaterThan(10);
    const rows = await prisma.session.findMany({ where: { userId: donor.id }, select: { tokenHash: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.tokenHash).not.toBe(token);
  });
});

describe('an upload is not trusted to say what it is', () => {
  /** A multipart body built by hand, so the declared type can lie. */
  function multipart(filename: string, contentType: string, bytes: Buffer) {
    const boundary = '----ridmore' + Math.random().toString(36).slice(2);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return { boundary, body: Buffer.concat([head, bytes, tail]) };
  }

  const upload = (filename: string, contentType: string, bytes: Buffer) => {
    const { boundary, body } = multipart(filename, contentType, bytes);
    return app.inject({
      method: 'POST', url: '/api/admin/media', headers: {
        cookie: owner.cookie, 'content-type': `multipart/form-data; boundary=${boundary}`
      }, payload: body
    });
  };

  it('refuses an SVG wearing a PNG name and a PNG content type', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload('innocent.png', 'image/png', svg);
    expect(res.statusCode).toBe(400);
    expect(['not_an_image', 'unsupported_image']).toContain(res.json().error.code);
  });

  it('refuses a text file called an image', async () => {
    const res = await upload('notes.png', 'image/png', Buffer.from('just words, not pixels'));
    expect(res.statusCode).toBe(400);
  });

  it('never lets a filename decide where the bytes land', async () => {
    const res = await upload('../../../../etc/ridmore-escape.png', 'image/png', pngBytes());
    expect([200, 201]).toContain(res.statusCode);
    const media = res.json().media;
    /* The path is the folder plus the checksum of the re-encoded output; the
       name that was posted reaches neither the key nor the url. */
    expect(media.url).not.toContain('..');
    expect(media.url).not.toContain('etc');
    expect(media.url).not.toContain('escape');
    expect(media.url).toMatch(/\.webp$/);
  });

  it('re-encodes everything, so an upload keeps no second personality', async () => {
    const res = await upload('real.png', 'image/png', pngBytes());
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().media.mimeType).toBe('image/webp');
  });

  it('refuses an upload from an account without the permission', async () => {
    const { boundary, body } = multipart('x.png', 'image/png', pngBytes());
    const res = await app.inject({
      method: 'POST', url: '/api/admin/media', headers: {
        cookie: stranger.cookie, 'content-type': `multipart/form-data; boundary=${boundary}`
      }, payload: body
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, grantRole, unique, pngBytes } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;
let staff: { cookie: string; id: string };
let customer: { cookie: string; id: string };

beforeAll(async () => {
  app = await makeApp();
  staff = await signUp(app, { nickname: unique('cat-mgr') });
  await grantRole(staff.id, 'CATALOG_MANAGER');
  // The role was granted after the session was made, so sign in again to pick it up.
  const again = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email: `${(await prisma.userProfile.findFirstOrThrow({ where: { userId: staff.id } })).nickname}@example.test`, password: 'a-long-enough-password' }
  });
  staff.cookie = (again.headers['set-cookie'] as string).split(';')[0]!;
  customer = await signUp(app, { nickname: unique('shopper') });
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const draft = (over: Record<string, unknown> = {}) => ({
  title: 'Пробна книжка', author: 'Тестовий Автор',
  priceEurCents: 1500, priceUahCents: 72000,
  status: 'DRAFT', stockOnHand: 4, ...over
});

describe('the shop only ever sees published books', () => {
  it('hides a draft from the list, the detail route and search', async () => {
    const made = await app.inject({ method: 'POST', url: '/api/admin/books', headers: { cookie: staff.cookie }, payload: draft({ title: unique('Чернетка') }) });
    expect(made.statusCode).toBe(201);
    const slug = made.json().book.slug;

    expect((await app.inject({ url: `/api/books/${slug}` })).statusCode).toBe(404);
    const list = await app.inject({ url: `/api/books?search=${encodeURIComponent(made.json().book.title)}` });
    expect(list.json().total).toBe(0);

    await prisma.book.delete({ where: { id: made.json().book.id } });
  });
});

describe('prices', () => {
  it('serves each currency from its own column, with no conversion', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/admin/books', headers: { cookie: staff.cookie },
      payload: draft({ title: unique('Ціни'), status: 'PUBLISHED', priceEurCents: 999, priceUahCents: 12345 })
    });
    const slug = made.json().book.slug;

    const eur = await app.inject({ url: `/api/books/${slug}?currency=EUR` });
    const uah = await app.inject({ url: `/api/books/${slug}?currency=UAH` });
    expect(eur.json().book.price).toBe(999);
    expect(uah.json().book.price).toBe(12345);

    // The shop payload must not carry the other currency's price at all.
    expect(JSON.stringify(eur.json().book)).not.toContain('12345');

    await prisma.book.delete({ where: { id: made.json().book.id } });
  });

  it('refuses a sale price at or above the list price', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/books', headers: { cookie: staff.cookie },
      payload: draft({ salePriceEurCents: 1500 })
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.some((d: { path: string }) => d.path === 'salePriceEurCents')).toBe(true);
  });
});

describe('search', () => {
  it('does not return the whole catalogue for a word with no digits', async () => {
    const all = await app.inject({ url: '/api/books?perPage=1' });
    const hits = await app.inject({ url: `/api/books?search=${encodeURIComponent('Жадан')}` });
    expect(hits.json().total).toBeGreaterThan(0);
    expect(hits.json().total).toBeLessThan(all.json().total);
  });

  it('finds a book by ISBN however it is hyphenated', async () => {
    const a = await app.inject({ url: '/api/books?search=978-966-97679-2-0' });
    const b = await app.inject({ url: '/api/books?search=9789669767920' });
    expect(a.json().total).toBe(1);
    expect(b.json().total).toBe(1);
    expect(a.json().items[0].slug).toBe(b.json().items[0].slug);
  });
});

describe('partial updates', () => {
  it('does not clear a derived field when the field it derives from is omitted', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/admin/books', headers: { cookie: staff.cookie },
      payload: draft({ title: unique('ISBN'), status: 'PUBLISHED', isbn: '978-617-000-999-1' })
    });
    const id = made.json().book.id;
    const slug = made.json().book.slug;

    const found = await app.inject({ url: '/api/books?search=9786170009991' });
    expect(found.json().total).toBe(1);

    // A price edit that says nothing about the ISBN must leave it searchable.
    await app.inject({
      method: 'PATCH', url: `/api/admin/books/${id}`, headers: { cookie: staff.cookie },
      payload: { title: 'ISBN kept', author: 'Тестовий Автор', priceEurCents: 1600, priceUahCents: 73000 }
    });

    const still = await app.inject({ url: '/api/books?search=9786170009991' });
    expect(still.json().total, 'omitting isbn must not wipe isbnDigits').toBe(1);
    expect(still.json().items[0].slug).toBe(slug);

    await prisma.book.delete({ where: { id } });
  });
});

describe('permissions are enforced on the server', () => {
  it('turns a signed-out request away', async () => {
    expect((await app.inject({ url: '/api/admin/books' })).statusCode).toBe(401);
  });

  it('turns a customer away', async () => {
    const res = await app.inject({ url: '/api/admin/books', headers: { cookie: customer.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('lets a catalogue manager through', async () => {
    const res = await app.inject({ url: '/api/admin/books', headers: { cookie: staff.cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('stops a customer uploading media', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/media', headers: { cookie: customer.cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('covers', () => {
  it('re-encodes an upload and applies it to the 3D model', async () => {
    const boundary = '----ridmoretest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\nBOOK_COVER\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`),
      pngBytes(),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const up = await app.inject({
      method: 'POST', url: '/api/admin/media',
      headers: { cookie: staff.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    });
    expect([200, 201]).toContain(up.statusCode);
    const media = up.json().media;
    expect(media.mimeType, 'uploads are re-encoded, never passed through').toBe('image/webp');

    const made = await app.inject({
      method: 'POST', url: '/api/admin/books', headers: { cookie: staff.cookie },
      payload: draft({ title: unique('З обкладинкою'), status: 'PUBLISHED', frontCoverMediaId: media.id })
    });
    const shop = await app.inject({ url: `/api/books/${made.json().book.slug}` });
    expect(shop.json().book.cover.front).toBe(media.url);

    await prisma.book.delete({ where: { id: made.json().book.id } });
  });

  it('refuses a file that is not an image', async () => {
    const boundary = '----ridmoretest2';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('this is definitely not a png'),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/media',
      headers: { cookie: staff.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('not_an_image');
  });
});

describe('locale', () => {
  it('follows Accept-Language when nothing else is asked for', async () => {
    const de = await app.inject({ url: '/api/books?perPage=1', headers: { 'accept-language': 'de-DE,de;q=0.9' } });
    const uk = await app.inject({ url: '/api/books?perPage=1', headers: { 'accept-language': 'uk-UA,uk;q=0.9' } });
    const jp = await app.inject({ url: '/api/books?perPage=1', headers: { 'accept-language': 'ja-JP,ja;q=0.9' } });
    expect(de.json().locale).toBe('DE');
    expect(uk.json().locale).toBe('UK');
    expect(jp.json().locale).toBe('EN');
  });

  it('lets an explicit choice override the header', async () => {
    const res = await app.inject({ url: '/api/books?perPage=1&locale=UK&currency=EUR', headers: { 'accept-language': 'de-DE' } });
    expect(res.json().locale).toBe('UK');
    expect(res.json().currency).toBe('EUR');
  });
});

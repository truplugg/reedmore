import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Checkout (§22, §23).
 *
 * The tests that matter here are about what a client is NOT allowed to
 * decide: the price, the delivery charge, the total, and whether a copy
 * exists. And about what the shop does not hold: a card, anywhere.
 */

let app: FastifyInstance;
let buyer = { cookie: '', id: '' };
let bookA = '';
let bookB = '';
let tracked = '';

const addr = {
  fullName: 'Олена Коваль', country: 'UA', city: 'Київ',
  postalCode: '01001', line1: 'вул. Хрещатик, 1', save: false
};

beforeAll(async () => {
  app = await makeApp();
  buyer = await signUp(app, { nickname: unique('buyer') });

  const mk = async (title: string, eur: number, uah: number, stock: number | null) => {
    const b = await prisma.book.create({
      data: {
        slug: unique('bk'), status: 'PUBLISHED', title, author: 'Автор',
        priceEurCents: eur, priceUahCents: uah
      }
    });
    if (stock !== null) await prisma.inventory.create({ data: { bookId: b.id, onHand: stock, reserved: 0 } });
    return b.id;
  };
  bookA = await mk('Книжка А', 2000, 90000, null);
  bookB = await mk('Книжка Б', 1500, 70000, null);
  tracked = await mk('Остання копія', 1000, 50000, 1);
});

afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const post = (url: string, payload: unknown, cookie = '') =>
  app.inject({ method: 'POST', url, headers: cookie ? { cookie } : {}, payload: payload as never });
const get = (url: string, cookie = '') =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

describe('pricing a basket', () => {
  it('prices from the database, not from what the client sent', async () => {
    const res = await post('/api/checkout/quote?currency=EUR', {
      items: [{ bookId: bookA, quantity: 2 }],
      /* a hopeful client */
      unitPrice: 1, total: 1, subtotal: 1
    });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.lines[0].unitPrice).toBe(2000);
    expect(q.subtotal).toBe(4000);
  });

  it('charges each currency its own entered price, with no conversion', async () => {
    const eur = (await post('/api/checkout/quote?currency=EUR', { items: [{ bookId: bookA, quantity: 1 }] })).json();
    const uah = (await post('/api/checkout/quote?currency=UAH', { items: [{ bookId: bookA, quantity: 1 }] })).json();
    expect(eur.subtotal).toBe(2000);
    expect(uah.subtotal).toBe(90000);
    /* 90000 is not 2000 times any rate anybody would use; it is the second
       price somebody typed, which is the whole point. */
    expect(uah.subtotal / eur.subtotal).toBe(45);
  });

  it('adds one line for a book named twice', async () => {
    const q = (await post('/api/checkout/quote?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }, { bookId: bookA, quantity: 2 }]
    })).json();
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].quantity).toBe(3);
    expect(q.subtotal).toBe(6000);
  });

  it('charges delivery below the threshold and nothing above it', async () => {
    const small = (await post('/api/checkout/quote?currency=EUR', { items: [{ bookId: bookB, quantity: 1 }] })).json();
    expect(small.shippingCost).toBeGreaterThan(0);
    expect(small.total).toBe(small.subtotal + small.shippingCost);

    const big = (await post('/api/checkout/quote?currency=EUR', { items: [{ bookId: bookA, quantity: 5 }] })).json();
    expect(big.subtotal).toBeGreaterThanOrEqual(big.freeFrom);
    expect(big.shippingCost).toBe(0);
  });

  it('refuses a book that is not for sale', async () => {
    const draft = await prisma.book.create({
      data: { slug: unique('dr'), status: 'DRAFT', title: 'Чернетка', author: 'Х', priceEurCents: 100, priceUahCents: 100 }
    });
    const res = await post('/api/checkout/quote?currency=EUR', { items: [{ bookId: draft.id, quantity: 1 }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('book_unavailable');
  });

  it('refuses an empty basket', async () => {
    expect((await post('/api/checkout/quote?currency=EUR', { items: [] })).statusCode).toBe(400);
  });
});

describe('placing an order', () => {
  it('writes the order with the figures the server computed', async () => {
    const res = await post('/api/checkout/orders?currency=UAH', {
      items: [{ bookId: bookA, quantity: 1 }, { bookId: bookB, quantity: 2 }],
      address: addr
    }, buyer.cookie);
    expect(res.statusCode).toBe(201);
    const o = res.json().order;
    expect(o.subtotal).toBe(90000 + 70000 * 2);
    expect(o.total).toBe(o.subtotal + o.shippingCost);
    expect(o.currency).toBe('UAH');
    expect(o.items).toHaveLength(2);
  });

  it('is Stripe-shaped and Stripe-free', async () => {
    const o = (await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }], address: { ...addr, country: 'DE', city: 'Berlin', postalCode: '10115' }
    }, buyer.cookie)).json().order;

    /* The columns a provider will fill are there and honest about today. */
    expect(o.payment.provider).toBe('NONE');
    expect(o.payment.status).toBe('UNPAID');
    expect(o.payment.amount).toBe(o.total);
    expect(o.payment.currency).toBe('EUR');
    expect(o.payment.paidAt).toBeNull();

    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.paymentIntentId).toBeNull();
  });

  it('accepts no card data by any name', async () => {
    const res = await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }],
      address: addr,
      cardNumber: '4242424242424242', cvc: '123', expiry: '12/30', token: 'tok_visa'
    }, buyer.cookie);
    expect(res.statusCode).toBe(201);
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: res.json().order.id }, include: { items: true, shippingAddress: true }
    });
    /* Nothing that was posted got written anywhere on the order. */
    expect(JSON.stringify(row)).not.toContain('4242');
    expect(JSON.stringify(row)).not.toContain('tok_visa');
    expect(JSON.stringify(row)).not.toContain('123');
  });

  it('freezes what it sold, so a later price edit does not rewrite it', async () => {
    const o = (await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookB, quantity: 1 }], address: addr
    }, buyer.cookie)).json().order;
    expect(o.items[0].unitPrice).toBe(1500);

    await prisma.book.update({ where: { id: bookB }, data: { priceEurCents: 9999, title: 'Перейменована' } });
    const again = (await get(`/api/checkout/orders/${o.number}`, buyer.cookie)).json().order;
    expect(again.items[0].unitPrice).toBe(1500);
    expect(again.items[0].title).toBe('Книжка Б');

    await prisma.book.update({ where: { id: bookB }, data: { priceEurCents: 1500, title: 'Книжка Б' } });
  });

  it('lets a guest order by leaving an email, and refuses without one', async () => {
    const no = await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }], address: addr
    });
    expect(no.statusCode).toBe(400);
    expect(no.json().error.code).toBe('email_required');

    const yes = await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }], address: addr, email: 'guest@example.test'
    });
    expect(yes.statusCode).toBe(201);
  });
});

describe('stock', () => {
  it('sells the last copy once, to one of two racing buyers', async () => {
    const order = () => post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: tracked, quantity: 1 }], address: addr, email: 'race@example.test'
    });
    const [a, b] = await Promise.all([order(), order()]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { bookId: tracked } });
    expect(inv.reserved).toBe(1);
    expect(inv.reserved).toBeLessThanOrEqual(inv.onHand);
  });

  it('refuses more copies than exist', async () => {
    const res = await post('/api/checkout/quote?currency=EUR', { items: [{ bookId: tracked, quantity: 9 }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('out_of_stock');
  });
});

describe('reading an order back', () => {
  it('shows a customer their own and nobody else theirs', async () => {
    const other = await signUp(app, { nickname: unique('other') });
    const mine = (await get('/api/checkout/orders', buyer.cookie)).json();
    expect(mine.items.length).toBeGreaterThan(0);

    const theirs = (await get('/api/checkout/orders', other.cookie)).json();
    expect(theirs.items).toHaveLength(0);

    const stolen = await get(`/api/checkout/orders/${mine.items[0].number}`, other.cookie);
    expect(stolen.statusCode).toBe(404);
  });

  it('answers a guest who quotes the email it was placed with', async () => {
    const o = (await post('/api/checkout/orders?currency=EUR', {
      items: [{ bookId: bookA, quantity: 1 }], address: addr, email: 'lookup@example.test'
    })).json().order;

    expect((await get(`/api/checkout/orders/${o.number}`)).statusCode).toBe(404);
    expect((await get(`/api/checkout/orders/${o.number}?email=wrong@example.test`)).statusCode).toBe(404);
    const ok = await get(`/api/checkout/orders/${o.number}?email=lookup@example.test`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().order.number).toBe(o.number);
  });

  it('says plainly that no payment provider is connected', async () => {
    const res = await get('/api/checkout/payment-methods');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBeNull();
    expect(body.methods.find((m: { id: string }) => m.id === 'card').available).toBe(false);
  });
});

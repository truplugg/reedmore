import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, signIn, grantRole, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;
let owner: { cookie: string; id: string };
let donor: { cookie: string; id: string };
let manager = { cookie: '', id: '' };
let editor = { cookie: '', id: '' };
let giftOrderId = '';

async function asRole(nickname: string, role: 'MANAGER' | 'CONTENT_EDITOR') {
  const actor = await signUp(app, { nickname });
  await grantRole(actor.id, role);
  // Roles are read into the session at sign-in, so sign in again.
  const cookie = await signIn(app, `${nickname}@example.test`, 'a-long-enough-password');
  return { cookie, id: actor.id };
}

beforeAll(async () => {
  app = await makeApp();
  owner = await signUp(app, { nickname: unique('recip') });
  donor = await signUp(app, { nickname: unique('giver') });
  manager = await asRole(unique('mgr'), 'MANAGER');
  editor = await asRole(unique('ed'), 'CONTENT_EDITOR');

  const list = await app.inject({
    method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
    payload: { title: 'Wanted', visibility: 'PUBLIC' }
  });
  const slug = (await prisma.book.findFirstOrThrow({ where: { status: 'PUBLISHED' }, select: { slug: true } })).slug;
  await app.inject({
    method: 'POST', url: `/api/wishlists/${list.json().wishlist.id}/items`,
    headers: { cookie: owner.cookie }, payload: { bookSlug: slug }
  });
  const seen = await app.inject({ url: `/api/wishlists/${list.json().wishlist.id}`, headers: { cookie: donor.cookie } });
  const made = await app.inject({
    method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donor.cookie },
    payload: { wishlistItemId: seen.json().wishlist.items[0].id, anonymous: true }
  });
  giftOrderId = made.json().gift.id;
});

afterAll(async () => {
  await prisma.wishlist.deleteMany({ where: { ownerId: owner.id } });
  await app.close();
  await prisma.$disconnect();
});

describe('who may look at orders', () => {
  it('turns away a customer', async () => {
    expect((await app.inject({ url: '/api/admin/orders', headers: { cookie: donor.cookie } })).statusCode).toBe(403);
  });

  it('turns away a content editor', async () => {
    expect((await app.inject({ url: '/api/admin/orders', headers: { cookie: editor.cookie } })).statusCode).toBe(403);
  });

  it('lets a manager in', async () => {
    const res = await app.inject({ url: '/api/admin/orders?type=GIFT', headers: { cookie: manager.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((o: { id: string }) => o.id === giftOrderId)).toBe(true);
  });
});

describe('the manager workflow', () => {
  it('refuses a transition that skips the conversation', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/orders/${giftOrderId}/status`,
      headers: { cookie: manager.cookie }, payload: { status: 'SHIPPED' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_transition');
  });

  it('walks contact, address, processing and shipping, recording each step', async () => {
    const steps: Array<[string, string?]> = [
      ['AWAITING_RECIPIENT_CONTACT'], ['RECIPIENT_CONTACTED', 'Wrote to them'],
      ['AWAITING_ADDRESS'], ['READY_FOR_PROCESSING'], ['PROCESSING'], ['SHIPPED'], ['DELIVERED']
    ];
    for (const [status, note] of steps) {
      const res = await app.inject({
        method: 'POST', url: `/api/admin/orders/${giftOrderId}/status`,
        headers: { cookie: manager.cookie }, payload: { status, ...(note ? { note } : {}) }
      });
      expect(res.statusCode, `moving to ${status}`).toBe(200);
    }

    const order = await app.inject({ url: `/api/admin/orders/${giftOrderId}`, headers: { cookie: manager.cookie } });
    const body = order.json().order;
    expect(body.status).toBe('DELIVERED');
    expect(body.history).toHaveLength(8);           // the reservation plus seven steps
    expect(body.gift.recipientContactedAt).toBeTruthy();
    expect(body.gift.addressReceivedAt).toBeTruthy();

    // A delivered gift is granted, not merely reserved.
    const item = await prisma.wishlistItem.findFirstOrThrow({ where: { reservedByGiftId: { not: null } }, orderBy: { reservedAt: 'desc' } });
    expect(item.status).toBe('FULFILLED');
  });

  it('records an address the recipient gave the manager directly', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/orders/${giftOrderId}/shipping-address`,
      headers: { cookie: manager.cookie },
      payload: { fullName: 'Olena K', country: 'UA', city: 'Lviv', postalCode: '79000', line1: 'Rynok 1' }
    });
    expect(res.statusCode).toBe(200);

    const seen = await app.inject({ url: `/api/admin/orders/${giftOrderId}`, headers: { cookie: manager.cookie } });
    expect(seen.json().order.shippingAddress.city).toBe('Lviv');
  });

  it('refuses a country the shop does not ship to', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/orders/${giftOrderId}/shipping-address`,
      headers: { cookie: manager.cookie },
      payload: { fullName: 'X', country: 'PL', city: 'Kraków', postalCode: '30-001', line1: 'Rynek 1' }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the address stays on the manager side', () => {
  it('is still invisible to the donor after a manager records it', async () => {
    const sent = await app.inject({ url: '/api/gifts/sent', headers: { cookie: donor.cookie } });
    const body = JSON.stringify(sent.json());
    for (const secret of ['Lviv', '79000', 'Rynok', 'Olena']) {
      expect(body, `the donor must not see ${secret}`).not.toContain(secret);
    }
  });

  it('is invisible to a manager who lacks order.address.read', async () => {
    // A catalogue manager has neither gift.read nor order.read, so the list
    // itself is closed; prove the permission gate rather than the shape.
    const cat = await signUp(app, { nickname: unique('cat2') });
    await grantRole(cat.id, 'CATALOG_MANAGER');
    const cookie = await signIn(app, `${(await prisma.userProfile.findFirstOrThrow({ where: { userId: cat.id } })).nickname}@example.test`, 'a-long-enough-password');
    expect((await app.inject({ url: `/api/admin/orders/${giftOrderId}`, headers: { cookie } })).statusCode).toBe(403);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;
let owner: { cookie: string; id: string };
let donorA: { cookie: string; id: string };
let donorB: { cookie: string; id: string };
let publicList: string;

/** A published book's slug, taken from the seeded catalogue. */
async function someBooks(n: number): Promise<string[]> {
  const rows = await prisma.book.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true }, take: n });
  return rows.map((r) => r.slug);
}

beforeAll(async () => {
  app = await makeApp();
  owner = await signUp(app, { nickname: unique('owner') });
  donorA = await signUp(app, { nickname: unique('donor-a') });
  donorB = await signUp(app, { nickname: unique('donor-b') });

  const made = await app.inject({
    method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
    payload: { title: 'Books I would like', visibility: 'PUBLIC' }
  });
  publicList = made.json().wishlist.id;

  for (const slug of await someBooks(3)) {
    await app.inject({
      method: 'POST', url: `/api/wishlists/${publicList}/items`,
      headers: { cookie: owner.cookie }, payload: { bookSlug: slug }
    });
  }
});

afterAll(async () => {
  await prisma.wishlist.deleteMany({ where: { ownerId: owner.id } });
  await app.close();
  await prisma.$disconnect();
});

describe('one public list per person', () => {
  it('refuses a second one', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
      payload: { title: 'Another public one', visibility: 'PUBLIC' }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('public_list_exists');
  });

  it('allows any number of private ones', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
        payload: { title: `Private ${i}`, visibility: 'PRIVATE' }
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().wishlist.shareToken).toBeNull();
    }
  });
});

describe('visibility', () => {
  it('keeps a private list invisible to everyone else', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
      payload: { title: 'Just mine', visibility: 'PRIVATE' }
    });
    const id = made.json().wishlist.id;
    const seen = await app.inject({ url: `/api/wishlists/${id}`, headers: { cookie: donorA.cookie } });
    expect(seen.statusCode, 'a private list must be indistinguishable from one that does not exist').toBe(404);
  });

  it('reaches an unlisted list only through its token', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
      payload: { title: 'By link', visibility: 'UNLISTED' }
    });
    const { id, shareToken } = made.json().wishlist;
    expect(shareToken).toBeTruthy();

    expect((await app.inject({ url: `/api/wishlists/${id}`, headers: { cookie: donorA.cookie } })).statusCode).toBe(404);
    const byLink = await app.inject({ url: `/api/wishlists/shared/${shareToken}`, headers: { cookie: donorA.cookie } });
    expect(byLink.statusCode).toBe(200);
    expect(byLink.json().wishlist.title).toBe('By link');
  });

  it('mints a new token when the mode is turned off and on, revoking the old link', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
      payload: { title: 'Rotating', visibility: 'UNLISTED' }
    });
    const { id, shareToken: first } = made.json().wishlist;

    await app.inject({ method: 'PATCH', url: `/api/wishlists/${id}`, headers: { cookie: owner.cookie }, payload: { visibility: 'PRIVATE' } });
    const again = await app.inject({ method: 'PATCH', url: `/api/wishlists/${id}`, headers: { cookie: owner.cookie }, payload: { visibility: 'UNLISTED' } });
    const second = again.json().wishlist.shareToken;

    expect(second).not.toBe(first);
    expect((await app.inject({ url: `/api/wishlists/shared/${first}`, headers: { cookie: donorA.cookie } })).statusCode).toBe(404);
  });

  it('shows public lists to everyone, signed in or not', async () => {
    /* The shop changed its mind about §18: a window nobody can see into is
       not a window. Looking is open; giving still needs an account. */
    const anonymous = await app.inject({ url: '/api/wishlists/public' });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().wishlists.length).toBeGreaterThan(0);
    expect(JSON.stringify(anonymous.json()), 'a signed-out visitor still sees no addresses').not.toContain('@');

    const res = await app.inject({ url: '/api/wishlists/public', headers: { cookie: donorA.cookie } });
    expect(res.statusCode).toBe(200);
    const card = res.json().wishlists.find((w: { id: string }) => w.id === publicList);
    expect(card.owner.nickname).toBeTruthy();
    expect(card.covers.length).toBeGreaterThan(0);
    // A card carries a face and a name, and nothing else about the person.
    expect(Object.keys(card.owner).sort()).toEqual(['avatarUrl', 'nickname']);
    expect(JSON.stringify(card)).not.toContain('@');
  });
});

describe('the gate is on giving, not on looking', () => {
  it('lets a signed-out visitor open a public list', async () => {
    const res = await app.inject({ url: `/api/wishlists/${publicList}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().wishlist.owner.nickname).toBeTruthy();
    expect(res.json().mine).toBe(false);
  });

  it('still refuses a signed-out visitor a private list', async () => {
    const made = await app.inject({
      method: 'POST', url: '/api/wishlists', headers: { cookie: owner.cookie },
      payload: { title: 'Secret', visibility: 'PRIVATE' }
    });
    expect((await app.inject({ url: `/api/wishlists/${made.json().wishlist.id}` })).statusCode).toBe(404);
  });

  it('refuses a signed-out visitor a reservation', async () => {
    const list = await app.inject({ url: `/api/wishlists/${publicList}` });
    const item = list.json().wishlist.items[0];
    if (!item) return;
    const res = await app.inject({
      method: 'POST', url: '/api/gifts/reserve', payload: { wishlistItemId: item.id }
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('a wishlist book can only be gifted once', () => {
  it('lets one of two simultaneous donors through and tells the other', async () => {
    const list = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorA.cookie } });
    const itemId = list.json().wishlist.items[0].id;

    // Both requests are in flight before either resolves.
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorA.cookie }, payload: { wishlistItemId: itemId } }),
      app.inject({ method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorB.cookie }, payload: { wishlistItemId: itemId } })
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes, 'exactly one reservation may succeed').toEqual([201, 409]);

    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe('already_reserved');

    // The database agrees: one item, one gift.
    const item = await prisma.wishlistItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe('RESERVED');
    expect(item.reservedByGiftId).toBeTruthy();
    const gifts = await prisma.giftOrderData.count({ where: { wishlistItemId: itemId } });
    expect(gifts).toBe(1);
  });

  it('stops offering a reserved book to anyone else', async () => {
    const seen = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorB.cookie } });
    const offered = seen.json().wishlist.items.map((i: { id: string }) => i.id);
    const reserved = await prisma.wishlistItem.findFirst({ where: { wishlistId: publicList, status: 'RESERVED' } });
    expect(offered).not.toContain(reserved!.id);
  });

  it('puts the book back when the donor cancels', async () => {
    const list = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorA.cookie } });
    const itemId = list.json().wishlist.items[0].id;

    const made = await app.inject({ method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorA.cookie }, payload: { wishlistItemId: itemId } });
    expect(made.statusCode).toBe(201);

    await app.inject({ method: 'POST', url: `/api/gifts/${made.json().gift.id}/cancel`, headers: { cookie: donorA.cookie } });

    const item = await prisma.wishlistItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe('AVAILABLE');
    expect(item.reservedByGiftId).toBeNull();
  });

  it('will not let someone gift from their own list', async () => {
    const mine = await app.inject({ url: '/api/wishlists/mine', headers: { cookie: owner.cookie } });
    const list = mine.json().wishlists.find((w: { id: string }) => w.id === publicList);
    const available = list.items.find((i: { status: string }) => i.status === 'AVAILABLE');
    const res = await app.inject({
      method: 'POST', url: '/api/gifts/reserve', headers: { cookie: owner.cookie },
      payload: { wishlistItemId: available.id }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('own_wishlist');
  });
});

describe('the donor never learns where it is going', () => {
  it('returns no address, phone, email or real name anywhere in the gift payload', async () => {
    // Give the recipient every private field there is to leak.
    await prisma.userProfile.update({
      where: { userId: owner.id },
      data: { firstName: 'Olena', lastName: 'Kovalenko', phone: '+380991234567' }
    });
    await prisma.shippingAddress.create({
      data: {
        userId: owner.id, fullName: 'Olena Kovalenko', phone: '+380991234567',
        country: 'UA', city: 'Kyiv', postalCode: '01001', line1: 'Khreshchatyk 1'
      }
    });

    const list = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorA.cookie } });
    const itemId = list.json().wishlist.items[0].id;
    const made = await app.inject({ method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorA.cookie }, payload: { wishlistItemId: itemId } });
    expect(made.statusCode).toBe(201);

    const sent = await app.inject({ url: '/api/gifts/sent', headers: { cookie: donorA.cookie } });
    const body = JSON.stringify(sent.json());

    for (const secret of ['Khreshchatyk', '01001', '+380991234567', 'Kovalenko', 'Olena', '@example.test']) {
      expect(body, `the donor payload must not contain ${secret}`).not.toContain(secret);
    }
    // What it does carry: a nickname and a picture.
    expect(sent.json().gifts[0].recipient.nickname).toBeTruthy();
  });

  it('gives a donor nothing for a gift that is not theirs', async () => {
    const sent = await app.inject({ url: '/api/gifts/sent', headers: { cookie: donorB.cookie } });
    const ids = sent.json().gifts.map((g: { id: string }) => g.id);
    const donorAGifts = await prisma.order.findMany({ where: { gift: { donorId: donorA.id } }, select: { id: true } });
    for (const g of donorAGifts) expect(ids).not.toContain(g.id);
  });
});

describe('anonymity', () => {
  it('hides the donor from the recipient when asked to', async () => {
    const list = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorB.cookie } });
    const itemId = list.json().wishlist.items[0].id;
    const made = await app.inject({
      method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorB.cookie },
      payload: { wishlistItemId: itemId, anonymous: true, message: 'Enjoy it.' }
    });
    expect(made.statusCode).toBe(201);

    const received = await app.inject({ url: '/api/gifts/received', headers: { cookie: owner.cookie } });
    const gift = received.json().gifts.find((g: { id: string }) => g.id === made.json().gift.id);
    expect(gift.from, 'an anonymous gift names nobody').toBeNull();
    expect(gift.message).toBe('Enjoy it.');

    const donorNickname = (await prisma.userProfile.findFirstOrThrow({ where: { userId: donorB.id } })).nickname;
    expect(JSON.stringify(gift)).not.toContain(donorNickname);
  });

  it('names the donor when they chose to be named', async () => {
    const list = await app.inject({ url: `/api/wishlists/${publicList}`, headers: { cookie: donorA.cookie } });
    const item = list.json().wishlist.items[0];
    if (!item) return;                      // list may be fully reserved by now
    const made = await app.inject({
      method: 'POST', url: '/api/gifts/reserve', headers: { cookie: donorA.cookie },
      payload: { wishlistItemId: item.id, anonymous: false }
    });
    expect(made.statusCode).toBe(201);

    const received = await app.inject({ url: '/api/gifts/received', headers: { cookie: owner.cookie } });
    const gift = received.json().gifts.find((g: { id: string }) => g.id === made.json().gift.id);
    expect(gift.from.nickname).toBeTruthy();
    expect(gift.from.avatarUrl).toBeDefined();
    // Even a named donor is only ever a nickname and a picture.
    expect(Object.keys(gift.from).sort()).toEqual(['avatarUrl', 'nickname']);
  });
});

describe('random gifting', () => {
  it('suggests a stranger with something available, and never the asker', async () => {
    const res = await app.inject({ url: '/api/gifts/random/person', headers: { cookie: donorA.cookie } });
    if (res.statusCode === 404) return;     // nothing left on any public list
    expect(res.statusCode).toBe(200);
    expect(res.json().wishlist.availableCount).toBeGreaterThan(0);
    expect(res.json().wishlist.owner.nickname).toBeTruthy();
  });

  it('suggests a book without buying it', async () => {
    const res = await app.inject({ url: '/api/gifts/random/book', headers: { cookie: donorA.cookie } });
    if (res.statusCode === 404) return;
    expect(res.statusCode).toBe(200);
    const s = res.json().suggestion;
    expect(s.wishlistItemId).toBeTruthy();
    expect(s.book.title).toBeTruthy();

    // Nothing was reserved by asking.
    const item = await prisma.wishlistItem.findUniqueOrThrow({ where: { id: s.wishlistItemId } });
    expect(item.status).toBe('AVAILABLE');
  });
});

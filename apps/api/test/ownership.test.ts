import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const signUp = (nickname: string) => app.inject({
  method: 'POST', url: '/api/auth/signup',
  payload: { email: `${nickname}@example.test`, password: 'a-long-enough-password', nickname }
});

describe('the first account owns the shop', () => {
  it('grants SUPER_ADMIN when nobody holds it, and only then', async () => {
    const owners = await prisma.userRole.count({ where: { role: { key: 'SUPER_ADMIN' } } });

    if (owners === 0) {
      /* A fresh installation: whoever signs up first gets the keys, so there
         is no chicken-and-egg between signing up and granting yourself
         access. */
      const first = await signUp(unique('first'));
      expect(first.statusCode).toBe(201);
      expect(first.json().owner).toBe(true);
      expect(first.json().user.roles).toContain('SUPER_ADMIN');
      expect(first.json().user.permissions.length).toBeGreaterThan(20);
    }

    /* Once an owner exists, the next person through the door is a customer
       — the rule must not hand the shop to the second visitor as well. */
    const second = await signUp(unique('second'));
    expect(second.statusCode).toBe(201);
    expect(second.json().owner).toBeFalsy();
    expect(second.json().user.roles).toEqual(['CUSTOMER']);
    expect(second.json().user.permissions).toEqual([]);

    const staffDoor = await app.inject({
      url: '/api/admin/books',
      headers: { cookie: (second.headers['set-cookie'] as string).split(';')[0]! }
    });
    expect(staffDoor.statusCode, 'a customer stays out of the admin').toBe(403);
  });
});

describe('the account screen', () => {
  it('shows an account only its own email, and never anyone else', async () => {
    const res = await signUp(unique('reader'));
    const cookie = (res.headers['set-cookie'] as string).split(';')[0]!;
    const me = await app.inject({ url: '/api/account', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.email).toContain('@example.test');

    /* Everything a stranger can reach carries a nickname and an avatar. */
    const others = await app.inject({ url: '/api/wishlists/public' });
    expect(JSON.stringify(others.json())).not.toContain('@example.test');
  });

  it('refuses an avatar that is not one of ours', async () => {
    const res = await signUp(unique('avatar'));
    const cookie = (res.headers['set-cookie'] as string).split(';')[0]!;
    const bad = await app.inject({
      method: 'PATCH', url: '/api/account/profile', headers: { cookie },
      payload: { avatarUrl: 'https://tracker.example.com/pixel.gif' }
    });
    expect(bad.statusCode, 'an arbitrary URL in a profile is a tracking pixel').toBe(400);
    expect(bad.json().error.code).toBe('unknown_avatar');
  });

  it('closes an account without taking its orders with it', async () => {
    const res = await signUp(unique('closing'));
    const cookie = (res.headers['set-cookie'] as string).split(';')[0]!;
    const id = res.json().user.id;

    await prisma.order.create({
      data: {
        number: `RM-TEST-${Date.now().toString(36)}`, customerId: id, currency: 'EUR',
        subtotal: 1000, shippingCost: 0, total: 1000,
        items: { create: { titleSnapshot: 'A book', unitPrice: 1000, quantity: 1, lineTotal: 1000 } }
      }
    });

    const gone = await app.inject({
      method: 'POST', url: '/api/account/delete', headers: { cookie },
      payload: { password: 'a-long-enough-password' }
    });
    expect(gone.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.status).toBe('DELETED');
    expect(user.email).not.toContain('@example.test');
    expect(await prisma.userProfile.count({ where: { userId: id } })).toBe(0);

    const order = await prisma.order.findFirstOrThrow({ where: { customerId: id } });
    expect(order.total, 'the order still balances').toBe(1000);
    expect(order.customerEmailSnapshot).toBe('deleted@ridmore.invalid');

    const after = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(after.json().user, 'the session is dead').toBeNull();
  });
});

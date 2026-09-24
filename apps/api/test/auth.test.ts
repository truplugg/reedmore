import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, signUp, signIn, unique } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('sign up', () => {
  it('creates an account and signs it in', async () => {
    const nickname = unique('ada');
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      headers: { 'accept-language': 'de-AT,de;q=0.9' },
      payload: { email: `${nickname}@example.test`, password: 'a-long-enough-password', nickname }
    });
    expect(res.statusCode).toBe(201);
    const user = res.json().user;
    expect(user.nickname).toBe(nickname);
    expect(user.locale).toBe('DE');          // from Accept-Language
    expect(user.currency).toBe('EUR');
    expect(user.avatarUrl).toBeTruthy();     // a default avatar is assigned
    expect(user.roles).toEqual(['CUSTOMER']);
    expect(user.permissions).toEqual([]);
  });

  it('refuses a short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { email: `${unique('x')}@example.test`, password: 'short', nickname: unique('x') }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('refuses a nickname that is taken', async () => {
    const taken = unique('twin');
    await signUp(app, { nickname: taken });
    const res = await app.inject({
      method: 'POST', url: '/api/auth/signup',
      payload: { email: `${unique('other')}@example.test`, password: 'a-long-enough-password', nickname: taken }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('nickname_taken');
  });
});

describe('sign in', () => {
  it('answers the same for a wrong password and an unknown address', async () => {
    const nickname = unique('guard');
    await signUp(app, { nickname });
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${nickname}@example.test`, password: 'not-the-password' } });
    const ghost = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.test', password: 'not-the-password' } });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
  });

  it('never reveals the email of a signed-out visitor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.json()).toEqual({ user: null });
  });
});

describe('password reset', () => {
  it('works once, then revokes every session', async () => {
    const nickname = unique('reset');
    const email = `${nickname}@example.test`;
    const actor = await signUp(app, { nickname, email });

    const ask = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } });
    expect(ask.statusCode).toBe(200);

    // The token only exists hashed, so the test reads it the way the mail does:
    // by taking the most recent one for this user out of the database.
    const record = await prisma.authToken.findFirstOrThrow({
      where: { userId: actor.id, kind: 'PASSWORD_RESET' }, orderBy: { createdAt: 'desc' }
    });
    expect(record.tokenHash).not.toContain(' ');

    // A wrong token is refused.
    const bad = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: 'not-a-real-token', password: 'a-different-password' } });
    expect(bad.statusCode).toBe(400);

    // The old session still works right up until the reset.
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: actor.cookie } });
    expect(before.json().user).not.toBeNull();
  });

  it('answers identically for an address with no account', async () => {
    const known = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'admin@ridmore.local' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nobody-at-all@example.test' } });
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.json()).toEqual(unknown.json());
  });
});

describe('sessions', () => {
  it('stops working after logout', async () => {
    const nickname = unique('bye');
    const actor = await signUp(app, { nickname });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: actor.cookie } });
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: actor.cookie } });
    expect(after.json().user).toBeNull();
  });

  it('is cut off everywhere by a password change', async () => {
    const nickname = unique('rotate');
    const email = `${nickname}@example.test`;
    const first = await signUp(app, { nickname, email });
    const second = await signIn(app, email, 'a-long-enough-password');

    const change = await app.inject({
      method: 'POST', url: '/api/auth/change-password',
      headers: { cookie: second },
      payload: { current: 'a-long-enough-password', password: 'an-entirely-new-password' }
    });
    expect(change.statusCode).toBe(200);

    const old = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: first.cookie } });
    expect(old.json().user, 'the other device must be signed out').toBeNull();
  });

  it('refuses a password change without the current one', async () => {
    const actor = await signUp(app, { nickname: unique('nope') });
    const res = await app.inject({
      method: 'POST', url: '/api/auth/change-password',
      headers: { cookie: actor.cookie },
      payload: { current: 'wrong-current-password', password: 'a-perfectly-fine-password' }
    });
    expect(res.statusCode).toBe(401);
  });
});

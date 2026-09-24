import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/** One app for the whole file; the database is shared, so tests use unique
 *  emails rather than truncating tables another test may be using. */
export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface Actor { cookie: string; id: string }

/** Sign up and keep the session cookie. */
export async function signUp(app: FastifyInstance, over: Partial<{ email: string; password: string; nickname: string }> = {}): Promise<Actor> {
  const nickname = over.nickname ?? unique('reader');
  const res = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: {
      email: over.email ?? `${nickname}@example.test`,
      password: over.password ?? 'a-long-enough-password',
      nickname
    }
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return { cookie: cookieOf(res.headers['set-cookie']), id: res.json().user.id };
}

export async function signIn(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return cookieOf(res.headers['set-cookie']);
}

function cookieOf(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : [header ?? ''];
  const hit = list.find((h) => h.startsWith('ridmore_session='));
  return hit ? hit.split(';')[0]! : '';
}

/** Grant a role to an existing user, the way a super admin would. */
export async function grantRole(userId: string, key: 'SUPER_ADMIN' | 'MANAGER' | 'CATALOG_MANAGER' | 'CONTENT_EDITOR'): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { key } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } }, update: {}, create: { userId, roleId: role.id }
  });
}

/** A 1×1 PNG, enough for sharp to accept and re-encode. */
export function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

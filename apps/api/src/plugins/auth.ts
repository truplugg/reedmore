import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../lib/prisma.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { env, isProd } from '../lib/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { PermissionKey } from '../lib/permissions.js';

export const SESSION_COOKIE = 'ridmore_session';
const SESSION_DAYS = 30;

export interface Viewer {
  id: string;
  email: string;
  nickname: string;
  locale: 'DE' | 'UK' | 'EN';
  currency: 'EUR' | 'UAH';
  avatarUrl: string | null;
  roles: string[];
  permissions: Set<string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Null for a signed-out visitor. Populated once per request. */
    viewer: Viewer | null;
    /** Throws 401 if signed out; returns the viewer otherwise. */
    requireViewer(): Viewer;
    /** Throws 401 or 403; returns the viewer otherwise. */
    requirePermission(...keys: PermissionKey[]): Viewer;
    can(key: PermissionKey): boolean;
  }
}

/** Issue a session and set the cookie. Returns the raw token, which is the
 *  only time it exists outside the browser — only its hash is stored. */
export async function startSession(reply: FastifyReply, userId: string, req: FastifyRequest): Promise<void> {
  const token = newToken(48);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({
    data: {
      userId, tokenHash: hashToken(token), expiresAt,
      userAgent: req.headers['user-agent']?.slice(0, 250) ?? null,
      ip: req.ip
    }
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd || env.PUBLIC_URL.startsWith('https://'),
    signed: true,
    maxAge: SESSION_DAYS * 86400
  });
}

export async function endSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = readCookie(req);
  if (raw) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Revoke every session a user holds — used on password change and on
 *  account deletion, both of which must log the person out everywhere. */
export async function endAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

function readCookie(req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

async function loadViewer(req: FastifyRequest): Promise<Viewer | null> {
  const token = readCookie(req);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          profile: true,
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }
        }
      }
    }
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const user = session.user;
  if (user.status !== 'ACTIVE') return null;

  const permissions = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.key);

  return {
    id: user.id,
    email: user.email,
    nickname: user.profile?.nickname ?? 'reader',
    locale: user.profile?.locale ?? 'EN',
    currency: user.profile?.currency ?? 'EUR',
    avatarUrl: user.profile?.avatarUrl ?? null,
    roles: user.roles.map((r) => r.role.key),
    permissions
  };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('viewer', null);

  app.decorateRequest('requireViewer', function (this: FastifyRequest) {
    if (!this.viewer) throw unauthorized();
    return this.viewer;
  });

  app.decorateRequest('can', function (this: FastifyRequest, key: PermissionKey) {
    return this.viewer?.permissions.has(key) ?? false;
  });

  /** Permissions are checked here, on the server, for every staff route —
   *  hiding a button in the admin is presentation, not access control (§11). */
  app.decorateRequest('requirePermission', function (this: FastifyRequest, ...keys: PermissionKey[]) {
    const viewer = this.requireViewer();
    const ok = keys.some((k) => viewer.permissions.has(k));
    if (!ok) throw forbidden(`This needs one of: ${keys.join(', ')}.`);
    return viewer;
  });

  app.addHook('onRequest', async (req) => {
    req.viewer = await loadViewer(req);
  });
}, { name: 'ridmore-auth' });

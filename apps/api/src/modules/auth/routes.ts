import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../../lib/crypto.js';
import { startSession, endSession, endAllSessions } from '../../plugins/auth.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { sendMail } from '../../lib/mail.js';
import { env } from '../../lib/env.js';
import { localeFromAcceptLanguage, currencyForLocale } from '../../lib/locale.js';
import { SEED_AVATARS_KEYS } from './avatars.js';
import { audit } from '../../lib/audit.js';

const RESET_TTL_MIN = 60;

const password = z.string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((v) => !/^\s|\s$/.test(v), 'No leading or trailing spaces.');

const nickname = z.string()
  .min(2).max(24)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_.\- ]*[\p{L}\p{N}]$/u, 'Letters, numbers, and . _ - between them.');

const signupSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password,
  nickname,
  locale: z.enum(['DE', 'UK', 'EN']).optional(),
  currency: z.enum(['EUR', 'UAH']).optional()
});

/** What the account itself may see. Nothing here is ever sent for another
 *  user — that path selects nickname and avatar only (§33). */
function meOf(viewer: NonNullable<import('../../plugins/auth.js').Viewer>) {
  return {
    id: viewer.id, email: viewer.email, nickname: viewer.nickname,
    locale: viewer.locale, currency: viewer.currency, avatarUrl: viewer.avatarUrl,
    roles: viewer.roles, permissions: [...viewer.permissions]
  };
}

export default async function authRoutes(app: FastifyInstance) {
  /** Signing up, signing in and asking for a reset are the three endpoints
   *  worth brute-forcing, so they get their own budget (§15). */
  const strict = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

  app.post('/signup', strict, async (req, reply) => {
    const body = signupSchema.parse(req.body);

    const [emailTaken, nickTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email: body.email }, select: { id: true } }),
      prisma.userProfile.findUnique({ where: { nickname: body.nickname }, select: { id: true } })
    ]);
    if (emailTaken) throw conflict('email_taken', 'That email already has an account.');
    if (nickTaken) throw conflict('nickname_taken', 'That nickname is taken.');

    const locale = body.locale ?? localeFromAcceptLanguage(req.headers['accept-language']);
    const currency = body.currency ?? currencyForLocale(locale);
    const avatarUrl = pickDefaultAvatar(body.nickname);

    /* The shop has to belong to somebody. Whoever opens the first account on
       a fresh installation becomes the owner, so there is no chicken-and-egg
       between "sign up" and "grant yourself admin". The check is for an
       existing SUPER_ADMIN rather than for any user at all, so an install
       that seeded an owner never hands the shop to a customer. */
    const owned = await prisma.userRole.findFirst({
      where: { role: { key: 'SUPER_ADMIN' } }, select: { userId: true }
    });
    const claimOwnership = !owned;

    const roleKey = claimOwnership ? 'SUPER_ADMIN' : 'CUSTOMER';
    const role = await prisma.role.findUnique({
      where: { key: roleKey },
      include: { permissions: { include: { permission: true } } }
    });

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        emailVerifiedAt: claimOwnership ? new Date() : null,
        profile: { create: { nickname: body.nickname, locale, currency, avatarUrl } },
        roles: role ? { create: { roleId: role.id } } : undefined
      }
    });

    if (claimOwnership) {
      await audit(user.id, 'user.claim_ownership', 'User', user.id, { email: body.email }, req.ip);
      req.log.warn({ email: body.email }, 'first account created — granted SUPER_ADMIN');
    }

    await startSession(reply, user.id, req);
    req.viewer = {
      id: user.id, email: user.email, nickname: body.nickname, locale, currency,
      avatarUrl,
      roles: [roleKey],
      permissions: new Set(role?.permissions.map((rp) => rp.permission.key) ?? [])
    };
    reply.code(201);
    return { user: meOf(req.viewer), owner: claimOwnership };
  });

  app.post('/login', strict, async (req, reply) => {
    const body = z.object({
      email: z.string().email().max(254).toLowerCase(),
      password: z.string().min(1).max(200)
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true, status: true }
    });

    // Same failure for a missing account and a wrong password, and the hash is
    // verified either way, so response time does not reveal which it was.
    const hash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2E$0000000000000000000000000000000000000000000';
    const ok = await verifyPassword(hash, body.password);
    if (!user || !ok || user.status !== 'ACTIVE') throw unauthorized('Wrong email or password.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await startSession(reply, user.id, req);
    req.viewer = null;
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    await endSession(req, reply);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!req.viewer) return { user: null };
    return { user: meOf(req.viewer) };
  });

  app.post('/forgot-password', strict, async (req) => {
    const body = z.object({ email: z.string().email().max(254).toLowerCase() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true, status: true } });

    // Always the same answer, so the endpoint cannot be used to find out
    // which addresses have accounts.
    if (user && user.status === 'ACTIVE') {
      const token = newToken(32);
      await prisma.authToken.create({
        data: {
          userId: user.id, kind: 'PASSWORD_RESET', tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000)
        }
      });
      const link = `${env.PUBLIC_URL}/reset-password?token=${token}`;
      await sendMail({
        to: body.email,
        subject: 'Reset your Ridmore password',
        text: `Someone asked to reset the password for this Ridmore account.\n\n${link}\n\nThe link works once and expires in ${RESET_TTL_MIN} minutes. If it was not you, nothing has changed and you can ignore this.`
      });
    }
    return { ok: true };
  });

  app.post('/reset-password', strict, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(200), password }).parse(req.body);

    const record = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(body.token) } });
    if (!record || record.kind !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('invalid_token', 'That reset link has expired or has already been used.');
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(body.password) } }),
      prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Everything else signed in with the old password gets cut off.
      prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);

    await startSession(reply, record.userId, req);
    return { ok: true };
  });

  app.post('/change-password', async (req, reply) => {
    const viewer = req.requireViewer();
    const body = z.object({ current: z.string().min(1).max(200), password }).parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: viewer.id }, select: { passwordHash: true } });
    if (!await verifyPassword(user.passwordHash, body.current)) throw unauthorized('That is not your current password.');

    await prisma.user.update({ where: { id: viewer.id }, data: { passwordHash: await hashPassword(body.password) } });
    await endAllSessions(viewer.id);
    await startSession(reply, viewer.id, req);
    return { ok: true };
  });
}

function pickDefaultAvatar(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return SEED_AVATARS_KEYS[h % SEED_AVATARS_KEYS.length]!;
}

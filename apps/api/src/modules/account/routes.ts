import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { endAllSessions, endSession } from '../../plugins/auth.js';
import { verifyPassword } from '../../lib/crypto.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const nickname = z.string()
  .min(2).max(24)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_.\- ]*[\p{L}\p{N}]$/u, 'Letters, numbers, and . _ - between them.');

export default async function accountRoutes(app: FastifyInstance) {
  /** Everything the account's own screen shows. */
  app.get('/', async (req) => {
    const viewer = req.requireViewer();
    const [profile, counts, gifts] = await Promise.all([
      prisma.userProfile.findUniqueOrThrow({ where: { userId: viewer.id } }),
      prisma.wishlist.groupBy({ by: ['visibility'], where: { ownerId: viewer.id }, _count: true }),
      prisma.order.count({ where: { type: 'GIFT', gift: { donorId: viewer.id } } })
    ]);

    return {
      account: {
        id: viewer.id,
        email: viewer.email,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        locale: profile.locale,
        currency: profile.currency,
        bio: profile.bio,
        roles: viewer.roles,
        permissions: [...viewer.permissions],
        /* What the admin door should be labelled, if it is shown at all. */
        staff: viewer.permissions.size > 0,
        lists: Object.fromEntries(counts.map((c) => [c.visibility, c._count])),
        giftsSent: gifts
      }
    };
  });

  /** The default avatar set (§16), for the picker. */
  app.get('/avatars', async (req) => {
    req.requireViewer();
    const rows = await prisma.media.findMany({
      where: { folder: 'AVATAR' }, select: { id: true, url: true, alt: true }, orderBy: { key: 'asc' }
    });
    return { avatars: rows };
  });

  app.patch('/profile', async (req) => {
    const viewer = req.requireViewer();
    const body = z.object({
      nickname: nickname.optional(),
      avatarUrl: z.string().max(200_000).nullable().optional(),
      locale: z.enum(['DE', 'UK', 'EN']).optional(),
      currency: z.enum(['EUR', 'UAH']).optional(),
      bio: z.string().max(280).nullable().optional()
    }).parse(req.body);

    if (body.nickname) {
      const taken = await prisma.userProfile.findUnique({
        where: { nickname: body.nickname }, select: { userId: true }
      });
      if (taken && taken.userId !== viewer.id) throw conflict('nickname_taken', 'That nickname is taken.');
    }

    /* An avatar is either one of ours or nothing. A profile field that
       accepted any URL would be an open redirect and a tracking pixel in one. */
    if (body.avatarUrl) {
      const known = await prisma.media.findFirst({
        where: { folder: 'AVATAR', url: body.avatarUrl }, select: { id: true }
      });
      if (!known) throw badRequest('unknown_avatar', 'Pick one of the avatars on offer.');
    }

    const profile = await prisma.userProfile.update({ where: { userId: viewer.id }, data: body });
    return {
      account: {
        nickname: profile.nickname, avatarUrl: profile.avatarUrl,
        locale: profile.locale, currency: profile.currency, bio: profile.bio
      }
    };
  });

  /**
   * Close the account (§26).
   *
   * The person goes; the books they bought stay, because an order has to
   * balance years later. So the row is kept but emptied: the login is dead,
   * the profile is gone, the lists are gone, and the orders keep a snapshot
   * of what was needed to account for them rather than a pointer to someone
   * who asked to be forgotten.
   */
  app.post('/delete', async (req, reply) => {
    const viewer = req.requireViewer();
    const body = z.object({ password: z.string().min(1).max(200) }).parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: viewer.id }, select: { passwordHash: true, email: true }
    });
    if (!await verifyPassword(user.passwordHash, body.password)) {
      throw unauthorized('That is not your password.');
    }

    const held = await prisma.wishlistItem.count({
      where: { wishlist: { ownerId: viewer.id }, status: 'RESERVED' }
    });
    if (held > 0) {
      throw badRequest('gift_in_flight',
        `Someone is sending you ${held} book${held === 1 ? '' : 's'} right now. We cannot close the account until that has arrived — write to us and we will sort it out.`);
    }

    await prisma.$transaction(async (tx) => {
      /* Orders keep what accounting needs and lose the link to the person. */
      await tx.order.updateMany({
        where: { customerId: viewer.id },
        data: { customerEmailSnapshot: 'deleted@ridmore.invalid', customerNameSnapshot: 'Closed account' }
      });
      await tx.wishlist.deleteMany({ where: { ownerId: viewer.id } });
      await tx.userProfile.deleteMany({ where: { userId: viewer.id } });
      await tx.shippingAddress.updateMany({ where: { userId: viewer.id }, data: { userId: null } });
      await tx.authToken.deleteMany({ where: { userId: viewer.id } });
      await tx.user.update({
        where: { id: viewer.id },
        data: {
          status: 'DELETED',
          anonymizedAt: new Date(),
          /* The address is replaced rather than blanked, because the column is
             unique and a second closure would collide on an empty string. */
          email: `deleted+${viewer.id}@ridmore.invalid`,
          passwordHash: 'closed'
        }
      });
    });

    await endAllSessions(viewer.id);
    await endSession(req, reply);
    await audit(null, 'user.delete', 'User', viewer.id, null, req.ip);
    return { ok: true };
  });
}

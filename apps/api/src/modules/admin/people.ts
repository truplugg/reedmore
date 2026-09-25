import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound, badRequest, forbidden } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { ALL_PERMISSIONS } from '../../lib/permissions.js';
import { endAllSessions } from '../../plugins/auth.js';

/**
 * Users and roles (§11).
 *
 * Two rules this file exists to enforce, both on the server because a
 * screen that merely hides a button protects nothing (§31):
 *
 *   - Staff reading the user list see accounts, not dossiers. Addresses and
 *     phone numbers are never in these responses; an address belongs to an
 *     order, and only to staff processing that order.
 *   - The last super admin cannot be demoted, suspended or stripped, by
 *     anyone including themselves. A shop with no owner cannot be reopened
 *     from inside the shop.
 */

/** What staff may see of a person. Deliberately short. */
function staffUser(u: Prisma.UserGetPayload<{
  include: { profile: true; roles: { include: { role: true } }; _count: { select: { orders: true; wishlists: true } } };
}>) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    status: u.status,
    displayName: u.profile?.nickname ?? null,
    locale: u.profile?.locale ?? null,
    currency: u.profile?.currency ?? null,
    avatarUrl: u.profile?.avatarUrl ?? null,
    roles: u.roles.map((r) => ({ key: r.role.key, name: r.role.name, grantedAt: r.grantedAt })),
    orders: u._count.orders,
    wishlists: u._count.wishlists,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    anonymizedAt: u.anonymizedAt
  };
}

const USER_INCLUDE = {
  profile: true,
  roles: { include: { role: true } },
  _count: { select: { orders: true, wishlists: true } }
} satisfies Prisma.UserInclude;

/** How many people can still open the admin if this one goes away. */
async function otherOwners(exceptUserId: string): Promise<number> {
  return prisma.userRole.count({
    where: {
      role: { key: 'SUPER_ADMIN' },
      userId: { not: exceptUserId },
      user: { status: 'ACTIVE', anonymizedAt: null }
    }
  });
}

async function isOwner(userId: string): Promise<boolean> {
  return (await prisma.userRole.count({ where: { userId, role: { key: 'SUPER_ADMIN' } } })) > 0;
}

/** Throws unless the shop would still have an owner afterwards. */
async function guardLastOwner(userId: string, what: string): Promise<void> {
  if (!(await isOwner(userId))) return;
  if ((await otherOwners(userId)) > 0) return;
  throw badRequest(
    'last_owner',
    `This is the only account that can administer the shop, so it cannot be ${what}. ` +
      'Give another account the owner role first.'
  );
}

export default async function peopleRoutes(app: FastifyInstance) {
  /* ---------- users ---------- */

  app.get('/users', async (req) => {
    req.requirePermission('user.read');
    const q = z.object({
      search: z.string().max(120).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
      role: z.string().max(40).optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(req.query);

    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { roles: { some: { role: { key: q.role as never } } } } : {}),
      ...(q.search
        ? {
            OR: [
              { email: { contains: q.search, mode: 'insensitive' } },
              { profile: { nickname: { contains: q.search, mode: 'insensitive' } } }
            ]
          }
        : {})
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where, include: USER_INCLUDE, orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage, take: q.perPage
      }),
      prisma.user.count({ where })
    ]);
    return { items: rows.map(staffUser), total, page: q.page, perPage: q.perPage };
  });

  app.get('/users/:id', async (req) => {
    req.requirePermission('user.read');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const user = await prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) throw notFound('No such account.');
    return { user: staffUser(user) };
  });

  app.post('/users/:id/status', async (req) => {
    const viewer = req.requirePermission('user.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!user) throw notFound('No such account.');
    if (status === 'SUSPENDED') await guardLastOwner(id, 'suspended');

    const updated = await prisma.user.update({ where: { id }, data: { status }, include: USER_INCLUDE });
    /* A suspended account keeps no live sessions: the point of suspending is
       that the next request fails, not the next sign-in. */
    if (status === 'SUSPENDED') await endAllSessions(id);

    await audit(viewer.id, 'user.status', 'user', id, { from: user.status, to: status }, req.ip);
    return { user: staffUser(updated) };
  });

  /* ---------- roles held by a person ---------- */

  app.put('/users/:id/roles', async (req) => {
    const viewer = req.requirePermission('role.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { roles } = z.object({ roles: z.array(z.string().min(1)).max(10) }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound('No such account.');

    const wanted = await prisma.role.findMany({ where: { key: { in: roles as never[] } } });
    if (wanted.length !== roles.length) throw badRequest('unknown_role', 'One of those roles does not exist.');

    /* Losing the owner role is the same danger as being suspended, and the
       check has to happen before the write, not after. */
    if (!roles.includes('SUPER_ADMIN')) await guardLastOwner(id, 'left without the owner role');

    const before = await prisma.userRole.findMany({ where: { userId: id }, include: { role: true } });

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: id } }),
      prisma.userRole.createMany({
        data: wanted.map((r) => ({ userId: id, roleId: r.id, grantedBy: viewer.id }))
      })
    ]);

    /* Permissions are read into the session on each request, so nothing has
       to be invalidated — but the person's own open tabs should learn about
       it, and a revoked role should not outlive the click that revoked it. */
    if (id !== viewer.id) await endAllSessions(id);

    await audit(viewer.id, 'user.roles', 'user', id,
      { from: before.map((r) => r.role.key), to: roles }, req.ip);

    const updated = await prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    return { user: staffUser(updated!) };
  });

  /* ---------- the role catalogue ---------- */

  app.get('/roles', async (req) => {
    req.requirePermission('user.read');
    const roles = await prisma.role.findMany({
      orderBy: { key: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } }
      }
    });
    const permissions = await prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    return {
      roles: roles.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        system: r.system,
        users: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key).sort()
      })),
      permissions: permissions.map((p) => ({ key: p.key, group: p.group, description: p.description }))
    };
  });

  app.put('/roles/:key/permissions', async (req) => {
    const viewer = req.requirePermission('role.write');
    const { key } = z.object({ key: z.string().min(1) }).parse(req.params);
    const { permissions } = z.object({
      permissions: z.array(z.string().min(1)).max(ALL_PERMISSIONS.length)
    }).parse(req.body);

    const role = await prisma.role.findUnique({
      where: { key: key as never },
      include: { permissions: { include: { permission: true } } }
    });
    if (!role) throw notFound('No such role.');

    /* The owner role is not editable. It is the role that can restore every
       other one, so a mistake here is the mistake with no way back. */
    if (role.key === 'SUPER_ADMIN') {
      throw forbidden('The owner role always holds every permission and cannot be edited.');
    }

    const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p as never));
    if (unknown.length) throw badRequest('unknown_permission', `Not a permission: ${unknown.join(', ')}`);

    const rows = await prisma.permission.findMany({ where: { key: { in: permissions } } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: rows.map((p) => ({ roleId: role.id, permissionId: p.id }))
      })
    ]);

    await audit(viewer.id, 'role.permissions', 'role', role.id, {
      role: role.key,
      from: role.permissions.map((p) => p.permission.key).sort(),
      to: [...permissions].sort()
    }, req.ip);

    return { role: { key: role.key, permissions: [...permissions].sort() } };
  });
}

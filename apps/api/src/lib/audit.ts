import { prisma } from './prisma.js';

/**
 * Staff actions are written to the audit log (§25, §32). Never allowed to
 * fail the request it describes: a log that takes the site down with it is
 * worse than a log with a gap, and the gap is visible.
 */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: unknown,
  ip?: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId, action, entity, entityId: entityId ?? null,
        meta: (meta ?? undefined) as never, ip: ip ?? null
      }
    });
  } catch (err) {
    console.error('audit write failed', { action, entity, entityId, err });
  }
}

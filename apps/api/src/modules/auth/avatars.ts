import { prisma } from '../../lib/prisma.js';

/** The default avatar URLs, read once at boot so signup does not query for
 *  them. Refreshed by `loadAvatars()` if the set is ever extended. */
export let SEED_AVATARS_KEYS: string[] = [];

export async function loadAvatars(): Promise<void> {
  const rows = await prisma.media.findMany({
    where: { folder: 'AVATAR' }, select: { url: true }, orderBy: { key: 'asc' }
  });
  SEED_AVATARS_KEYS = rows.map((r) => r.url);
  if (!SEED_AVATARS_KEYS.length) SEED_AVATARS_KEYS = [''];
}

/**
 * Development seed (§39).
 *
 * Idempotent by design: everything is an upsert keyed on a natural key, so
 * running it against a database that already has real data adds what is
 * missing and overwrites nothing that belongs to a person. It never deletes.
 */
import { PrismaClient, type RoleKey, type Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, ALL_PERMISSIONS } from '../src/lib/permissions.js';
import { SEED_THEMES } from './seed-themes.js';
import { SEED_AVATARS } from './seed-avatars.js';
import { BOOKS, GENRES } from '../../web/assets/js/data/books.js';

const prisma = new PrismaClient();

/** The prototype priced everything in UAH. Ridmore prices each currency
 *  independently (§4), so the carried-over books get a euro price derived
 *  once, here, and rounded to something a shop would actually print. From now
 *  on both are edited by hand in the admin and nothing converts. */
function euroFromLegacyUah(uah: number): number {
  const raw = (uah / 48) * 100;                 // one-time, at seed only
  return Math.max(100, Math.round(raw / 5) * 5); // to the nearest 5 cents
}

async function seedRolesAndPermissions() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { group: meta.group, description: meta.description },
      create: { key, group: meta.group, description: meta.description }
    });
  }

  for (const [roleKey, grants] of Object.entries(ROLE_PERMISSIONS)) {
    const meta = ROLE_NAMES[roleKey]!;
    const role = await prisma.role.upsert({
      where: { key: roleKey as RoleKey },
      update: { name: meta.name, description: meta.description },
      create: { key: roleKey as RoleKey, name: meta.name, description: meta.description, system: true }
    });

    const keys = grants === '*' ? ALL_PERMISSIONS : grants;
    const perms = await prisma.permission.findMany({ where: { key: { in: keys as string[] } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id }
      });
    }
  }
  console.log(`  roles: ${Object.keys(ROLE_PERMISSIONS).length}, permissions: ${ALL_PERMISSIONS.length}`);
}

async function seedThemes() {
  for (const t of SEED_THEMES) {
    const theme = await prisma.theme.upsert({
      where: { key: t.key },
      update: { name: t.name, description: t.description, season: t.season, system: true },
      create: { key: t.key, name: t.name, description: t.description, season: t.season, system: true }
    });
    const existing = await prisma.themeVersion.findFirst({
      where: { themeId: theme.id }, orderBy: { version: 'desc' }
    });
    if (existing) continue;   // never overwrite a version someone may have edited
    const version = await prisma.themeVersion.create({
      data: { themeId: theme.id, version: 1, label: 'Seed', tokens: t.tokens as unknown as Prisma.InputJsonValue }
    });
    await prisma.theme.update({ where: { id: theme.id }, data: { publishedVersionId: version.id } });
  }
  console.log(`  themes: ${SEED_THEMES.length}`);
}

async function seedAvatars() {
  for (const a of SEED_AVATARS) {
    await prisma.media.upsert({
      where: { key: a.key },
      update: { url: a.url, alt: a.alt },
      create: {
        key: a.key, url: a.url, mimeType: 'image/svg+xml',
        bytes: a.bytes, width: 160, height: 160, alt: a.alt, folder: 'AVATAR'
      }
    });
  }
  console.log(`  default avatars: ${SEED_AVATARS.length}`);
}

async function seedCategories() {
  const names: Record<string, { de: string }> = {
    proza:    { de: 'Gegenwartsliteratur' },
    klasyka:  { de: 'Klassiker' },
    poeziia:  { de: 'Lyrik' },
    nonfic:   { de: 'Sachbuch' },
    dytiacha: { de: 'Für Kinder' }
  };
  let position = 0;
  for (const g of GENRES as Array<{ id: string; ua: string; en: string }>) {
    await prisma.bookCategory.upsert({
      where: { slug: g.id },
      update: { nameUk: g.ua, nameEn: g.en, nameDe: names[g.id]?.de ?? g.en, position: position++ },
      create: { slug: g.id, nameUk: g.ua, nameEn: g.en, nameDe: names[g.id]?.de ?? g.en, position: position - 1 }
    });
  }
  console.log(`  categories: ${(GENRES as unknown[]).length}`);
}

async function seedBooks() {
  const categories = await prisma.bookCategory.findMany();
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  let created = 0;

  for (const b of BOOKS as any[]) {
    const priceUah = Math.round(b.price * 100);
    const priceEur = euroFromLegacyUah(b.price);
    const saleUah = b.oldPrice ? priceUah : null;          // legacy oldPrice means the listed one was a sale
    const listUah = b.oldPrice ? Math.round(b.oldPrice * 100) : priceUah;
    const listEur = b.oldPrice ? euroFromLegacyUah(b.oldPrice) : priceEur;
    const saleEur = b.oldPrice ? priceEur : null;

    const data = {
      slug: b.id,
      status: 'PUBLISHED' as const,
      featured: b.badge === 'best',
      title: b.title, titleEn: b.titleEn ?? null,
      author: b.author, authorEn: b.authorEn ?? null,
      publisher: b.publisher ?? null, year: b.year ?? null,
      isbn: b.isbn ?? null,
      isbnDigits: b.isbn ? String(b.isbn).replace(/[^\dxX]/gi, '').toUpperCase() : null,
      language: b.lang ?? 'uk', pages: b.pages ?? null,
      binding: (b.format === 'soft' ? 'SOFT' : 'HARD') as 'SOFT' | 'HARD',
      sizeLabel: b.size ?? null, paperLabel: b.paper ?? null, weightGrams: b.weight ?? null,
      blurb: b.blurb ?? null, blurbEn: b.blurbEn ?? null,
      about: b.about ?? null, aboutEn: b.aboutEn ?? null,
      priceEurCents: listEur, priceUahCents: listUah,
      salePriceEurCents: saleEur, salePriceUahCents: saleUah,
      coverStyle: b.cover?.style ?? 'stack',
      coverMotif: b.cover?.motif ?? 'bars',
      endpaper: b.endpaper ?? 'star',
      paperColor: b.cover?.pal?.paper ?? null,
      inkColor: b.cover?.pal?.ink ?? null,
      accentColor: b.cover?.pal?.accent ?? null,
      categoryId: bySlug.get(b.genre) ?? null,
      publishedAt: new Date()
    };

    const book = await prisma.book.upsert({ where: { slug: b.id }, update: data, create: data });
    await prisma.inventory.upsert({
      where: { bookId: book.id },
      update: {},
      create: { bookId: book.id, onHand: b.stock ?? 8, reserved: 0 }
    });

    for (const label of (b.tags ?? []) as string[]) {
      const slug = label.toLowerCase().replace(/\s+/g, '-');
      const tag = await prisma.bookTag.upsert({ where: { slug }, update: { label }, create: { slug, label } });
      await prisma.bookTagOnBook.upsert({
        where: { bookId_tagId: { bookId: book.id, tagId: tag.id } },
        update: {}, create: { bookId: book.id, tagId: tag.id }
      });
    }
    created++;
  }
  console.log(`  books: ${created} (prices carried over, EUR derived once)`);
}

async function seedSettings() {
  const paper = await prisma.theme.findUnique({ where: { key: 'paper' } });
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, activeThemeId: paper?.id ?? null, siteName: 'Ridmore' }
  });
  console.log('  site settings: 1');
}

/**
 * An owner is only seeded when one is asked for.
 *
 * Left to itself the seed creates no SUPER_ADMIN, because the shop hands
 * ownership to whoever opens the first account — that is what makes signing
 * up on a fresh installation enough to get in. Set SEED_ADMIN_EMAIL when you
 * want the owner to exist before anyone visits.
 */
async function seedDevAdmin() {
  if (process.env.NODE_ENV === 'production') return;
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) { console.log('  owner: none — the first account to sign up becomes it'); return; }
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ridmore-dev-password';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) { console.log(`  dev admin: ${email} (already there)`); return; }

  const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      emailVerifiedAt: new Date(),
      profile: { create: { nickname: 'ridmore', locale: 'EN', currency: 'EUR', avatarUrl: SEED_AVATARS[0]!.url } },
      roles: role ? { create: { roleId: role.id } } : undefined
    }
  });
  console.log(`  dev admin: ${user.email} / ${password}`);
}

async function main() {
  console.log('Seeding Ridmore…');
  await seedRolesAndPermissions();
  await seedThemes();
  await seedAvatars();
  await seedCategories();
  await seedBooks();
  await seedSettings();
  await seedDevAdmin();
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

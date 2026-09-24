/**
 * Make the first super admin.
 *
 * Reads the environment when given and prompts otherwise, so it works both in
 * a terminal and in a deployment shell:
 *
 *   npm run create:admin
 *   ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=… ADMIN_NICKNAME=me npm run create:admin
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/crypto.js';

async function ask(question: string, fallback?: string): Promise<string> {
  if (fallback) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

const email = (await ask('Email: ', process.env.ADMIN_EMAIL)).toLowerCase();
const password = await ask('Password (10+ characters): ', process.env.ADMIN_PASSWORD);
const nickname = await ask('Public nickname: ', process.env.ADMIN_NICKNAME);

if (!email.includes('@')) { console.error('That is not an email address.'); process.exit(1); }
if (password.length < 10) { console.error('Use at least 10 characters.'); process.exit(1); }
if (nickname.length < 2) { console.error('The nickname needs at least 2 characters.'); process.exit(1); }

const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
if (!role) { console.error('No SUPER_ADMIN role. Run `npm run db:seed` first.'); process.exit(1); }

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  // Promoting an account that already exists is the common case on a second run.
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: existing.id, roleId: role.id } },
    update: {}, create: { userId: existing.id, roleId: role.id }
  });
  console.log(`${email} already had an account and is now a super admin.`);
} else {
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      profile: { create: { nickname } },
      roles: { create: { roleId: role.id } }
    }
  });
  console.log(`Created ${email} as a super admin.`);
}

await prisma.$disconnect();

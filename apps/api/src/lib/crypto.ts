import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/** argon2id at the OWASP-recommended floor. bcrypt is avoided on purpose: its
 *  72-byte truncation silently ignores the tail of a long passphrase. */
const ARGON: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MiB
  timeCost: 2,
  parallelism: 1
};

export const hashPassword = (plain: string) => argon2.hash(plain, ARGON);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try { return await argon2.verify(hash, plain); } catch { return false; }
}

/** Opaque, high-entropy, URL-safe. Used for session cookies, reset links and
 *  unlisted-wishlist share tokens. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Only the hash is stored, so a database leak does not hand out live
 *  sessions or reset links. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Order numbers people can read aloud on the phone: no 0/O, no 1/I. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function orderNumber(prefix = 'RM'): string {
  const n = randomBytes(6);
  let out = '';
  for (const byte of n) out += ALPHABET[byte % ALPHABET.length];
  const year = new Date().getFullYear().toString().slice(2);
  return `${prefix}-${year}-${out}`;
}

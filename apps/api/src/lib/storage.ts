import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from './env.js';
import { badRequest } from './errors.js';

/**
 * Media storage behind one interface (§14).
 *
 * The default driver writes to disk, so a fresh clone uploads covers without
 * anyone holding an S3 account. Moving to object storage is a driver and an
 * env var; nothing that calls this changes.
 */
export interface StoredFile {
  key: string;
  url: string;
  bytes: number;
  width: number | null;
  height: number | null;
  mimeType: string;
  checksum: string;
}

export interface StorageDriver {
  put(key: string, body: Buffer, mimeType: string): Promise<string>;
  remove(key: string): Promise<void>;
}

const localDriver: StorageDriver = {
  async put(key, body) {
    const full = path.resolve(env.STORAGE_LOCAL_DIR, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return `${env.STORAGE_PUBLIC_PATH}/${key}`;
  },
  async remove(key) {
    try { await unlink(path.resolve(env.STORAGE_LOCAL_DIR, key)); } catch { /* already gone */ }
  }
};

/** Written, not wired: it needs credentials the project does not ask for yet.
 *  Selecting it without them fails loudly at boot rather than at upload. */
const s3Driver: StorageDriver = {
  async put() { throw new Error('S3 storage is selected but @aws-sdk/client-s3 is not installed. Set STORAGE_DRIVER=local, or add the dependency and the four S3_* variables.'); },
  async remove() { throw new Error('S3 storage is selected but not configured.'); }
};

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? s3Driver : localDriver;

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** The widest any image on this site is ever displayed, times two for retina. */
const MAX_EDGE: Record<string, number> = {
  BOOK_COVER: 1400,
  ARTICLE: 2000,
  AVATAR: 320,
  THEME: 2000,
  GENERAL: 2000
};

export interface IngestOptions {
  folder: keyof typeof MAX_EDGE;
  filename: string;
  /** Guard against a decompression bomb before sharp is handed the bytes. */
  maxBytes?: number;
}

/**
 * Validate, re-encode and store an upload.
 *
 * The bytes are never trusted: the declared mime type is ignored in favour of
 * what sharp reads out of the buffer, the image is re-encoded rather than
 * passed through (which strips EXIF, any trailing payload, and anything
 * pretending to be a PNG), and it is capped to a sensible edge.
 */
export async function ingestImage(buffer: Buffer, opts: IngestOptions): Promise<StoredFile> {
  const cap = opts.maxBytes ?? 12 * 1024 * 1024;
  if (buffer.byteLength > cap) throw badRequest('file_too_large', `That file is over ${Math.round(cap / 1024 / 1024)} MB.`);

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw badRequest('not_an_image', 'That file is not an image we can read.');
  }

  const detected = meta.format ? `image/${meta.format === 'jpg' ? 'jpeg' : meta.format}` : '';
  if (!ACCEPTED.has(detected)) {
    throw badRequest('unsupported_image', 'Use a JPEG, PNG, WebP or AVIF image.');
  }

  const edge = MAX_EDGE[opts.folder] ?? 2000;
  const out = await sharp(buffer, { limitInputPixels: 50_000_000 })
    .rotate()                                  // honour EXIF orientation, then drop it
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const checksum = createHash('sha256').update(out.data).digest('hex');
  const key = `${opts.folder.toLowerCase()}/${checksum.slice(0, 2)}/${checksum.slice(2, 18)}.webp`;
  const url = await storage.put(key, out.data, 'image/webp');

  return {
    key, url,
    bytes: out.data.byteLength,
    width: out.info.width, height: out.info.height,
    mimeType: 'image/webp',
    checksum
  };
}

export function safeFilename(name: string): string {
  return path.basename(name).replace(/[^\w.\- ]+/g, '').slice(0, 120) || 'upload';
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ingestImage, storage, safeFilename } from '../../lib/storage.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const FOLDERS = ['GENERAL', 'BOOK_COVER', 'ARTICLE', 'AVATAR', 'THEME'] as const;

export function mediaView(m: {
  id: string; url: string; alt: string | null; caption: string | null;
  width: number | null; height: number | null; bytes: number; mimeType: string;
  folder: string; createdAt: Date;
}) {
  return {
    id: m.id, url: m.url, alt: m.alt, caption: m.caption,
    width: m.width, height: m.height, bytes: m.bytes, mimeType: m.mimeType,
    folder: m.folder, createdAt: m.createdAt.toISOString()
  };
}

export default async function mediaRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    req.requirePermission('media.read');
    const q = z.object({
      folder: z.enum(FOLDERS).optional(),
      search: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(40)
    }).parse(req.query);

    const where = {
      ...(q.folder ? { folder: q.folder } : {}),
      ...(q.search ? { alt: { contains: q.search, mode: 'insensitive' as const } } : {})
    };
    const [rows, total] = await Promise.all([
      prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.media.count({ where })
    ]);
    return { items: rows.map(mediaView), total, page: q.page, perPage: q.perPage };
  });

  app.post('/', async (req, reply) => {
    const viewer = req.requirePermission('media.write');
    const file = await req.file({ limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest('no_file', 'Attach an image.');

    const folderRaw = (file.fields?.folder as { value?: string } | undefined)?.value;
    const folder = (FOLDERS as readonly string[]).includes(folderRaw ?? '')
      ? (folderRaw as (typeof FOLDERS)[number]) : 'GENERAL';
    const alt = (file.fields?.alt as { value?: string } | undefined)?.value?.slice(0, 300) ?? null;

    const buffer = await file.toBuffer();
    const stored = await ingestImage(buffer, { folder, filename: safeFilename(file.filename) });

    // The same picture uploaded twice is one row; the checksum is the key.
    const existing = await prisma.media.findUnique({ where: { key: stored.key } });
    if (existing) { reply.code(200); return { media: mediaView(existing), deduplicated: true }; }

    const media = await prisma.media.create({
      data: {
        key: stored.key, url: stored.url, mimeType: stored.mimeType, bytes: stored.bytes,
        width: stored.width, height: stored.height, checksum: stored.checksum,
        alt, folder, uploadedById: viewer.id
      }
    });
    await audit(viewer.id, 'media.upload', 'Media', media.id, { folder, bytes: media.bytes }, req.ip);
    reply.code(201);
    return { media: mediaView(media) };
  });

  app.patch('/:id', async (req) => {
    const viewer = req.requirePermission('media.write');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      alt: z.string().max(300).nullable().optional(),
      caption: z.string().max(500).nullable().optional()
    }).parse(req.body);
    const media = await prisma.media.update({ where: { id }, data: body });
    await audit(viewer.id, 'media.update', 'Media', id, body, req.ip);
    return { media: mediaView(media) };
  });

  app.delete('/:id', async (req, reply) => {
    const viewer = req.requirePermission('media.delete');
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    const media = await prisma.media.findUnique({
      where: { id },
      include: { _count: { select: { bookFronts: true, bookBacks: true, articleCovers: true, avatars: true } } }
    });
    if (!media) throw notFound('No such file.');

    const used = media._count.bookFronts + media._count.bookBacks + media._count.articleCovers + media._count.avatars;
    if (used > 0) {
      throw badRequest('media_in_use', `That image is used in ${used} place${used === 1 ? '' : 's'}. Replace it there first.`);
    }

    await prisma.media.delete({ where: { id } });
    await storage.remove(media.key);
    await audit(viewer.id, 'media.delete', 'Media', id, { key: media.key }, req.ip);
    reply.code(204);
  });
}

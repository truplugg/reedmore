import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { env, isProd, isTest } from './lib/env.js';
import { ApiError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import multipart from '@fastify/multipart';
import authRoutes from './modules/auth/routes.js';
import publicBookRoutes from './modules/books/public.js';
import adminBookRoutes from './modules/books/admin.js';
import mediaRoutes from './modules/media/routes.js';
import accountRoutes from './modules/account/routes.js';
import wishlistRoutes from './modules/wishlists/routes.js';
import giftRoutes from './modules/gifts/routes.js';
import adminOrderRoutes from './modules/orders/admin.js';
import dashboardRoutes from './modules/admin/dashboard.js';
import peopleRoutes from './modules/admin/people.js';
import themeRoutes from './modules/admin/themes.js';
import settingsRoutes from './modules/admin/settings.js';
import adminJournalRoutes from './modules/journal/admin.js';
import checkoutRoutes from './modules/checkout/routes.js';
import { loadAvatars } from './modules/auth/avatars.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, '../../web');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest ? false : {
      level: isProd ? 'info' : 'debug',
      /* Nothing here is logged today — Fastify's default request serialiser
         records the method, the url and the address, and not the headers.
         The redaction is for the next person: the day somebody logs a whole
         request to chase a bug, a session cookie must not land in a log file
         where it would be a working key to somebody's account. */
      redact: {
        paths: [
          'req.headers.cookie', 'req.headers.authorization',
          'res.headers["set-cookie"]',
          'req.body.password', 'req.body.newPassword', 'req.body.currentPassword',
          'req.body.token'
        ],
        remove: true
      }
    },
    trustProxy: isProd,
    bodyLimit: 2 * 1024 * 1024
  });

  await app.register(helmet, {
    // The prototype's covers are built from inline styles and inline SVG, so
    // the policy allows inline style but never inline script.
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    } : false,
    /* The policy says frame-ancestors 'none'; the legacy header said
       SAMEORIGIN. An old browser reading only the header would have allowed
       a frame the policy forbids, so the two agree now. */
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false
  });

  await app.register(cookie, { secret: env.SESSION_SECRET, hook: 'onRequest' });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: () => isTest,
    keyGenerator: (req) => req.ip
  });

  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 12 } });
  await app.register(authPlugin);

  // ---------- one error shape for everything ----------
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Some of that is not right.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        }
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: { code: 'conflict', message: 'That already exists.' } });
      }
      if (err.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many attempts. Try again shortly.' } });
    }

    req.log.error({ err }, 'unhandled');
    // Never leak an internal message to the client.
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on our side.' } });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'No such endpoint.' } });
    }
    // Anything else is the site; let the static plugin's index answer.
    return reply.sendFile('index.html');
  });

  // ---------- api ----------
  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(publicBookRoutes, { prefix: '/api/books' });
  await app.register(adminBookRoutes, { prefix: '/api/admin/books' });
  await app.register(mediaRoutes, { prefix: '/api/admin/media' });
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.register(wishlistRoutes, { prefix: '/api/wishlists' });
  await app.register(giftRoutes, { prefix: '/api/gifts' });
  await app.register(adminOrderRoutes, { prefix: '/api/admin/orders' });
  await app.register(dashboardRoutes, { prefix: '/api/admin/dashboard' });
  await app.register(peopleRoutes, { prefix: '/api/admin' });
  await app.register(themeRoutes, { prefix: '/api/admin/themes' });
  await app.register(adminJournalRoutes, { prefix: '/api/admin/articles' });
  await app.register(settingsRoutes, { prefix: '/api/admin/settings' });
  await app.register(checkoutRoutes, { prefix: '/api/checkout' });

  /* Two static roots, each in its own scope.
     @fastify/static registers its wildcard into the enclosing context, so two
     registrations side by side collide and the second silently wins — which is
     how /media/* went missing while every request for it quietly returned the
     shop's index.html. Encapsulating each keeps them apart. */
  if (env.STORAGE_DRIVER === 'local') {
    const dir = path.resolve(env.STORAGE_LOCAL_DIR);
    await mkdir(dir, { recursive: true });
    await app.register(async (scope) => {
      await scope.register(staticPlugin, {
        root: dir,
        prefix: `${env.STORAGE_PUBLIC_PATH}/`,
        decorateReply: false,
        // filenames are content hashes, so these can be cached for good
        cacheControl: true, maxAge: '365d', immutable: true
      });
    });
  }

  await app.register(async (scope) => {
    await scope.register(staticPlugin, { root: WEB_ROOT, prefix: '/', index: ['index.html'] });
  });

  await loadAvatars();
  return app;
}

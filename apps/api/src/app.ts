import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { env, isProd, isTest } from './lib/env.js';
import { ApiError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './modules/auth/routes.js';
import { loadAvatars } from './modules/auth/avatars.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, '../../web');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest ? false : { level: isProd ? 'info' : 'debug' },
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

  // ---------- the site ----------
  await app.register(staticPlugin, { root: WEB_ROOT, prefix: '/', index: ['index.html'], wildcard: false });

  await loadAvatars();
  return app;
}

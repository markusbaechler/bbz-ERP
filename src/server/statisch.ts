import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** PWA unter /app/ (Mitarbeitende) und Homepage-Widget unter /widget/ (oeffentlich, cachebar). */
export function registriereStatisch(app: FastifyInstance): void {
  const web = join(wurzel, 'web');
  const widget = join(wurzel, 'widget');
  if (existsSync(web)) {
    app.register(fastifyStatic, { root: web, prefix: '/app/', decorateReply: false, index: ['index.html'] });
    app.get('/app', async (_req, reply) => reply.redirect('/app/'));
    app.get('/', async (_req, reply) => reply.redirect('/app/'));
  }
  if (existsSync(widget)) {
    app.register(fastifyStatic, {
      root: widget, prefix: '/widget/', decorateReply: false,
      setHeaders: (res) => { res.setHeader('cache-control', 'public, max-age=300'); res.setHeader('access-control-allow-origin', '*'); },
    });
  }
}

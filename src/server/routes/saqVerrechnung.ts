import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { verrechneSaqFall, storniereSaqFall } from '../../repos/saqVerrechnungRepo';

export function registerSaqVerrechnungRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/saq/fall/:id/verrechnen', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await verrechneSaqFall(pool, (req.params as any).id, req.body as any, req.benutzer)); }
    catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/fall/:id/stornieren', async (req, reply) => {
    try { return await storniereSaqFall(pool, (req.params as any).id, req.body as any, req.benutzer); }
    catch (e) { return sendError(reply, e); }
  });
}

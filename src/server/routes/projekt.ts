import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createProjekt, listProjekteMitAuftraggeber, getProjektDetail, listRechnungenFuerProjekt } from '../../repos/projektRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';

export function registerProjektRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/projekt', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = await createProjekt(pool, req.body as any);
      return reply.code(201).send(p);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
  app.get('/projekt', async (req) => {
    const q = req.query as any;
    return listProjekteMitAuftraggeber(pool, { jahr: q.jahr ? Number(q.jahr) : undefined });
  });
  app.get('/projekt/:id', async (req, reply) => {
    try { return await getProjektDetail(pool, (req.params as any).id); }
    catch (e) {
      if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });
  app.get('/projekt/:id/rechnungen', async (req, reply) => {
    try {
      await getProjektDetail(pool, (req.params as any).id);   // 404 statt leerer Liste bei Tippfehler
      return await listRechnungenFuerProjekt(pool, (req.params as any).id);
    } catch (e) {
      if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });
}

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createProjekt, listProjekte, getProjektById } from '../../repos/projektRepo';
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
    return listProjekte(pool, { jahr: q.jahr ? Number(q.jahr) : undefined, auftraggeberId: q.auftraggeberId });
  });
  app.get('/projekt/:id', async (req, reply) => {
    try {
      return await getProjektById(pool, (req.params as any).id);
    } catch (e) {
      if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });
}

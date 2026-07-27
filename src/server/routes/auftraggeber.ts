import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createAuftraggeber, listAuftraggeber } from '../../repos/auftraggeberRepo';
import { ValidationError } from '../../domain/errors';

export function registerAuftraggeberRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/auftraggeber', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const a = await createAuftraggeber(pool, req.body as any);
      return reply.code(201).send(a);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
  app.get('/auftraggeber', async () => listAuftraggeber(pool));
}

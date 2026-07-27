import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createAuftraggeber, listAuftraggeber, updateAuftraggeber } from '../../repos/auftraggeberRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';

function mapErr(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

export function registerAuftraggeberRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/auftraggeber', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const a = await createAuftraggeber(pool, req.body as any);
      return reply.code(201).send(a);
    } catch (e) {
      return mapErr(reply, e);
    }
  });
  // Nachtragen der Adresse aus der FileMaker-Migration (Befund B3): erst damit faellt
  // adresse_unvollstaendig und der Auftraggeber wird fakturierbar. Das Kennzeichen selbst
  // ist kein Eingabefeld — es wird im Repo aus Strasse/PLZ/Ort abgeleitet.
  app.put('/auftraggeber/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.send(await updateAuftraggeber(pool, (req.params as any).id, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/auftraggeber', async () => listAuftraggeber(pool));
}

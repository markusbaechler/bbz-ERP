import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { createMitarbeitende, listMitarbeitende, getMitarbeitende, updateMitarbeitende } from '../../repos/mitarbeitendeRepo';
import { createReferent, listReferenten, getReferent, updateReferent } from '../../repos/referentRepo';
import { listEinsaetze } from '../../repos/einsatzRepo';

export function registerPersonalRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/mitarbeitende', async (req) => listMitarbeitende(pool, { nurAktive: (req.query as any).aktiv === 'true' }));
  app.get('/mitarbeitende/:id', async (req, reply) => {
    try { return await getMitarbeitende(pool, (req.params as any).id); } catch (e) { return sendError(reply, e); }
  });
  app.post('/mitarbeitende', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createMitarbeitende(pool, req.body as any)); } catch (e) { return sendError(reply, e); }
  });
  app.patch('/mitarbeitende/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await updateMitarbeitende(pool, (req.params as any).id, req.body as any); } catch (e) { return sendError(reply, e); }
  });

  app.get('/referent', async (req) => {
    const q = req.query as any;
    return listReferenten(pool, { nurAktive: q.aktiv === 'true', fachgebiet: q.fachgebiet });
  });
  app.get('/referent/:id', async (req, reply) => {
    try { return await getReferent(pool, (req.params as any).id); } catch (e) { return sendError(reply, e); }
  });
  app.post('/referent', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createReferent(pool, req.body as any)); } catch (e) { return sendError(reply, e); }
  });
  app.patch('/referent/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await updateReferent(pool, (req.params as any).id, req.body as any); } catch (e) { return sendError(reply, e); }
  });
  /** Belegungskalender einer Referentin / eines Referenten (alle Einsaetze im Zeitraum). */
  app.get('/referent/:id/belegung', async (req) => {
    const q = req.query as any;
    return listEinsaetze(pool, { referentId: (req.params as any).id, von: q.von, bis: q.bis });
  });
}

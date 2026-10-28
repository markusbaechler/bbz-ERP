import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import {
  createSaqFall, listSaqFaelle, getSaqFall, updateSaqFall, setzeArbeitgeberbestaetigung, planePruefung, updatePruefung,
  erfasseResultat, stelleZertifikatAus, saqKennzahlen, kubaExport,
} from '../../repos/saqRepo';
import { heute } from '../../domain/saq';

/**
 * SAQ-Zertifizierung (Spec v2 §5.4b). Lesen/Schreiben fuer alle Mitarbeitenden (Bildung);
 * der KUBA-Export enthaelt Personendaten und ist Admin-only.
 */
export function registerSaqRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/saq/fall', async (req, reply) => {
    const q = req.query as any;
    try {
      return await listSaqFaelle(pool, {
        status: q.status, profil: q.profil, organisationId: q.organisationId, suche: q.suche,
        passiv: q.passiv === 'true', stichtag: q.stichtag, limit: q.limit ? Number(q.limit) : undefined,
      });
    } catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/fall', async (req, reply) => {
    try { return reply.code(201).send(await createSaqFall(pool, req.body as any, req.benutzer)); } catch (e) { return sendError(reply, e); }
  });
  app.get('/saq/fall/:id', async (req, reply) => {
    const q = req.query as any;
    try { return await getSaqFall(pool, (req.params as any).id, q.stichtag ?? heute()); } catch (e) { return sendError(reply, e); }
  });
  app.patch('/saq/fall/:id', async (req, reply) => {
    try { return await updateSaqFall(pool, (req.params as any).id, (req.body ?? {}) as any, req.benutzer); } catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/fall/:id/arbeitgeberbestaetigung', async (req, reply) => {
    try { return await setzeArbeitgeberbestaetigung(pool, (req.params as any).id, (req.body as any)?.datum, req.benutzer); }
    catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/fall/:id/pruefung', async (req, reply) => {
    try { return reply.code(201).send(await planePruefung(pool, (req.params as any).id, (req.body ?? {}) as any, req.benutzer)); }
    catch (e) { return sendError(reply, e); }
  });
  app.patch('/saq/pruefung/:id', async (req, reply) => {
    try { return await updatePruefung(pool, (req.params as any).id, (req.body ?? {}) as any); } catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/pruefung/:id/resultat', async (req, reply) => {
    try { return await erfasseResultat(pool, (req.params as any).id, (req.body ?? {}) as any, req.benutzer); } catch (e) { return sendError(reply, e); }
  });
  app.post('/saq/fall/:id/zertifikat', async (req, reply) => {
    try { return reply.code(201).send(await stelleZertifikatAus(pool, (req.params as any).id, (req.body ?? {}) as any, req.benutzer)); }
    catch (e) { return sendError(reply, e); }
  });
  app.get('/saq/kennzahlen', async (req, reply) => {
    const q = req.query as any;
    try { return await saqKennzahlen(pool, q.jahr ? Number(q.jahr) : Number(heute().slice(0, 4))); } catch (e) { return sendError(reply, e); }
  });
  app.get('/saq/export/kuba', { preHandler: requireAdmin }, async () => kubaExport(pool));
}

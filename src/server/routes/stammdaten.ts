import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { listKonten, createKonto } from '../../repos/kontoRepo';
import { listMwstSaetze, createMwstSatz } from '../../repos/mwstSatzRepo';
import { findMitarbeitendeByKuerzel, getMitarbeitende } from '../../repos/mitarbeitendeRepo';
import { listZahlungen } from '../../repos/debitorRepo';

/** Stammdaten (Kontenplan, MWSt) und Sitzungsinfo fuer die PWA. */
export function registerStammdatenRoutes(app: FastifyInstance, pool: pg.Pool): void {
  /** Angemeldete Person (Entra: aus dem Token; dev: aus x-user) mit wirksamer Rolle. */
  app.get('/me', async (req) => {
    const ma = req.mitarbeitendeId ? await getMitarbeitende(pool, req.mitarbeitendeId)
      : req.benutzer ? await findMitarbeitendeByKuerzel(pool, req.benutzer) : null;
    return { kuerzel: ma?.kuerzel ?? req.benutzer, rolle: req.rolle, mitarbeitende: ma };
  });
  app.get('/konto', async () => listKonten(pool));
  app.post('/konto', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createKonto(pool, req.body as any)); } catch (e) { return sendError(reply, e); }
  });
  app.get('/mwst-satz', async (req) => listMwstSaetze(pool, { gueltigAm: (req.query as any).gueltigAm }));
  app.post('/mwst-satz', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createMwstSatz(pool, req.body as any)); } catch (e) { return sendError(reply, e); }
  });
  app.get('/rechnung/:id/zahlungen', async (req) => listZahlungen(pool, (req.params as any).id));
}

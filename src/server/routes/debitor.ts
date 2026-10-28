import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { erfasseZahlung, offenePosten, kontokorrentSaldo } from '../../repos/debitorRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';
import { verbucheCamt054 } from '../../repos/zahlungImportRepo';
import { kontenAuswertung } from '../../repos/finanzAuswertungRepo';

function mapErr(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

export function registerDebitorRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/rechnung/:id/zahlung', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await erfasseZahlung(pool, (req.params as any).id, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  // Bankauszug camt.054 (QR-Zahlungen) verbuchen; Body { xml: "<Document>…" }
  app.post('/debitoren/camt054', { preHandler: requireAdmin }, async (req, reply) => {
    const xml = (req.body as any)?.xml;
    if (typeof xml !== 'string' || !xml.trim()) return reply.code(400).send({ error: 'xml fehlt' });
    try { return await verbucheCamt054(pool, xml, req.benutzer); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/finanzen/konten-auswertung', { preHandler: requireAdmin }, async (req, reply) => {
    const q = req.query as any;
    try { return await kontenAuswertung(pool, { von: q.von, bis: q.bis }); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/debitoren/offene-posten', async (req) => {
    const q = req.query as any;
    return offenePosten(pool, { auftraggeberId: q.auftraggeberId });
  });
  app.get('/auftraggeber/:id/saldo', async (req) => {
    const id = (req.params as any).id;
    return { auftraggeberId: id, saldo: await kontokorrentSaldo(pool, id) };
  });
}

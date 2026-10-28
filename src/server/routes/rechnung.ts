import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createRechnung, addPosition, festschreiben, getRechnung, listPositionen, stornieren, setDefVereinbart, listRechnungen, rechnungPerMail } from '../../repos/rechnungRepo';
import { getAuftraggeberById } from '../../repos/auftraggeberRepo';
import { erzeugeRechnungPdf } from '../../pdf/rechnungPdf';
import { ValidationError, NotFoundError } from '../../domain/errors';

function mapErr(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

export function registerRechnungRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/rechnung', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createRechnung(pool, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.post('/rechnung/:id/position', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await addPosition(pool, (req.params as any).id, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.post('/rechnung/:id/festschreiben', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.send(await festschreiben(pool, (req.params as any).id, (req.body as any)?.erstellerKuerzel)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.post('/rechnung/:id/def-vereinbart', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.send(await setDefVereinbart(pool, (req.params as any).id)); }
    catch (e) { return mapErr(reply, e); }
  });
  /** Storno: Nummer bleibt belegt; verrechnete Leistungen werden fuer eine korrigierte Rechnung freigegeben. */
  app.post('/rechnung/:id/stornieren', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.send(await stornieren(pool, (req.params as any).id, (req.body as any)?.grund, req.benutzer)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/rechnung', async (req) => {
    const q = req.query as any;
    return listRechnungen(pool, { projektId: q.projektId, auftraggeberId: q.auftraggeberId, status: q.status, jahr: q.jahr ? Number(q.jahr) : undefined });
  });
  app.get('/rechnung/:id', async (req, reply) => {
    try {
      const id = (req.params as any).id;
      const rechnung = await getRechnung(pool, id);
      return { ...rechnung, positionen: await listPositionen(pool, id) };
    } catch (e) { return mapErr(reply, e); }
  });
  // Rechnung mit QR-PDF per E-Mail (Outbox), Body { an?: string }
  app.post('/rechnung/:id/mail', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(202).send(await rechnungPerMail(pool, (req.params as any).id, (req.body as any)?.an, req.benutzer)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/rechnung/:id/pdf', async (req, reply) => {
    try {
      const id = (req.params as any).id;
      const rechnung = await getRechnung(pool, id);
      const positionen = await listPositionen(pool, id);
      const auftraggeber = await getAuftraggeberById(pool, rechnung.auftraggeberId);
      const pdf = await erzeugeRechnungPdf(rechnung, positionen, auftraggeber);
      return reply.header('content-type', 'application/pdf').send(pdf);
    } catch (e) { return mapErr(reply, e); }
  });
}

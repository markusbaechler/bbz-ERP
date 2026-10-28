import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { mahnvorschlag, mahnlauf, listMahnungen } from '../../repos/mahnungRepo';
import { getRechnung } from '../../repos/rechnungRepo';
import { heute } from '../../domain/mahnwesen';

/** Mahnwesen (Spec v2 §5.5): Vorschlag fuer alle, Mahnlauf Admin-only (Finanzaktion). Stichtag Default = heute (Zuerich). */
export function registerMahnwesenRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/debitoren/mahnvorschlag', async (req, reply) => {
    try { return await mahnvorschlag(pool, (req.query as any).stichtag ?? heute()); } catch (e) { return sendError(reply, e); }
  });
  app.post('/debitoren/mahnlauf', { preHandler: requireAdmin }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    try { return await mahnlauf(pool, { stichtag: b.stichtag ?? heute(), rechnungIds: b.rechnungIds }, req.benutzer); }
    catch (e) { return sendError(reply, e); }
  });
  app.get('/rechnung/:id/mahnungen', async (req, reply) => {
    const id = (req.params as any).id;
    try { await getRechnung(pool, id); return await listMahnungen(pool, id); } catch (e) { return sendError(reply, e); }
  });
}

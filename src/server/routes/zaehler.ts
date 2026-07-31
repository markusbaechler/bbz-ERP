import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { rechnungZaehlerStand, setzeRechnungZaehler, type ZaehlerStand } from '../../repos/zaehlerRepo';
import { rechnungNrUntergrenze, zaehlerGesperrt } from '../../config/rechnungszaehler';
import { ValidationError, NotFoundError } from '../../domain/errors';

function mapErr(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

// Was der Nachweis (zaehler.gesetzt_durch) festhaelt. Eine echte Benutzeridentitaet
// gibt es noch nicht: die Auth ist bis Plan 6 der Header-Platzhalter x-user-role
// (src/server/auth.ts, app.ts). Festgehalten wird darum genau das, was vorliegt —
// kein erfundenes Benutzermodell.
const akteur = (req: FastifyRequest): string => `REST x-user-role=${req.rolle}`;

const mitSperre = (s: ZaehlerStand) => ({ ...s, untergrenze: rechnungNrUntergrenze(), gesperrt: zaehlerGesperrt(s.wert) });

export function registerZaehlerRoutes(app: FastifyInstance, pool: pg.Pool): void {
  // Setzen ist folgenreich (die daraus vergebenen Nummern sind nach Spec §6.1
  // unwiderruflich) — darum Admin. Nur aufwaerts; die Regel steckt unveraendert
  // in setzeRechnungZaehler, die Route prueft nichts zusaetzlich nach.
  app.put('/zaehler/rechnung', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const wert = (req.body as any)?.wert;
      await setzeRechnungZaehler(pool, wert, akteur(req));
      return reply.send(mitSperre(await rechnungZaehlerStand(pool)));
    } catch (e) { return mapErr(reply, e); }
  });
  // Lesend wie die uebrigen GET-Routen (auftraggeber.ts, debitor.ts): ohne Rollenpruefung.
  app.get('/zaehler/rechnung', async (_req, reply) => {
    try { return reply.send(mitSperre(await rechnungZaehlerStand(pool))); }
    catch (e) { return mapErr(reply, e); }
  });
}

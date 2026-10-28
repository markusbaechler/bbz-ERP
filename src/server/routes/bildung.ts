import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { ValidationError } from '../../domain/errors';
import { createKursangebot, getKursangebot, listKursangebote, updateKursangebot } from '../../repos/kursangebotRepo';
import {
  createDurchfuehrung, getDurchfuehrung, getDurchfuehrungBasis, listDurchfuehrungen, updateDurchfuehrung,
  setDurchfuehrungStatus, addKurstag, deleteKurstag, referentZuweisen,
} from '../../repos/durchfuehrungRepo';
import {
  meldeAn, bestaetigeAnmeldung, storniereAnmeldung, setzeTeilnahme, getAnmeldung, listAnmeldungen, updateAnmeldung,
  teilnehmerliste, type TeilnehmerZeile,
} from '../../repos/anmeldungRepo';
import { verrechneDurchfuehrung, OhneRechnungsempfaengerError } from '../../repos/bildungVerrechnungRepo';
import {
  createLernnachweis, listLernnachweise, createZertifizierung, getZertifizierung, listZertifizierungen,
  getRezertifizierung, listFaelligeRezertifizierungen,
} from '../../repos/lernnachweisRepo';
import { getKontakt } from '../../repos/kontaktRepo';

const bool = (v: unknown): boolean | undefined => (v === undefined ? undefined : v === 'true');

/** Haengt die betroffenen Anmeldungen an die 400-Antwort (Verrechnung ohne Rechnungsempfaenger). */
function fehler(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof OhneRechnungsempfaengerError) return reply.code(400).send({ error: e.message, anmeldungIds: e.anmeldungIds });
  return sendError(reply, e);
}

// ---------------------------------------------------------------------------------------------
// CSV (Excel Schweiz: Semikolon, UTF-8 mit BOM, CRLF)
// ---------------------------------------------------------------------------------------------

function csvFeld(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Formel-Injection verhindern (Eingaben stammen teils von der Homepage); Telefonnummern "+41 ..." bleiben unveraendert.
  if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function alsCsv(kopf: string[], zeilen: unknown[][]): string {
  return '﻿' + [kopf, ...zeilen].map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}

const TEILNEHMER_SPALTEN: [string, (t: TeilnehmerZeile) => unknown][] = [
  ['Status', (t) => t.status], ['Warteliste', (t) => t.wartelistenPosition], ['Anrede', (t) => t.anrede],
  ['Vorname', (t) => t.vorname], ['Nachname', (t) => t.nachname], ['Organisation', (t) => t.organisation],
  ['Funktion', (t) => t.funktion], ['E-Mail', (t) => t.email], ['Telefon', (t) => t.telefon],
  ['Rechnungsempfaenger', (t) => t.rechnungsempfaenger], ['Referenz', (t) => t.rechnungsreferenz], ['Bemerkung', (t) => t.bemerkung],
];

export function registerBildungRoutes(app: FastifyInstance, pool: pg.Pool): void {
  const id = (req: { params: unknown }) => (req.params as any).id as string;

  // --- Kursangebot ---------------------------------------------------------------------------
  app.get('/kursangebot', async (req) => {
    const q = req.query as any;
    return listKursangebote(pool, { bereich: q.bereich, aktiv: bool(q.aktiv), oeffentlich: bool(q.oeffentlich) });
  });
  app.post('/kursangebot', async (req, reply) => {
    try { return reply.code(201).send(await createKursangebot(pool, req.body as any)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/kursangebot/:id', async (req, reply) => {
    try { return await getKursangebot(pool, id(req)); } catch (e) { return fehler(reply, e); }
  });
  app.patch('/kursangebot/:id', async (req, reply) => {
    try { return await updateKursangebot(pool, id(req), (req.body ?? {}) as any); } catch (e) { return fehler(reply, e); }
  });

  // --- Durchfuehrung -------------------------------------------------------------------------
  app.get('/durchfuehrung', async (req, reply) => {
    const q = req.query as any;
    try { return await listDurchfuehrungen(pool, { kursangebotId: q.kursangebotId, von: q.von, bis: q.bis, status: q.status }); }
    catch (e) { return fehler(reply, e); }
  });
  app.post('/durchfuehrung', async (req, reply) => {
    try { return reply.code(201).send(await createDurchfuehrung(pool, req.body as any)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/durchfuehrung/:id', async (req, reply) => {
    try { return await getDurchfuehrung(pool, id(req)); } catch (e) { return fehler(reply, e); }
  });
  app.patch('/durchfuehrung/:id', async (req, reply) => {
    try { return await updateDurchfuehrung(pool, id(req), (req.body ?? {}) as any); } catch (e) { return fehler(reply, e); }
  });
  app.post('/durchfuehrung/:id/status', async (req, reply) => {
    try { return await setDurchfuehrungStatus(pool, id(req), (req.body as any)?.status, req.benutzer); } catch (e) { return fehler(reply, e); }
  });
  app.post('/durchfuehrung/:id/kurstag', async (req, reply) => {
    try { return reply.code(201).send(await addKurstag(pool, id(req), req.body as any)); } catch (e) { return fehler(reply, e); }
  });
  app.delete('/kurstag/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try { await deleteKurstag(pool, id(req)); return reply.code(204).send(); } catch (e) { return fehler(reply, e); }
  });
  app.post('/kurstag/:id/referent', async (req, reply) => {
    try { return reply.code(201).send(await referentZuweisen(pool, id(req), req.body as any)); } catch (e) { return fehler(reply, e); }
  });

  // --- Anmeldung -----------------------------------------------------------------------------
  app.post('/durchfuehrung/:id/anmeldung', async (req, reply) => {
    try { return reply.code(201).send(await meldeAn(pool, id(req), (req.body ?? {}) as any)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/anmeldung', async (req) => {
    const q = req.query as any;
    return listAnmeldungen(pool, { durchfuehrungId: q.durchfuehrungId, kontaktId: q.kontaktId, status: q.status });
  });
  app.get('/anmeldung/:id', async (req, reply) => {
    try { return await getAnmeldung(pool, id(req)); } catch (e) { return fehler(reply, e); }
  });
  app.patch('/anmeldung/:id', async (req, reply) => {
    try { return await updateAnmeldung(pool, id(req), (req.body ?? {}) as any); } catch (e) { return fehler(reply, e); }
  });
  app.post('/anmeldung/:id/bestaetigen', async (req, reply) => {
    try { return await bestaetigeAnmeldung(pool, id(req), req.benutzer); } catch (e) { return fehler(reply, e); }
  });
  app.post('/anmeldung/:id/stornieren', async (req, reply) => {
    try { return await storniereAnmeldung(pool, id(req), (req.body ?? {}) as any, req.benutzer); } catch (e) { return fehler(reply, e); }
  });
  app.post('/anmeldung/:id/teilnahme', async (req, reply) => {
    try { return await setzeTeilnahme(pool, id(req), (req.body as any)?.status, req.benutzer); } catch (e) { return fehler(reply, e); }
  });
  app.get('/durchfuehrung/:id/teilnehmerliste', async (req, reply) => {
    try {
      const liste = await teilnehmerliste(pool, id(req));
      if ((req.query as any).format !== 'csv') return liste;
      const d = await getDurchfuehrungBasis(pool, id(req));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="teilnehmerliste-${d.code ?? d.id}.csv"`)
        .send(alsCsv(TEILNEHMER_SPALTEN.map(([k]) => k), liste.map((t) => TEILNEHMER_SPALTEN.map(([, f]) => f(t)))));
    } catch (e) { return fehler(reply, e); }
  });

  // --- Verrechnung (Admin) -------------------------------------------------------------------
  app.post('/durchfuehrung/:id/verrechnen', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const res = await verrechneDurchfuehrung(pool, id(req), (req.body ?? {}) as any, req.benutzer);
      return reply.code(res.rechnungen.length ? 201 : 200).send(res);
    } catch (e) { return fehler(reply, e); }
  });

  // --- Lernnachweise / Zertifizierung --------------------------------------------------------
  app.get('/kontakt/:id/lernnachweise', async (req, reply) => {
    const q = req.query as any;
    try { await getKontakt(pool, id(req)); return await listLernnachweise(pool, id(req), { von: q.von, bis: q.bis }); }
    catch (e) { return fehler(reply, e); }
  });
  app.post('/lernnachweis', async (req, reply) => {
    try { return reply.code(201).send(await createLernnachweis(pool, req.body as any)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/zertifizierung', async (req) => {
    const q = req.query as any;
    return listZertifizierungen(pool, { kontaktId: q.kontaktId, typ: q.typ, status: q.status });
  });
  app.post('/zertifizierung', async (req, reply) => {
    try { return reply.code(201).send(await createZertifizierung(pool, req.body as any)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/zertifizierung/:id', async (req, reply) => {
    try { return await getZertifizierung(pool, id(req)); } catch (e) { return fehler(reply, e); }
  });
  app.get('/zertifizierung/:id/rezertifizierung', async (req, reply) => {
    try { return await getRezertifizierung(pool, id(req), { heute: (req.query as any).heute }); } catch (e) { return fehler(reply, e); }
  });
  app.get('/bildung/rezertifizierung/faellig', async (req, reply) => {
    const q = req.query as any;
    try {
      const innertMonaten = q.innertMonaten === undefined ? undefined : Number(q.innertMonaten);
      if (innertMonaten !== undefined && Number.isNaN(innertMonaten)) throw new ValidationError('innertMonaten muss eine Zahl sein');
      return await listFaelligeRezertifizierungen(pool, { innertMonaten, heute: q.heute });
    } catch (e) { return fehler(reply, e); }
  });
}

/**
 * CRM-Routen (Spec v2 §5.2). Lesen/Schreiben fuer alle Mitarbeitenden, Loeschen nur Admin.
 * Fehler -> sendError (400/404/409). Datum 'YYYY-MM-DD', Zeitpunkte ISO-8601, JSON camelCase.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { ValidationError, NotFoundError } from '../../domain/errors';
import { heuteIso, optDatum, newsletterCsv } from '../../domain/crm';
import { findMitarbeitendeByKuerzel } from '../../repos/mitarbeitendeRepo';
import { createKontakt, updateKontakt, listKontakte, listNewsletterEmpfaenger } from '../../repos/kontaktRepo';
import { createOrganisation, updateOrganisation, listOrganisationen, verknuepfeAuftraggeber } from '../../repos/organisationRepo';
import { createAktivitaet, listAktivitaeten, deleteAktivitaet } from '../../repos/aktivitaetRepo';
import {
  createVerkaufschance, getVerkaufschance, updateVerkaufschance, listVerkaufschancen, setzePhase, eroeffneProjekt, ladePipeline,
} from '../../repos/verkaufschanceRepo';
import { createAnfrage, getAnfrage, listAnfragen, uebernehmeAnfrage, verwerfeAnfrage } from '../../repos/anfrageRepo';
import { ladeOrganisation360, ladeKontakt360, ladeWiedervorlagen, ladeCrmDashboard } from '../../repos/crmAuswertungRepo';
import { audit } from '../../repos/auditRepo';

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
/** Einheitliches Fehler-Mapping fuer alle CRM-Handler. */
const h = (fn: Handler): Handler => async (req, reply) => {
  try { return await fn(req, reply); } catch (e) { return sendError(reply, e); }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pfad-ID; keine UUID -> 404 (statt Datenbankfehler). */
function id(req: FastifyRequest): string {
  const v = (req.params as { id?: string }).id ?? '';
  if (!UUID_RE.test(v)) throw new NotFoundError(`${v} nicht gefunden`);
  return v;
}
const body = (req: FastifyRequest): any => {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) throw new ValidationError('JSON-Objekt erwartet');
  return b;
};
/** Query-Parameter als String (erster Wert bei Mehrfachangabe); leer -> undefined. */
function q(req: FastifyRequest, name: string): string | undefined {
  const v = (req.query as Record<string, unknown>)[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}
function qBool(req: FastifyRequest, name: string): boolean | undefined {
  const v = q(req, name);
  if (v === undefined) return undefined;
  if (v !== 'true' && v !== 'false') throw new ValidationError(`${name} muss true oder false sein`);
  return v === 'true';
}
function qInt(req: FastifyRequest, name: string): number | undefined {
  const v = q(req, name);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new ValidationError(`${name} muss eine positive ganze Zahl sein`);
  return Number(v);
}
const stichtag = (req: FastifyRequest): string => optDatum(q(req, 'stichtag'), 'stichtag') ?? heuteIso();

/** Kontakt-Felder, die kontaktRepo ungeprueft trimmt: Typfehler als 400 statt 500. */
function pruefeKontaktBody(b: Record<string, unknown>): Record<string, unknown> {
  for (const f of ['nachname', 'email']) {
    if (b[f] !== undefined && b[f] !== null && typeof b[f] !== 'string') throw new ValidationError(`${f} muss Text sein`);
  }
  if (b.interessen !== undefined && !(Array.isArray(b.interessen) && b.interessen.every((i) => typeof i === 'string'))) {
    throw new ValidationError('interessen muss eine Liste sein');
  }
  return b;
}

export function registerCrmRoutes(app: FastifyInstance, pool: pg.Pool): void {
  /** Record-Lead / Bearbeiter:in aus dem Benutzerkontext (Kuerzel im Header x-user). */
  const mitarbeitendeIdVon = async (req: FastifyRequest): Promise<string | null> =>
    req.benutzer ? (await findMitarbeitendeByKuerzel(pool, req.benutzer))?.id ?? null : null;

  /* ---------- Organisation ---------- */
  app.get('/organisation', h(async (req) => listOrganisationen(pool, {
    suche: q(req, 'suche'), kategorie: q(req, 'kategorie'), klassifizierung: q(req, 'klassifizierung'),
    betreuerId: q(req, 'betreuerId'), inklArchiviert: qBool(req, 'inklArchiviert'), limit: qInt(req, 'limit'),
  })));
  app.post('/organisation', h(async (req, reply) => reply.code(201).send(await createOrganisation(pool, body(req)))));
  app.get('/organisation/:id', h(async (req) => ladeOrganisation360(pool, id(req))));
  app.patch('/organisation/:id', h(async (req) => updateOrganisation(pool, id(req), body(req))));
  app.post('/organisation/:id/auftraggeber', h(async (req, reply) => {
    const b = body(req);
    return reply.code(201).send(await verknuepfeAuftraggeber(pool, id(req), { nummer: b.nummer, auftraggeberId: b.auftraggeberId }));
  }));

  /* ---------- Kontakt ---------- */
  // Statische Route vor /kontakt/:id (find-my-way bevorzugt statische Segmente ohnehin).
  app.get('/kontakt/export/newsletter', h(async (req, reply) => {
    const empfaenger = await listNewsletterEmpfaenger(pool);
    await audit(pool, { benutzer: req.benutzer, aktion: 'kontakt.newsletter_export', entitaet: 'kontakt', details: { anzahl: empfaenger.length } });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="newsletter-${heuteIso()}.csv"`)
      .send(newsletterCsv(empfaenger));
  }));
  app.get('/kontakt', h(async (req) => listKontakte(pool, {
    suche: q(req, 'suche'), organisationId: q(req, 'organisationId'), interesse: q(req, 'interesse'),
    betreuerId: q(req, 'betreuerId'), newsletter: qBool(req, 'newsletter'), inklArchiviert: qBool(req, 'inklArchiviert'), limit: qInt(req, 'limit'),
  })));
  app.post('/kontakt', h(async (req, reply) => reply.code(201).send(await createKontakt(pool, pruefeKontaktBody(body(req)) as any))));
  app.get('/kontakt/:id', h(async (req) => ladeKontakt360(pool, id(req))));
  app.patch('/kontakt/:id', h(async (req) => updateKontakt(pool, id(req), pruefeKontaktBody(body(req)) as any)));

  /* ---------- Aktivitaet ---------- */
  app.get('/aktivitaet', h(async (req) => listAktivitaeten(pool, {
    kontaktId: q(req, 'kontaktId'), organisationId: q(req, 'organisationId'), projektId: q(req, 'projektId'),
    verkaufschanceId: q(req, 'verkaufschanceId'), mitarbeitendeId: q(req, 'mitarbeitendeId'),
    von: q(req, 'von'), bis: q(req, 'bis'), limit: qInt(req, 'limit'),
  })));
  app.post('/aktivitaet', h(async (req, reply) => {
    const b = body(req);
    const mitarbeitendeId = b.mitarbeitendeId ?? await mitarbeitendeIdVon(req);
    return reply.code(201).send(await createAktivitaet(pool, { ...b, mitarbeitendeId }));
  }));
  app.delete('/aktivitaet/:id', { preHandler: requireAdmin }, h(async (req, reply) => {
    await deleteAktivitaet(pool, id(req));
    return reply.code(204).send();
  }));

  /* ---------- Verkaufschance ---------- */
  app.get('/verkaufschance/pipeline', h(async (req) => ladePipeline(pool, { verantwortlichId: q(req, 'verantwortlichId') })));
  app.get('/verkaufschance', h(async (req) => listVerkaufschancen(pool, {
    phase: q(req, 'phase'), verantwortlichId: q(req, 'verantwortlichId'), organisationId: q(req, 'organisationId'), kontaktId: q(req, 'kontaktId'),
  })));
  app.post('/verkaufschance', h(async (req, reply) => reply.code(201).send(await createVerkaufschance(pool, body(req)))));
  app.get('/verkaufschance/:id', h(async (req) => getVerkaufschance(pool, id(req))));
  app.patch('/verkaufschance/:id', h(async (req) => updateVerkaufschance(pool, id(req), body(req))));
  app.post('/verkaufschance/:id/phase', h(async (req, reply) => {
    const b = body(req);
    if (b.wiedereroeffnen === true && req.rolle !== 'admin') return reply.code(403).send({ error: 'Wiedereroeffnung nur Admin' });
    return setzePhase(pool, id(req), {
      phase: b.phase, verlustgrund: b.verlustgrund, wahrscheinlichkeit: b.wahrscheinlichkeit, wiedereroeffnen: b.wiedereroeffnen === true,
      heute: heuteIso(), benutzer: req.benutzer,
    });
  }));
  app.post('/verkaufschance/:id/projekt', h(async (req, reply) => {
    const b = body(req);
    return reply.code(201).send(await eroeffneProjekt(pool, id(req), {
      stammnummer: b.stammnummer, jahr: b.jahr, ertragskontoId: b.ertragskontoId, name: b.name, heute: heuteIso(), benutzer: req.benutzer,
    }));
  }));

  /* ---------- Anfrage ---------- */
  app.get('/anfrage', h(async (req) => listAnfragen(pool, { status: q(req, 'status'), limit: qInt(req, 'limit') })));
  app.post('/anfrage', h(async (req, reply) => reply.code(201).send(await createAnfrage(pool, body(req)))));
  app.get('/anfrage/:id', h(async (req) => getAnfrage(pool, id(req))));
  app.post('/anfrage/:id/uebernehmen', h(async (req) => {
    const b = body(req);
    return uebernehmeAnfrage(pool, id(req), {
      organisationId: b.organisationId, organisationNeu: b.organisationNeu, verkaufschance: b.verkaufschance, kontakt: b.kontakt,
      bearbeitetDurchId: await mitarbeitendeIdVon(req), benutzer: req.benutzer,
    });
  }));
  app.post('/anfrage/:id/verwerfen', h(async (req) => verwerfeAnfrage(pool, id(req), {
    grund: body(req).grund, bearbeitetDurchId: await mitarbeitendeIdVon(req), benutzer: req.benutzer,
  })));

  /* ---------- Auswertungen ---------- */
  app.get('/crm/wiedervorlagen', h(async (req) => ladeWiedervorlagen(pool, { stichtag: stichtag(req), mitarbeitendeId: q(req, 'mitarbeitendeId') })));
  app.get('/crm/dashboard', h(async (req) => ladeCrmDashboard(pool, { stichtag: stichtag(req), mitarbeitendeId: q(req, 'mitarbeitendeId') })));
}

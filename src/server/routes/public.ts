import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { mitIdempotenz, enthaeltSteuerzeichen, type Antwort } from '../publicSchutz';
import { listOeffentlicheKurse, getOeffentlichenKurs } from '../../repos/kursangebotRepo';
import { meldeAn, DoppelanmeldungError } from '../../repos/anmeldungRepo';
import { createAnfrage, markiereAnfrageUebernommen } from '../../repos/anfrageRepo';
import { createSaqFall } from '../../repos/saqRepo';
import { kontaktAusOeffentlicherEingabe } from '../../repos/kontaktRepo';
import { findeOrganisationPerName, findeOeffentlicheDurchfuehrungPerCode, auftraggeberZuOrganisation } from '../../repos/zuordnungRepo';
import { normalisiereFormular, type FormularBefehl, type KontaktDaten } from '../../integrations/formulare';
import { ValidationError, NotFoundError, ConflictError } from '../../domain/errors';

/*
 * Oeffentliche Homepage-API v1 (Spec v2 §6.1). Grundsaetze (inkl. Security-Review 28.10.2026):
 *  - Schutz ueber API-Schluessel + Scope + Origin + Rate-Limit je Client und IP (publicSchutz.ts).
 *  - Alles laeuft auf EINER Verbindung/Transaktion mit dem Idempotenz-Eintrag (kein Pool-Deadlock).
 *  - Keine internen IDs von aussen; Organisation/Rechnungsempfaenger werden serverseitig zugeordnet.
 *  - Bestehende Kontakte werden nie veraendert; Abweichungen landen als Bemerkung.
 *  - Antworten verraten weder Personendaten noch ob jemand angemeldet ist noch interne IDs fremder Datensaetze;
 *    unbekannte und nicht-oeffentliche Durchfuehrungen werden gleich behandelt (Anfrage, 202).
 */

const NEUTRAL: Antwort = { status: 202, body: { status: 'eingegangen' } };

function abbilden(e: unknown): Antwort {
  if (e instanceof DoppelanmeldungError) return NEUTRAL;
  if (e instanceof ValidationError) return { status: 400, body: { error: e.message } };
  if (e instanceof NotFoundError) return { status: 404, body: { error: 'Nicht gefunden' } };
  if (e instanceof ConflictError) return { status: 409, body: { error: e.message } };
  throw e;
}

const sende = (reply: FastifyReply, a: Antwort & { wiederholt?: boolean }) =>
  reply.code(a.status).header('idempotent-replayed', a.wiederholt ? 'true' : 'false').send(a.body);

function body(req: FastifyRequest): Record<string, unknown> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || Array.isArray(b)) throw new ValidationError('JSON-Objekt erwartet');
  if (enthaeltSteuerzeichen(b)) throw new ValidationError('Eingabe enthaelt ungueltige Steuerzeichen');
  return b;
}

const zusatz = (basis: string | null, abweichungen: string[], bank: string | null, bankZugeordnet: boolean) =>
  [basis, abweichungen.length ? `Angaben laut Homepage (nicht uebernommen): ${abweichungen.join('; ')}` : null,
   !bankZugeordnet && bank ? `Bank laut Anmeldung: ${bank}` : null].filter(Boolean).join('\n') || null;

async function anfrageAus(c: pg.PoolClient, b: { kontakt: KontaktDaten; organisationName: string | null }, typ: 'offerte' | 'kontakt',
  interesse: string, nachricht: string, payload: Record<string, unknown>): Promise<Antwort> {
  await createAnfrage(c, { quelle: 'homepage', typ, anrede: b.kontakt.anrede, vorname: b.kontakt.vorname, nachname: b.kontakt.nachname,
    email: b.kontakt.email, telefon: b.kontakt.telefon, organisationName: b.organisationName, funktion: b.kontakt.funktion,
    interesse, nachricht, einwilligung: true, payload });
  return NEUTRAL;
}

/** Fuehrt einen normalisierten Formular-/API-Befehl auf der Transaktion c aus. */
export async function fuehreBefehlAus(c: pg.PoolClient, b: FormularBefehl, kontext: { quelleRoh?: Record<string, unknown>; formular?: string; idempotenz?: string | null }): Promise<Antwort> {
  const organisationId = await findeOrganisationPerName(c, b.organisationName);
  const payload = { formular: kontext.formular ?? null, rohdaten: kontext.quelleRoh ?? {} };

  if (b.art === 'anmeldung') {
    const durchfuehrungId = await findeOeffentlicheDurchfuehrungPerCode(c, b.durchfuehrungCode);
    if (!durchfuehrungId) {
      return anfrageAus(c, b, 'offerte', 'weiterbildung', `Anmeldung zu Durchfuehrung ${b.durchfuehrungCode} (unbekannt oder nicht oeffentlich)\n${b.bemerkung ?? ''}`.trim(), payload);
    }
    const k = await kontaktAusOeffentlicherEingabe(c, { email: b.kontakt.email, nachname: b.kontakt.nachname, vorname: b.kontakt.vorname,
      anrede: b.kontakt.anrede, funktion: b.kontakt.funktion, telefon: b.kontakt.telefon ?? b.kontakt.mobile, organisationId });
    const r = await meldeAn(c, durchfuehrungId, {
      kontaktId: k.kontakt.id, rechnungsreferenz: b.rechnungsreferenz, quelle: 'homepage', idempotenzSchluessel: kontext.idempotenz ?? null,
      bemerkung: zusatz(b.bemerkung, k.abweichungen, b.organisationName, !!organisationId),
    });
    return { status: 201, body: { status: r.anmeldung.status, warteliste: r.warteliste, wartelistenPosition: r.anmeldung.wartelistenPosition, referenz: r.anmeldung.id } };
  }

  if (b.art === 'saq') {
    // Herkunftsnachweis (Anfrage mit Rohdaten) + SAQ-Zertifizierungsvorgang in derselben Transaktion
    const anfrage = await createAnfrage(c, { quelle: 'homepage', typ: 'offerte', anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
      nachname: b.kontakt.nachname, email: b.kontakt.email, telefon: b.kontakt.telefon, organisationName: b.organisationName,
      funktion: b.rolle, interesse: 'zertifizierung', nachricht: `SAQ-Anmeldung ${b.profil} (${b.umfang}, ${b.variante}, ${b.sprache})`, einwilligung: true, payload });
    const k = await kontaktAusOeffentlicherEingabe(c, { email: b.kontakt.email, anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
      nachname: b.kontakt.nachname, telefon: b.kontakt.telefon ?? b.kontakt.mobile, geburtsdatum: b.kontakt.geburtsdatum, funktion: b.rolle, organisationId });
    const fall = await createSaqFall(c, {
      kontaktId: k.kontakt.id, organisationId, rechnungsempfaengerId: await auftraggeberZuOrganisation(c, organisationId),
      profil: b.profil, umfang: b.umfang, variante: b.variante, sprache: b.sprache, rolle: b.rolle,
      digitaleHilfsmittel: b.digitaleHilfsmittel, einwilligungRechnungBank: b.einwilligungRechnungBank,
      einwilligungWeitergabeGruppe: b.einwilligungWeitergabeGruppe, anfrageId: anfrage.id,
      bemerkung: zusatz(b.bemerkung, k.abweichungen, b.organisationName, !!organisationId),
    });
    await markiereAnfrageUebernommen(c, anfrage.id, { kontaktId: fall.kontaktId });
    return { status: 201, body: { status: 'angemeldet', referenz: fall.id } };
  }

  const a = await createAnfrage(c, { quelle: 'homepage', typ: b.typ, anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
    nachname: b.kontakt.nachname, email: b.kontakt.email, telefon: b.kontakt.telefon, organisationName: b.organisationName,
    funktion: b.kontakt.funktion, interesse: b.interesse, nachricht: b.nachricht, newsletter: b.newsletter, einwilligung: b.einwilligung, payload });
  return { status: 201, body: { status: 'eingegangen', referenz: a.id } };
}

export function registerPublicRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/public/v1/kurse', { preHandler: app.requireScope('public:read') }, async (req, reply) => {
    const q = req.query as { bereich?: string };
    reply.header('cache-control', 'public, max-age=60');
    return listOeffentlicheKurse(pool, { bereich: q.bereich });
  });

  app.get('/public/v1/kurse/:slug', { preHandler: app.requireScope('public:read') }, async (req, reply) => {
    try { reply.header('cache-control', 'public, max-age=60'); return await getOeffentlichenKurs(pool, (req.params as any).slug); }
    catch (e) { const a = abbilden(e); return reply.code(a.status).send(a.body); }
  });

  const idem = (req: FastifyRequest) => req.headers['idempotency-key'] as string | undefined;

  /** Direkte Anmeldung (ERP-Widget). Pflicht: Datenschutz + AGB akzeptiert. */
  app.post('/public/v1/anmeldungen', { preHandler: app.requireScope('public:anmeldung') }, async (req, reply) => {
    const key = idem(req);
    return sende(reply, await mitIdempotenz(pool, req.apiClient!.id, key, async (c) => {
      const b = body(req);
      const n = normalisiereFormular('anmeldung', { ...(b.kontakt as object ?? {}), bank: b.organisation, durchfuehrung: b.durchfuehrungCode,
        rechnungsreferenz: b.rechnungsreferenz, nachricht: b.bemerkung, datenschutz: b.datenschutz, agb: b.agb });
      if (!n.ok) return { status: 400, body: { error: 'Ungueltige Anmeldung', fehler: n.fehler } };
      if (n.befehl.art !== 'anmeldung') return { status: 400, body: { error: 'durchfuehrungCode fehlt oder ist ungueltig' } };
      return fuehreBefehlAus(c, n.befehl, { formular: 'anmeldung', idempotenz: key ? `${req.apiClient!.id}:${key}` : null });
    }, abbilden));
  });

  /** Kontakt-/Offert-/Rueckruf-Anfrage, Newsletter-Anmeldung (mit Einwilligung). */
  app.post('/public/v1/anfragen', { preHandler: app.requireScope('public:anfrage') }, async (req, reply) => {
    return sende(reply, await mitIdempotenz(pool, req.apiClient!.id, idem(req), async (c) => {
      const b = body(req) as Record<string, any>;
      const a = await createAnfrage(c, { quelle: 'homepage', typ: b.typ, anrede: b.anrede, vorname: b.vorname, nachname: b.nachname,
        email: b.email, telefon: b.telefon, organisationName: b.organisation, funktion: b.funktion, interesse: b.interesse,
        nachricht: b.nachricht, newsletter: b.newsletter === true, einwilligung: b.einwilligung === true });
      return { status: 201, body: { status: 'eingegangen', referenz: a.id } };
    }, abbilden));
  });

  /** Formular-Eingang fuer WPForms/Zapier (ersetzt Zapier -> SharePoint). */
  app.post('/public/v1/formulare/:formular', { preHandler: app.requireScope('public:formular') }, async (req, reply) => {
    const formular = (req.params as any).formular as string;
    const key = idem(req);
    return sende(reply, await mitIdempotenz(pool, req.apiClient!.id, key, async (c) => {
      const roh = body(req);
      const n = normalisiereFormular(formular, roh);
      if (!n.ok) return { status: n.fehler[0]?.startsWith('Unbekanntes Formular') ? 404 : 422, body: { error: 'Formular unvollstaendig', fehler: n.fehler } };
      return fuehreBefehlAus(c, n.befehl, { quelleRoh: roh, formular, idempotenz: key ? `${req.apiClient!.id}:${key}` : null });
    }, abbilden));
  });
}

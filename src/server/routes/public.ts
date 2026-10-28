import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { mitIdempotenz } from '../publicSchutz';
import { listOeffentlicheKurse, getOeffentlichenKurs } from '../../repos/kursangebotRepo';
import { meldeAn } from '../../repos/anmeldungRepo';
import { createAnfrage, markiereAnfrageUebernommen } from '../../repos/anfrageRepo';
import { createSaqFall } from '../../repos/saqRepo';
import { inTransaktion } from '../../repos/db';
import { findeOrganisationPerName, findeDurchfuehrungPerCode, auftraggeberZuOrganisation } from '../../repos/zuordnungRepo';
import { normalisiereFormular, type FormularBefehl } from '../../integrations/formulare';
import { ValidationError, NotFoundError, ConflictError } from '../../domain/errors';

/*
 * Oeffentliche Homepage-API v1 (Spec v2 §6.1). Grundsaetze:
 *  - Schutz ueber API-Schluessel + Scope + Origin (publicSchutz.ts), Idempotenz fuer POSTs.
 *  - Keine internen IDs von aussen uebernehmen (Organisation/Rechnungsempfaenger werden serverseitig zugeordnet).
 *  - Antworten enthalten keine Personendaten, nur Status und eine Referenz.
 */

type Antwort = { status: number; body: unknown };

function alsAntwort(e: unknown): Antwort {
  if (e instanceof ValidationError) return { status: 400, body: { error: e.message } };
  if (e instanceof NotFoundError) return { status: 404, body: { error: e.message } };
  if (e instanceof ConflictError) return { status: 409, body: { error: e.message } };
  throw e;
}

const sende = (reply: FastifyReply, a: Antwort & { wiederholt?: boolean }) =>
  reply.code(a.status).header('idempotent-replayed', a.wiederholt ? 'true' : 'false').send(a.body);

/** Fuehrt einen normalisierten Formular-/API-Befehl aus. */
export async function fuehreBefehlAus(pool: pg.Pool, b: FormularBefehl, kontext: { quelleRoh?: Record<string, unknown>; formular?: string; idempotenz?: string | null }): Promise<Antwort> {
  const organisationId = await findeOrganisationPerName(pool, b.organisationName);
  const payload = { formular: kontext.formular ?? null, rohdaten: kontext.quelleRoh ?? {} };
  if (b.art === 'anmeldung') {
    const durchfuehrungId = await findeDurchfuehrungPerCode(pool, b.durchfuehrungCode);
    if (!durchfuehrungId) {
      // Unbekannter Termin: nicht verlieren, sondern als Offertanfrage zur Klaerung erfassen
      const a = await createAnfrage(pool, { quelle: 'homepage', typ: 'offerte', anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
        nachname: b.kontakt.nachname, email: b.kontakt.email, telefon: b.kontakt.telefon, organisationName: b.organisationName,
        funktion: b.kontakt.funktion, interesse: 'weiterbildung', nachricht: `Anmeldung zu unbekannter Durchfuehrung ${b.durchfuehrungCode}\n${b.bemerkung ?? ''}`.trim(), einwilligung: true, payload });
      return { status: 202, body: { status: 'in_pruefung', referenz: a.id } };
    }
    const bemerkung = [b.bemerkung, !organisationId && b.organisationName ? `Arbeitgeber laut Anmeldung: ${b.organisationName}` : null].filter(Boolean).join('\n') || null;
    const r = await meldeAn(pool, durchfuehrungId, {
      kontakt: { email: b.kontakt.email, nachname: b.kontakt.nachname, vorname: b.kontakt.vorname, anrede: b.kontakt.anrede,
        funktion: b.kontakt.funktion, telefon: b.kontakt.telefon ?? b.kontakt.mobile, organisationId },
      rechnungsreferenz: b.rechnungsreferenz, bemerkung, quelle: 'homepage', idempotenzSchluessel: kontext.idempotenz ?? null,
    });
    return { status: 201, body: { status: r.anmeldung.status, warteliste: r.warteliste, wartelistenPosition: r.anmeldung.wartelistenPosition, referenz: r.anmeldung.id } };
  }
  if (b.art === 'saq') {
    // Herkunftsnachweis (Anfrage mit Rohdaten) + SAQ-Zertifizierungsvorgang in einer Transaktion
    return inTransaktion(pool, async (c) => {
      const anfrage = await createAnfrage(c, { quelle: 'homepage', typ: 'offerte', anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
        nachname: b.kontakt.nachname, email: b.kontakt.email, telefon: b.kontakt.telefon, organisationName: b.organisationName,
        funktion: b.rolle, interesse: 'zertifizierung', nachricht: `SAQ-Anmeldung ${b.profil} (${b.umfang}, ${b.variante}, ${b.sprache})`, einwilligung: true, payload });
      const fall = await createSaqFall(c, {
        kontakt: { email: b.kontakt.email, anrede: b.kontakt.anrede, vorname: b.kontakt.vorname, nachname: b.kontakt.nachname,
          telefon: b.kontakt.telefon ?? b.kontakt.mobile, geburtsdatum: b.kontakt.geburtsdatum, funktion: b.rolle },
        organisationId, rechnungsempfaengerId: await auftraggeberZuOrganisation(c, organisationId),
        profil: b.profil, umfang: b.umfang, variante: b.variante, sprache: b.sprache, rolle: b.rolle,
        digitaleHilfsmittel: b.digitaleHilfsmittel, einwilligungRechnungBank: b.einwilligungRechnungBank,
        einwilligungWeitergabeGruppe: b.einwilligungWeitergabeGruppe, anfrageId: anfrage.id,
        bemerkung: [b.bemerkung, !organisationId && b.organisationName ? `Bank laut Anmeldung: ${b.organisationName}` : null].filter(Boolean).join('\n') || null,
      });
      await markiereAnfrageUebernommen(c, anfrage.id, { kontaktId: fall.kontaktId });
      return { status: 201, body: { status: 'angemeldet', referenz: fall.id } };
    });
  }
  const a = await createAnfrage(pool, { quelle: 'homepage', typ: b.typ, anrede: b.kontakt.anrede, vorname: b.kontakt.vorname,
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
    catch (e) { const a = alsAntwort(e); return reply.code(a.status).send(a.body); }
  });

  /** Direkte Anmeldung (ERP-Widget). Pflicht: Datenschutz + AGB akzeptiert. */
  app.post('/public/v1/anmeldungen', { preHandler: app.requireScope('public:anmeldung') }, async (req, reply) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    const a = await mitIdempotenz(pool, req.apiClient!.id, key, async () => {
      const b = (req.body ?? {}) as Record<string, any>;
      const n = normalisiereFormular('anmeldung', { ...b.kontakt, bank: b.organisation, durchfuehrung: b.durchfuehrungCode,
        rechnungsreferenz: b.rechnungsreferenz, nachricht: b.bemerkung, datenschutz: b.datenschutz, agb: b.agb });
      if (!n.ok) return { status: 400, body: { error: 'Ungueltige Anmeldung', fehler: n.fehler } };
      if (n.befehl.art !== 'anmeldung') return { status: 400, body: { error: 'durchfuehrungCode fehlt oder ist ungueltig' } };
      try { return await fuehreBefehlAus(pool, n.befehl, { formular: 'anmeldung', idempotenz: key ? `${req.apiClient!.id}:${key}` : null }); }
      catch (e) { return alsAntwort(e); }
    });
    return sende(reply, a);
  });

  /** Kontakt-/Offert-/Rueckruf-Anfrage, Newsletter-Anmeldung (mit Einwilligung). */
  app.post('/public/v1/anfragen', { preHandler: app.requireScope('public:anfrage') }, async (req, reply) => {
    const a = await mitIdempotenz(pool, req.apiClient!.id, req.headers['idempotency-key'] as string | undefined, async () => {
      const b = (req.body ?? {}) as Record<string, any>;
      try {
        const x = await createAnfrage(pool, { quelle: 'homepage', typ: b.typ, anrede: b.anrede, vorname: b.vorname, nachname: b.nachname,
          email: b.email, telefon: b.telefon, organisationName: b.organisation, funktion: b.funktion, interesse: b.interesse,
          nachricht: b.nachricht, newsletter: b.newsletter === true, einwilligung: b.einwilligung === true });
        return { status: 201, body: { status: 'eingegangen', referenz: x.id } };
      } catch (e) { return alsAntwort(e); }
    });
    return sende(reply, a);
  });

  /** Formular-Eingang fuer WPForms/Zapier (ersetzt Zapier -> SharePoint). */
  app.post('/public/v1/formulare/:formular', { preHandler: app.requireScope('public:formular') }, async (req, reply) => {
    const formular = (req.params as any).formular as string;
    const key = req.headers['idempotency-key'] as string | undefined;
    const a = await mitIdempotenz(pool, req.apiClient!.id, key, async () => {
      const roh = (req.body ?? {}) as Record<string, unknown>;
      const n = normalisiereFormular(formular, roh);
      if (!n.ok) return { status: n.fehler[0]?.startsWith('Unbekanntes Formular') ? 404 : 422, body: { error: 'Formular unvollstaendig', fehler: n.fehler } };
      try { return await fuehreBefehlAus(pool, n.befehl, { quelleRoh: roh, formular, idempotenz: key ? `${req.apiClient!.id}:${key}` : null }); }
      catch (e) { return alsAntwort(e); }
    });
    return sende(reply, a);
  });
}

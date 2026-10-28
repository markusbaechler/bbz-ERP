import type pg from 'pg';
import type { Kontakt, Interesse } from '../domain/types';
import type { Anfrage, AnfrageQuelle, AnfrageTyp, AnfrageStatus, Organisation, Verkaufschance, AktivitaetTyp } from '../domain/crmTypes';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { optText, optEmail, optWert, optBool } from '../domain/crm';
import { type KontaktInput, createKontakt, findKontaktByEmail, findOrCreateKontaktByEmail, updateKontakt, getKontakt } from './kontaktRepo';
import { type OrganisationInput, createOrganisation, getOrganisation } from './organisationRepo';
import { createVerkaufschance } from './verkaufschanceRepo';
import { createAktivitaet } from './aktivitaetRepo';
import { audit } from './auditRepo';
import { type Db, inTransaktion } from './db';

export const ANFRAGE_QUELLEN: readonly AnfrageQuelle[] = ['homepage', 'email', 'telefon', 'event', 'import'];
export const ANFRAGE_TYPEN: readonly AnfrageTyp[] = ['kontakt', 'offerte', 'tailormade', 'newsletter', 'rueckruf'];
export const ANFRAGE_STATUS: readonly AnfrageStatus[] = ['neu', 'in_bearbeitung', 'uebernommen', 'verworfen'];
const OFFENE_STATUS: readonly AnfrageStatus[] = ['neu', 'in_bearbeitung'];
const INTERESSEN: readonly Interesse[] = ['nachwuchs', 'tailormade', 'weiterbildung', 'zertifizierung', 'beratung'];
const ANREDEN = ['Frau', 'Herr', 'Divers'] as const;

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export const mapAnfrage = (r: any): Anfrage => ({
  id: r.id, quelle: r.quelle, typ: r.typ, status: r.status, anrede: r.anrede, vorname: r.vorname, nachname: r.nachname,
  email: r.email, telefon: r.telefon, organisationName: r.organisation_name, funktion: r.funktion, interesse: r.interesse,
  nachricht: r.nachricht, newsletter: r.newsletter, einwilligung: r.einwilligung, payload: r.payload ?? {},
  kontaktId: r.kontakt_id, verkaufschanceId: r.verkaufschance_id, bearbeitetDurchId: r.bearbeitet_durch_id,
  eingegangenAm: iso(r.eingegangen_am)!, erledigtAm: iso(r.erledigt_am),
});

/** Felder = Tabellenspalten in camelCase. Wird auch von der oeffentlichen Homepage-API verwendet. */
export type AnfrageInput = {
  quelle?: AnfrageQuelle; typ?: AnfrageTyp; anrede?: string | null; vorname?: string | null; nachname?: string | null;
  email?: string | null; telefon?: string | null; organisationName?: string | null; funktion?: string | null;
  interesse?: string | null; nachricht?: string | null; newsletter?: boolean; einwilligung?: boolean;
  payload?: Record<string, unknown>;
};

/**
 * Eingang einer Anfrage (Homepage-Formular, E-Mail, Telefon ...). Regeln: E-Mail oder Telefon Pflicht;
 * Newsletter (auch typ=newsletter) nur mit Einwilligung (nDSG); typ/quelle aus Whitelist; Laengen begrenzt.
 */
export async function createAnfrage(db: Db, input: AnfrageInput): Promise<Anfrage> {
  const i = (input ?? {}) as Record<string, unknown>;
  const quelle = optWert(i.quelle, 'quelle', ANFRAGE_QUELLEN) ?? 'homepage';
  const typ = optWert(i.typ, 'typ', ANFRAGE_TYPEN) ?? 'kontakt';
  const email = optEmail(i.email) ?? null;
  const telefon = optText(i.telefon, 'telefon', 50) ?? null;
  if (!email && !telefon) throw new ValidationError('email oder telefon ist Pflicht');
  const newsletter = typ === 'newsletter' || (optBool(i.newsletter, 'newsletter') ?? false);
  const einwilligung = optBool(i.einwilligung, 'einwilligung') ?? false;
  if (newsletter && !einwilligung) throw new ValidationError('Newsletter verlangt die Einwilligung (einwilligung=true, nDSG)');
  const payload = i.payload ?? {};
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new ValidationError('payload muss ein Objekt sein');
  if (JSON.stringify(payload).length > 20000) throw new ValidationError('payload ist zu gross');
  const t = (f: string, max = 200) => optText(i[f], f, max) ?? null;
  const r = await db.query(
    `insert into anfrage(quelle,typ,anrede,vorname,nachname,email,telefon,organisation_name,funktion,interesse,nachricht,newsletter,einwilligung,payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [quelle, typ, t('anrede', 50), t('vorname'), t('nachname'), email, telefon, t('organisationName'), t('funktion'),
     t('interesse'), t('nachricht', 10000), newsletter, einwilligung, JSON.stringify(payload)]);
  return mapAnfrage(r.rows[0]);
}

export async function getAnfrage(db: Db, id: string, opts: { sperren?: boolean } = {}): Promise<Anfrage> {
  const r = await db.query(`select * from anfrage where id=$1 ${opts.sperren ? 'for update' : ''}`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Anfrage ${id} nicht gefunden`);
  return mapAnfrage(r.rows[0]);
}

/** `status`: ein Status oder kommagetrennte Liste. Neueste zuerst. */
export async function listAnfragen(db: Db, filter: { status?: string; limit?: number } = {}): Promise<Anfrage[]> {
  const args: unknown[] = []; let where = '';
  if (filter.status?.trim()) {
    args.push(filter.status.split(',').map((s) => optWert(s.trim(), 'status', ANFRAGE_STATUS)));
    where = 'where status = any($1)';
  }
  args.push(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
  const r = await db.query(`select * from anfrage ${where} order by eingegangen_am desc, id limit $${args.length}`, args);
  return r.rows.map(mapAnfrage);
}

export type UebernahmeInput = {
  organisationId?: string | null;
  /** Neue Organisation; ohne name wird der Organisationsname aus der Anfrage verwendet. */
  organisationNeu?: Partial<OrganisationInput> | null;
  verkaufschance?: { titel?: string | null; wertChf?: number | null; bereich?: string | null; erwarteterAbschluss?: string | null; verantwortlichId?: string | null } | null;
  /** Korrekturen/Ergaenzungen der Kontaktdaten gegenueber der Anfrage (z. B. fehlender Nachname). */
  kontakt?: Partial<KontaktInput> | null;
  bearbeitetDurchId?: string | null;
  benutzer?: string | null;
};

export type UebernahmeErgebnis = {
  anfrage: Anfrage; kontakt: Kontakt; kontaktNeu: boolean; organisation: Organisation | null; verkaufschance: Verkaufschance | null;
};

const AKTIVITAET_JE_QUELLE: Record<AnfrageQuelle, AktivitaetTyp> = { homepage: 'notiz', email: 'email', telefon: 'telefon', event: 'event', import: 'notiz' };

/**
 * Anfrage -> Kontakt (E-Mail-Dublettenschutz) [+ Organisation] [+ Verkaufschance] + Aktivitaet (Historie);
 * Status `uebernommen`. Muss auf einem Transaktions-Client laufen (siehe uebernehmeAnfrage).
 */
export async function uebernehmeAnfrageIn(c: pg.PoolClient, id: string, input: UebernahmeInput): Promise<UebernahmeErgebnis> {
  const a = await getAnfrage(c, id, { sperren: true });
  if (!OFFENE_STATUS.includes(a.status)) throw new ConflictError(`Anfrage ist bereits ${a.status}`);
  if (input.organisationId && input.organisationNeu) throw new ValidationError('Entweder organisationId oder organisationNeu angeben, nicht beides');
  if (input.verkaufschance && !input.organisationId && !input.organisationNeu) {
    throw new ValidationError('Eine Verkaufschance braucht eine Organisation (organisationId oder organisationNeu)');
  }
  const bearbeiter = input.bearbeitetDurchId ?? null;

  let organisation: Organisation | null = null;
  if (input.organisationId) organisation = await getOrganisation(c, input.organisationId);
  else if (input.organisationNeu) {
    organisation = await createOrganisation(c, { ...input.organisationNeu, name: input.organisationNeu.name ?? a.organisationName ?? '' } as OrganisationInput);
  }

  // Kontaktdaten: Anfrage + Korrekturen; Anrede/Interesse nur, wenn sie der Kontakt-Werteliste entsprechen.
  const k = input.kontakt ?? {};
  const anrede = (k.anrede ?? a.anrede) as Kontakt['anrede'];
  const interesse = (INTERESSEN as readonly string[]).includes(a.interesse ?? '') ? (a.interesse as Interesse) : null;
  const mitNewsletter = a.newsletter && a.einwilligung;
  const quelleEinwilligung = `anfrage:${a.id}`;
  const daten: KontaktInput = {
    ...k,
    nachname: optText(k.nachname ?? a.nachname, 'nachname', 200) ?? '',
    vorname: k.vorname ?? a.vorname, funktion: k.funktion ?? a.funktion, telefon: k.telefon ?? a.telefon,
    email: optEmail(k.email ?? a.email) ?? null,
    anrede: anrede && (ANREDEN as readonly string[]).includes(anrede) ? anrede : null,
    organisationId: organisation?.id ?? k.organisationId ?? null,
    interessen: k.interessen ?? (interesse ? [interesse] : []),
    betreuerId: k.betreuerId ?? bearbeiter,
    newsletter: mitNewsletter, einwilligungQuelle: mitNewsletter ? quelleEinwilligung : null,
  };
  const vorhanden = daten.email ? await findKontaktByEmail(c, daten.email) : null;
  if (!vorhanden && !daten.nachname?.trim()) throw new ValidationError('Nachname fehlt: Anfrage ohne Nachname, bitte kontakt.nachname mitgeben');

  let kontakt: Kontakt; let kontaktNeu: boolean;
  if (daten.email) ({ kontakt, neu: kontaktNeu } = await findOrCreateKontaktByEmail(c, { ...daten, email: daten.email }));
  else { kontakt = await createKontakt(c, daten); kontaktNeu = true; }

  if (!kontaktNeu) {
    // Bestehender Kontakt: nur ergaenzen (Interesse, Newsletter-Einwilligung), nie ueberschreiben.
    const ergaenzung: Partial<KontaktInput> = {};
    if (interesse && !kontakt.interessen.includes(interesse)) ergaenzung.interessen = [...kontakt.interessen, interesse];
    if (mitNewsletter && !(kontakt.newsletter && kontakt.einwilligungAm)) {
      ergaenzung.newsletter = true; ergaenzung.einwilligungQuelle = quelleEinwilligung;
    }
    if (Object.keys(ergaenzung).length) kontakt = await updateKontakt(c, kontakt.id, ergaenzung);
  }

  let verkaufschance: Verkaufschance | null = null;
  if (input.verkaufschance && organisation) {
    const v = input.verkaufschance;
    verkaufschance = await createVerkaufschance(c, {
      titel: v.titel ?? `Anfrage ${a.typ}: ${organisation.name}`, organisationId: organisation.id, kontaktId: kontakt.id,
      bereich: v.bereich ?? null, wertChf: v.wertChf ?? null, erwarteterAbschluss: v.erwarteterAbschluss ?? null,
      verantwortlichId: v.verantwortlichId ?? bearbeiter, quelle: a.quelle,
    });
  }

  await createAktivitaet(c, {
    typ: AKTIVITAET_JE_QUELLE[a.quelle], datum: a.eingegangenAm, betreff: `Anfrage (${a.typ}) via ${a.quelle}`,
    notizen: a.nachricht, kontaktId: kontakt.id, organisationId: organisation?.id ?? kontakt.organisationId,
    verkaufschanceId: verkaufschance?.id ?? null, mitarbeitendeId: bearbeiter,
  });

  const r = await c.query(
    `update anfrage set status='uebernommen', kontakt_id=$2, verkaufschance_id=$3, bearbeitet_durch_id=$4, erledigt_am=now()
     where id=$1 returning *`, [a.id, kontakt.id, verkaufschance?.id ?? null, bearbeiter]);
  await audit(c, {
    benutzer: input.benutzer, aktion: 'anfrage.uebernommen', entitaet: 'anfrage', entitaetId: a.id,
    details: { kontaktId: kontakt.id, kontaktNeu, organisationId: organisation?.id ?? null, organisationNeu: !!input.organisationNeu, verkaufschanceId: verkaufschance?.id ?? null },
  });
  return { anfrage: mapAnfrage(r.rows[0]), kontakt: await getKontakt(c, kontakt.id), kontaktNeu, organisation, verkaufschance };
}

/** Uebernahme atomar: alles oder nichts (inTransaktion). */
export async function uebernehmeAnfrage(pool: pg.Pool, id: string, input: UebernahmeInput): Promise<UebernahmeErgebnis> {
  return inTransaktion(pool, (c) => uebernehmeAnfrageIn(c, id, input ?? {}));
}

export async function verwerfeAnfrage(pool: pg.Pool, id: string, input: { grund?: string | null; bearbeitetDurchId?: string | null; benutzer?: string | null }): Promise<Anfrage> {
  const grund = optText(input?.grund, 'grund', 1000) ?? null;
  return inTransaktion(pool, async (c) => {
    const a = await getAnfrage(c, id, { sperren: true });
    if (!OFFENE_STATUS.includes(a.status)) throw new ConflictError(`Anfrage ist bereits ${a.status}`);
    const r = await c.query(
      `update anfrage set status='verworfen', bearbeitet_durch_id=$2, erledigt_am=now(),
         payload = case when $3::text is null then payload else payload || jsonb_build_object('verwerfgrund', $3::text) end
       where id=$1 returning *`, [id, input?.bearbeitetDurchId ?? null, grund]);
    await audit(c, { benutzer: input?.benutzer, aktion: 'anfrage.verworfen', entitaet: 'anfrage', entitaetId: id, details: grund ? { grund } : {} });
    return mapAnfrage(r.rows[0]);
  });
}

/** Automatische Uebernahme (z. B. SAQ-Formular -> SAQ-Fall): Anfrage bleibt als Herkunftsnachweis mit Rohdaten erhalten. */
export async function markiereAnfrageUebernommen(db: Db, id: string, input: { kontaktId: string | null }): Promise<void> {
  await db.query(
    `update anfrage set status='uebernommen', kontakt_id=coalesce($2, kontakt_id), erledigt_am=now()
     where id=$1 and status in ('neu','in_bearbeitung')`, [id, input.kontaktId]);
}

// SAQ-Zertifizierung (Spec v2 §5.4b): Zertifizierungsfall (Vorgang), Pruefungs-Runs, Resultate, Zertifikat,
// Kennzahlen und KUBA-Export. Fachregeln in src/domain/saq.ts; hier nur Laden, Sperren, Schreiben.
import type pg from 'pg';
import type { Kontakt } from '../domain/types';
import type {
  SaqFall, SaqFallListeneintrag, SaqFallDetail, SaqPruefung, SaqZertifikat, SaqKennzahlen, KubaZeile, SaqStatus,
  SaqPruefungArt,
} from '../domain/saqTypes';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { SAQ, SAQ_PASSERELLE } from '../config/saq';
import {
  SAQ_STATUS, normalisiereProfil, normalisiereSprache, normalisiereUmfang, normalisiereVariante, pruefeVariante,
  pflichtteile, umfangArten, uebersicht, berechneStatus, istOffen, muendlichZulassung, pruefeEinplanung,
  pruefeResultatErfassung, pruefeManuellenStatuswechsel, werteResultat, letztePruefung, hatGeplantenRun, istPassiv,
  gueltigBis, kennzahlen, kubaZeile, pruefeDatum, heute,
} from '../domain/saq';
import { type Db, inTransaktion, patchSets, num } from './db';
import { findOrCreateKontaktByEmail, getKontakt, updateKontakt } from './kontaktRepo';
import { publiziere } from './outboxRepo';
import { audit } from './auditRepo';

// ---------------------------------------------------------------- Mapping

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));

const mapFall = (r: any): SaqFall => ({
  id: r.id, kontaktId: r.kontakt_id, organisationId: r.organisation_id, rechnungsempfaengerId: r.rechnungsempfaenger_id,
  profil: r.profil, variante: r.variante, umfang: r.umfang, sprache: r.sprache, rolle: r.rolle, kennzeichnung: r.kennzeichnung,
  status: r.status, arbeitgeberbestaetigungAm: r.arbeitgeberbestaetigung_am, digitaleHilfsmittel: r.digitale_hilfsmittel,
  einwilligungRechnungBank: r.einwilligung_rechnung_bank, einwilligungWeitergabeGruppe: r.einwilligung_weitergabe_gruppe,
  zertifizierungId: r.zertifizierung_id, rechnungId: r.rechnung_id, anfrageId: r.anfrage_id, kubaHerkunft: r.kuba_herkunft,
  bemerkung: r.bemerkung, erstelltAm: iso(r.erstellt_am), geaendertAm: iso(r.geaendert_am),
});

const mapPruefung = (r: any): SaqPruefung => ({
  id: r.id, fallId: r.fall_id, art: r.art, teil: r.teil, run: r.run, durchfuehrungId: r.durchfuehrung_id, datum: r.datum,
  ort: r.ort, remote: r.remote, score: num(r.score), resultatProzent: num(r.resultat_prozent), bestanden: r.bestanden,
  experte1Id: r.experte1_id, experte2Id: r.experte2_id,
});

const mapZertifikat = (r: any): SaqZertifikat => ({
  id: r.id, kontaktId: r.kontakt_id, typ: r.typ, profil: r.profil, sprache: r.sprache, zertifikatNr: r.zertifikat_nr,
  ausgestelltAm: r.ausgestellt_am, gueltigBis: r.gueltig_bis, status: r.status,
});

const istClient = (db: Db): db is pg.PoolClient => typeof (db as pg.PoolClient).release === 'function';

/** Laeuft in der Transaktion des Aufrufers (PoolClient) oder oeffnet eine eigene (Pool). */
function mitTransaktion<T>(db: Db, fn: (c: Db) => Promise<T>): Promise<T> {
  return istClient(db) ? fn(db) : inTransaktion(db, fn);
}

const textOderNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const ja = (v: unknown): boolean => v === true;

async function sperreFall(db: Db, id: string): Promise<SaqFall> {
  const r = await db.query('select * from saq_fall where id=$1 for update', [id]);
  if (!r.rowCount) throw new NotFoundError(`SAQ-Fall ${id} nicht gefunden`);
  return mapFall(r.rows[0]);
}

async function ladeRuns(db: Db, fallId: string): Promise<SaqPruefung[]> {
  const r = await db.query(
    `select * from saq_pruefung where fall_id=$1 order by (art = 'muendlich'), teil, run`, [fallId]);
  return r.rows.map(mapPruefung);
}

/** Setzt den automatischen Status (offene Faelle) und protokolliert den Wechsel. */
async function aktualisiereStatus(db: Db, fall: SaqFall, runs: SaqPruefung[], benutzer: string | null, anlass: string): Promise<SaqFall> {
  if (!istOffen(fall.status)) return fall;
  const neu = berechneStatus(fall, runs);
  if (neu === fall.status) return fall;
  const r = await db.query('update saq_fall set status=$2, geaendert_am=now() where id=$1 returning *', [fall.id, neu]);
  await audit(db, { benutzer, aktion: 'saq.status', entitaet: 'saq_fall', entitaetId: fall.id, details: { von: fall.status, nach: neu, anlass } });
  return mapFall(r.rows[0]);
}

// ---------------------------------------------------------------- Anmeldung

export type SaqKontaktInput = {
  email: string; anrede?: Kontakt['anrede']; vorname?: string | null; nachname: string; telefon?: string | null;
  geburtsdatum?: string | null; funktion?: string | null;
};

export type SaqFallInput = {
  kontaktId?: string | null; kontakt?: SaqKontaktInput | null;
  organisationId?: string | null; rechnungsempfaengerId?: string | null;
  profil: string; variante?: string | null; umfang?: string | null; sprache?: string | null;
  rolle?: string | null; kennzeichnung?: string | null; arbeitgeberbestaetigungAm?: string | null;
  digitaleHilfsmittel?: boolean; einwilligungRechnungBank?: boolean; einwilligungWeitergabeGruppe?: boolean;
  anfrageId?: string | null; kubaHerkunft?: string | null; bemerkung?: string | null;
};

/**
 * Legt einen SAQ-Zertifizierungsfall an (auch fuer den Homepage-Formulareingang). Kontakt per kontaktId oder per
 * E-Mail-Dublettenschutz (findOrCreateKontaktByEmail; leere Felder inkl. Geburtsdatum werden ergaenzt, nie
 * ueberschrieben). Kontakt, Fall, Webhook-Ereignis "saq.angemeldet" und Audit committen gemeinsam.
 */
export async function createSaqFall(db: Db, input: SaqFallInput, benutzer: string | null = null): Promise<SaqFall> {
  const profil = normalisiereProfil(input.profil);
  const variante = normalisiereVariante(input.variante);
  pruefeVariante(profil, variante);
  const umfang = normalisiereUmfang(input.umfang);
  const sprache = normalisiereSprache(input.sprache);
  const agAm = input.arbeitgeberbestaetigungAm ? pruefeDatum(input.arbeitgeberbestaetigungAm, 'arbeitgeberbestaetigungAm') : null;
  if (!input.kontaktId && !input.kontakt) throw new ValidationError('kontaktId oder kontakt (mit email) ist Pflicht');
  if (!input.kontaktId && !textOderNull(input.kontakt?.email)) throw new ValidationError('kontakt.email ist Pflicht');

  return mitTransaktion(db, async (c) => {
    let kontakt: Kontakt;
    if (input.kontaktId) {
      kontakt = await getKontakt(c, input.kontaktId);
    } else {
      const k = input.kontakt as SaqKontaktInput;
      kontakt = (await findOrCreateKontaktByEmail(c, {
        email: k.email, anrede: k.anrede ?? null, vorname: k.vorname ?? null, nachname: k.nachname, telefon: k.telefon ?? null,
        geburtsdatum: k.geburtsdatum ?? null, funktion: k.funktion ?? null, organisationId: input.organisationId ?? null,
        sprache: sprache.toLowerCase(),
      })).kontakt;
      if (!kontakt.geburtsdatum && k.geburtsdatum) kontakt = await updateKontakt(c, kontakt.id, { geburtsdatum: k.geburtsdatum });
    }
    const r = await c.query(
      `insert into saq_fall(kontakt_id,organisation_id,rechnungsempfaenger_id,profil,variante,umfang,sprache,rolle,kennzeichnung,
         arbeitgeberbestaetigung_am,digitale_hilfsmittel,einwilligung_rechnung_bank,einwilligung_weitergabe_gruppe,anfrage_id,
         kuba_herkunft,bemerkung)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [kontakt.id, input.organisationId ?? null, input.rechnungsempfaengerId ?? null, profil, variante, umfang, sprache,
       textOderNull(input.rolle) ?? textOderNull(input.kontakt?.funktion) ?? kontakt.funktion, textOderNull(input.kennzeichnung), agAm,
       ja(input.digitaleHilfsmittel), ja(input.einwilligungRechnungBank), ja(input.einwilligungWeitergabeGruppe),
       input.anfrageId ?? null, textOderNull(input.kubaHerkunft), textOderNull(input.bemerkung)]);
    const fall = mapFall(r.rows[0]);
    await publiziere(c, 'saq.angemeldet', { fallId: fall.id });
    await audit(c, { benutzer, aktion: 'saq.angemeldet', entitaet: 'saq_fall', entitaetId: fall.id, details: { profil, umfang, variante } });
    return fall;
  });
}

// ---------------------------------------------------------------- Lesen

const LISTE_SQL = `
  select f.*, k.vorname as k_vorname, k.nachname as k_nachname, k.email as k_email, o.name as organisation_name,
         lp.letzte_pruefung, lp.geplant
  from saq_fall f
  join kontakt k on k.id = f.kontakt_id
  left join organisation o on o.id = f.organisation_id
  cross join lateral (
    select max(p.datum) filter (where p.bestanden is not null) as letzte_pruefung,
           coalesce(bool_or(p.bestanden is null and p.datum >= $1::date), false) as geplant
    from saq_pruefung p where p.fall_id = f.id
  ) lp`;

function mapListe(r: any, stichtag: string): SaqFallListeneintrag {
  const fall = mapFall(r);
  return {
    ...fall,
    kontakt: { id: r.kontakt_id, vorname: r.k_vorname, nachname: r.k_nachname, email: r.k_email },
    organisationName: r.organisation_name,
    letztePruefung: r.letzte_pruefung,
    passiv: istPassiv({ status: fall.status, letztePruefung: r.letzte_pruefung, geplant: r.geplant }, stichtag),
  };
}

export type SaqListeFilter = {
  status?: string; profil?: string; organisationId?: string; suche?: string; passiv?: boolean; stichtag?: string; limit?: number;
};

/** Liste mit Filtern; `passiv` (Stichtag, Default heute) wie bbz-saq: offen, letzte Pruefung > 365 Tage, nichts geplant. */
export async function listSaqFaelle(db: Db, filter: SaqListeFilter = {}): Promise<SaqFallListeneintrag[]> {
  const stichtag = filter.stichtag ? pruefeDatum(filter.stichtag, 'stichtag') : heute();
  const args: unknown[] = [stichtag]; const cond: string[] = [];
  if (filter.status) {
    if (!(SAQ_STATUS as string[]).includes(filter.status)) throw new ValidationError(`Unbekannter Status: ${filter.status}`);
    args.push(filter.status); cond.push(`f.status=$${args.length}`);
  }
  if (filter.profil) { args.push(normalisiereProfil(filter.profil)); cond.push(`f.profil=$${args.length}`); }
  if (filter.organisationId) { args.push(filter.organisationId); cond.push(`f.organisation_id=$${args.length}`); }
  if (filter.suche?.trim()) {
    args.push(`%${filter.suche.trim().toLowerCase()}%`);
    cond.push(`(lower(k.nachname) like $${args.length} or lower(coalesce(k.vorname,'')) like $${args.length} or lower(coalesce(k.email,'')) like $${args.length})`);
  }
  const limit = Number.isFinite(filter.limit) ? Math.min(Math.max(Math.trunc(filter.limit as number), 1), 5000) : 500;
  // Mit Passiv-Filter wird erst nach der (fachlichen) Bewertung begrenzt.
  if (!filter.passiv) args.push(limit);
  const sql = `${LISTE_SQL} ${cond.length ? 'where ' + cond.join(' and ') : ''}
    order by f.erstellt_am desc, f.id ${filter.passiv ? '' : `limit $${args.length}`}`;
  const zeilen = (await db.query(sql, args)).rows.map((r) => mapListe(r, stichtag));
  return filter.passiv ? zeilen.filter((z) => z.passiv).slice(0, limit) : zeilen;
}

async function passerelleMoeglich(db: Db, fall: SaqFall): Promise<boolean> {
  const vorgaenger = SAQ_PASSERELLE[fall.profil];
  if (!vorgaenger) return false;
  const r = await db.query(
    `select (exists (select 1 from saq_fall where kontakt_id=$1 and profil=$2 and status in ('bestanden','zertifiziert'))
          or exists (select 1 from zertifizierung where kontakt_id=$1 and profil=$2)) as moeglich`,
    [fall.kontaktId, vorgaenger]);
  return r.rows[0].moeglich;
}

/** Fallansicht: Stammdaten, Runs, Stand je Teilpruefung, Zulassung muendlich, Passerelle, Passiv und Hinweise. */
export async function getSaqFall(db: Db, id: string, stichtag: string = heute()): Promise<SaqFallDetail> {
  pruefeDatum(stichtag, 'stichtag');
  const r = await db.query(`${LISTE_SQL} where f.id=$2`, [stichtag, id]);
  if (!r.rowCount) throw new NotFoundError(`SAQ-Fall ${id} nicht gefunden`);
  const eintrag = mapListe(r.rows[0], stichtag);
  const pruefungen = await ladeRuns(db, id);
  const u = uebersicht(eintrag, pruefungen);
  const passerelle = await passerelleMoeglich(db, eintrag);
  const hinweise: string[] = [];
  if (eintrag.variante === 'passerelle' && !passerelle) {
    hinweise.push(`Passerelle ohne bestandenes Vorgaengerprofil ${SAQ_PASSERELLE[eintrag.profil]} im ERP`);
  }
  for (const p of pruefungen) {
    if (p.bestanden === null && p.datum < stichtag) {
      hinweise.push(`Ergebnis ausstehend: ${p.art === 'schriftlich' ? 'WE' : 'OE'}${p.teil} RUN${p.run} vom ${p.datum}`);
    }
  }
  let zertifizierung: SaqZertifikat | null = null;
  if (eintrag.zertifizierungId) {
    const z = await db.query('select * from zertifizierung where id=$1', [eintrag.zertifizierungId]);
    zertifizierung = z.rowCount ? mapZertifikat(z.rows[0]) : null;
  }
  return {
    ...eintrag, ...u, pruefungen,
    muendlichZulassung: muendlichZulassung(eintrag, u.schriftlichAlleBestanden),
    passerelleMoeglich: passerelle, hinweise, zertifizierung,
  };
}

// ---------------------------------------------------------------- Aendern

export type SaqFallPatch = Partial<Omit<SaqFallInput, 'kontaktId' | 'kontakt' | 'arbeitgeberbestaetigungAm'>> & {
  status?: string; rechnungId?: string | null;
};

const PATCH_COLS: Record<string, string> = {
  organisationId: 'organisation_id', rechnungsempfaengerId: 'rechnungsempfaenger_id', profil: 'profil', variante: 'variante',
  umfang: 'umfang', sprache: 'sprache', rolle: 'rolle', kennzeichnung: 'kennzeichnung', digitaleHilfsmittel: 'digitale_hilfsmittel',
  einwilligungRechnungBank: 'einwilligung_rechnung_bank', einwilligungWeitergabeGruppe: 'einwilligung_weitergabe_gruppe',
  rechnungId: 'rechnung_id', anfrageId: 'anfrage_id', kubaHerkunft: 'kuba_herkunft', bemerkung: 'bemerkung', status: 'status',
};

/**
 * PATCH eines Falls. Profil/Variante/Umfang nur in offenen Faellen und nur, wenn alle bestehenden Runs zu den neuen
 * Pflichtteilen passen (409); danach wird der automatische Status neu bestimmt. Status manuell nur
 * nicht_bestanden/abgebrochen (Audit).
 */
export async function updateSaqFall(db: Db, id: string, patch: SaqFallPatch, benutzer: string | null = null): Promise<SaqFall> {
  return mitTransaktion(db, async (c) => {
    const alt = await sperreFall(c, id);
    const p: Record<string, unknown> = {};
    for (const k of Object.keys(PATCH_COLS)) if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = (patch as any)[k];
    if ('profil' in p) p.profil = normalisiereProfil(p.profil);
    if ('variante' in p) p.variante = normalisiereVariante(p.variante);
    if ('umfang' in p) p.umfang = normalisiereUmfang(p.umfang);
    if ('sprache' in p) p.sprache = normalisiereSprache(p.sprache);
    for (const k of ['digitaleHilfsmittel', 'einwilligungRechnungBank', 'einwilligungWeitergabeGruppe']) {
      if (k in p && typeof p[k] !== 'boolean') throw new ValidationError(`${k} muss true oder false sein`);
    }
    for (const k of ['rolle', 'kennzeichnung', 'kubaHerkunft', 'bemerkung']) if (k in p) p[k] = textOderNull(p[k]);
    if ('status' in p) p.status = pruefeManuellenStatuswechsel(alt.status, p.status);

    const neu = { ...alt, ...(p as Partial<SaqFall>) };
    const strukturGeaendert = neu.profil !== alt.profil || neu.variante !== alt.variante || neu.umfang !== alt.umfang;
    const runs = strukturGeaendert ? await ladeRuns(c, id) : [];
    if (strukturGeaendert) {
      pruefeVariante(neu.profil, neu.variante);
      if (!istOffen(alt.status)) throw new ConflictError(`Profil/Variante/Umfang im Status ${alt.status} nicht aenderbar`);
      const teile = pflichtteile(neu.profil, neu.variante); const arten = umfangArten(neu.umfang);
      const fremd = runs.filter((r) => !arten.includes(r.art) || !teile[r.art].includes(r.teil));
      if (fremd.length) {
        throw new ConflictError(`Bestehende Runs passen nicht zu ${neu.profil}/${neu.variante}/${neu.umfang}: ${fremd.map((r) => `${r.art === 'schriftlich' ? 'WE' : 'OE'}${r.teil}`).join(', ')}`);
      }
    }
    const args: unknown[] = [id];
    const sets = patchSets(p, PATCH_COLS, args);
    if (!sets.length) return alt;
    sets.push('geaendert_am=now()');
    let fall = mapFall((await c.query(`update saq_fall set ${sets.join(',')} where id=$1 returning *`, args)).rows[0]);
    if (fall.status !== alt.status) {
      await audit(c, { benutzer, aktion: 'saq.status', entitaet: 'saq_fall', entitaetId: id, details: { von: alt.status, nach: fall.status } });
    }
    if (strukturGeaendert) fall = await aktualisiereStatus(c, fall, runs, benutzer, 'stammdaten');
    return fall;
  });
}

/** Arbeitgeberbestaetigung (Voraussetzung fuer die muendliche Pruefung); Datum Default heute. */
export async function setzeArbeitgeberbestaetigung(db: Db, id: string, datum?: string | null, benutzer: string | null = null): Promise<SaqFall> {
  const d = datum ? pruefeDatum(datum, 'datum') : heute();
  return mitTransaktion(db, async (c) => {
    await sperreFall(c, id);
    const r = await c.query('update saq_fall set arbeitgeberbestaetigung_am=$2, geaendert_am=now() where id=$1 returning *', [id, d]);
    await audit(c, { benutzer, aktion: 'saq.arbeitgeberbestaetigung', entitaet: 'saq_fall', entitaetId: id, details: { datum: d } });
    return mapFall(r.rows[0]);
  });
}

// ---------------------------------------------------------------- Pruefungen (Runs)

export type SaqPruefungInput = {
  art: SaqPruefungArt; teil: number; datum?: string | null; ort?: string | null; remote?: boolean;
  durchfuehrungId?: string | null; experte1Id?: string | null; experte2Id?: string | null;
};

function pruefeExperten(e1: string | null | undefined, e2: string | null | undefined): void {
  if (e1 && e2 && e1 === e2) throw new ValidationError('Experte 1 und Experte 2 muessen verschiedene Personen sein');
}

/**
 * Prueft einen Pruefungstermin (Durchfuehrung): vorhanden, nicht abgesagt und nicht ausgebucht. Gezaehlt werden alle
 * Runs auf dem Termin (ausser `ausser`) gegen `durchfuehrung.kapazitaet`; die Zeilensperre serialisiert Buchungen.
 */
async function pruefeTermin(db: Db, durchfuehrungId: string, ausser: string | null = null): Promise<{ startDatum: string; ort: string | null }> {
  const d = await db.query('select id, kapazitaet, status, start_datum, ort from durchfuehrung where id=$1 for update', [durchfuehrungId]);
  if (!d.rowCount) throw new NotFoundError(`Durchfuehrung ${durchfuehrungId} nicht gefunden`);
  const t = d.rows[0];
  if (t.status === 'abgesagt') throw new ConflictError('Pruefungstermin ist abgesagt');
  const b = await db.query(
    'select count(*)::int as n from saq_pruefung where durchfuehrung_id=$1 and ($2::uuid is null or id <> $2)', [durchfuehrungId, ausser]);
  if (b.rows[0].n >= t.kapazitaet) throw new ConflictError(`Pruefungstermin ausgebucht (Kapazitaet ${t.kapazitaet})`);
  return { startDatum: t.start_datum, ort: t.ort };
}

/** Plant den naechsten Run einer Teilpruefung (Run-Nummer = max + 1, Regeln siehe domain/saq pruefeEinplanung). */
export async function planePruefung(db: Db, fallId: string, input: SaqPruefungInput, benutzer: string | null = null): Promise<SaqPruefung> {
  const teil = Number(input.teil);
  pruefeExperten(input.experte1Id, input.experte2Id);
  return mitTransaktion(db, async (c) => {
    const fall = await sperreFall(c, fallId);
    const runs = await ladeRuns(c, fallId);
    const run = pruefeEinplanung(fall, runs, input.art, teil, Boolean(input.experte1Id || input.experte2Id));
    const termin = input.durchfuehrungId ? await pruefeTermin(c, input.durchfuehrungId) : null;
    const datum = pruefeDatum(input.datum ?? termin?.startDatum, 'datum');
    const r = await c.query(
      `insert into saq_pruefung(fall_id,art,teil,run,durchfuehrung_id,datum,ort,remote,experte1_id,experte2_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [fallId, input.art, teil, run, input.durchfuehrungId ?? null, datum, textOderNull(input.ort) ?? termin?.ort ?? null,
       ja(input.remote), input.experte1Id ?? null, input.experte2Id ?? null]);
    const pruefung = mapPruefung(r.rows[0]);
    await aktualisiereStatus(c, fall, [...runs, pruefung], benutzer, 'pruefung_geplant');
    return pruefung;
  });
}

export type SaqPruefungPatch = Partial<Pick<SaqPruefungInput, 'datum' | 'ort' | 'remote' | 'durchfuehrungId' | 'experte1Id' | 'experte2Id'>>;

/** Umbuchung bzw. Experten-Zuteilung eines geplanten Runs (ohne Resultat); Kapazitaet des neuen Termins wird geprueft. */
export async function updatePruefung(db: Db, id: string, patch: SaqPruefungPatch): Promise<SaqPruefung> {
  return mitTransaktion(db, async (c) => {
    const r = await c.query('select * from saq_pruefung where id=$1 for update', [id]);
    if (!r.rowCount) throw new NotFoundError(`SAQ-Pruefung ${id} nicht gefunden`);
    const alt = mapPruefung(r.rows[0]);
    if (alt.bestanden !== null) throw new ConflictError('Pruefung mit Resultat kann nicht mehr geaendert werden');
    const e1 = 'experte1Id' in patch ? patch.experte1Id : alt.experte1Id;
    const e2 = 'experte2Id' in patch ? patch.experte2Id : alt.experte2Id;
    if ((e1 || e2) && alt.art !== 'muendlich') throw new ValidationError('Experten gibt es nur bei muendlichen Pruefungen');
    pruefeExperten(e1, e2);
    if (patch.datum !== undefined) patch = { ...patch, datum: pruefeDatum(patch.datum, 'datum') };
    if ('ort' in patch) patch = { ...patch, ort: textOderNull(patch.ort) };
    if ('remote' in patch && typeof patch.remote !== 'boolean') throw new ValidationError('remote muss true oder false sein');
    if (patch.durchfuehrungId && patch.durchfuehrungId !== alt.durchfuehrungId) await pruefeTermin(c, patch.durchfuehrungId, id);
    const args: unknown[] = [id];
    const sets = patchSets(patch as Record<string, unknown>, {
      datum: 'datum', ort: 'ort', remote: 'remote', durchfuehrungId: 'durchfuehrung_id', experte1Id: 'experte1_id', experte2Id: 'experte2_id',
    }, args);
    if (!sets.length) return alt;
    return mapPruefung((await c.query(`update saq_pruefung set ${sets.join(',')} where id=$1 returning *`, args)).rows[0]);
  });
}

/**
 * Erfasst das Resultat eines Runs: `bestanden` massgebend, sonst aus resultatProzent abgeleitet (>= 70); Widerspruch
 * ergibt eine Warnung. Danach automatischer Status (schriftlich_bestanden, bestanden, nicht_bestanden nach RUN3).
 */
export async function erfasseResultat(db: Db, pruefungId: string, input: { resultatProzent?: unknown; score?: unknown; bestanden?: unknown }, benutzer: string | null = null): Promise<{ pruefung: SaqPruefung; fall: SaqFall; warnungen: string[] }> {
  const wertung = werteResultat(input);
  return mitTransaktion(db, async (c) => {
    const pr = await c.query('select fall_id from saq_pruefung where id=$1', [pruefungId]);
    if (!pr.rowCount) throw new NotFoundError(`SAQ-Pruefung ${pruefungId} nicht gefunden`);
    const fall = await sperreFall(c, pr.rows[0].fall_id);
    const runs = await ladeRuns(c, fall.id);
    const alt = runs.find((r) => r.id === pruefungId) as SaqPruefung;
    pruefeResultatErfassung(fall, runs, alt);
    const u = await c.query('update saq_pruefung set resultat_prozent=$2, score=$3, bestanden=$4 where id=$1 returning *',
      [pruefungId, wertung.resultatProzent, wertung.score, wertung.bestanden]);
    const pruefung = mapPruefung(u.rows[0]);
    await audit(c, {
      benutzer, aktion: 'saq.resultat', entitaet: 'saq_fall', entitaetId: fall.id,
      details: { pruefungId, art: pruefung.art, teil: pruefung.teil, run: pruefung.run, bestanden: pruefung.bestanden, resultatProzent: pruefung.resultatProzent, warnungen: wertung.warnungen },
    });
    const neu = await aktualisiereStatus(c, fall, runs.map((r) => (r.id === pruefungId ? pruefung : r)), benutzer, 'resultat');
    return { pruefung, fall: neu, warnungen: wertung.warnungen };
  });
}

// ---------------------------------------------------------------- Zertifikat

/**
 * Stellt das SAQ-Zertifikat aus (nur aus Status "bestanden"): `zertifizierung` mit Typ, Profil, Sprache, Nummer und
 * Gueltigkeit 3 Jahre (Start der Rezertifizierungsfrist), Fall -> zertifiziert, Audit.
 */
export async function stelleZertifikatAus(db: Db, fallId: string, input: { zertifikatNr?: string | null; ausgestelltAm?: string | null }, benutzer: string | null = null): Promise<{ fall: SaqFall; zertifizierung: SaqZertifikat }> {
  return mitTransaktion(db, async (c) => {
    const fall = await sperreFall(c, fallId);
    if (fall.status !== 'bestanden') throw new ConflictError(`Zertifikat nur nach bestandener Pruefung (Status ${fall.status})`);
    const nr = textOderNull(input.zertifikatNr);
    if (!nr) throw new ValidationError('zertifikatNr ist Pflicht');
    const ausgestelltAm = input.ausgestelltAm ? pruefeDatum(input.ausgestelltAm, 'ausgestelltAm') : heute();
    const z = await c.query(
      `insert into zertifizierung(kontakt_id,typ,profil,sprache,zertifikat_nr,ausgestellt_am,gueltig_bis)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [fall.kontaktId, SAQ.zertifikatTyp, fall.profil, fall.sprache, nr, ausgestelltAm, gueltigBis(ausgestelltAm)]);
    const zertifizierung = mapZertifikat(z.rows[0]);
    const f = await c.query(
      `update saq_fall set zertifizierung_id=$2, status='zertifiziert', geaendert_am=now() where id=$1 returning *`, [fallId, zertifizierung.id]);
    await audit(c, { benutzer, aktion: 'saq.status', entitaet: 'saq_fall', entitaetId: fallId, details: { von: fall.status, nach: 'zertifiziert', anlass: 'zertifikat' } });
    await audit(c, { benutzer, aktion: 'saq.zertifikat', entitaet: 'saq_fall', entitaetId: fallId, details: { zertifizierungId: zertifizierung.id, zertifikatNr: nr, ausgestelltAm, gueltigBis: zertifizierung.gueltigBis } });
    return { fall: mapFall(f.rows[0]), zertifizierung };
  });
}

// ---------------------------------------------------------------- Kennzahlen / KUBA-Export

/** Kennzahlen eines Jahres je Profil (Definitionen siehe domain/saq kennzahlen). */
export async function saqKennzahlen(db: Db, jahr: number): Promise<SaqKennzahlen> {
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) throw new ValidationError('jahr muss eine Jahreszahl sein');
  // Das Referenzdatum ist immer ein Run-Datum: Kandidaten sind Faelle mit einem Run im Jahr.
  const f = await db.query(
    `select id, profil, status from saq_fall f
     where exists (select 1 from saq_pruefung p where p.fall_id=f.id and p.datum between $1::date and $2::date)`,
    [`${jahr}-01-01`, `${jahr}-12-31`]);
  const runs = await db.query('select * from saq_pruefung where fall_id = any($1::uuid[])', [f.rows.map((r: any) => r.id)]);
  const jeFall = new Map<string, SaqPruefung[]>();
  for (const r of runs.rows.map(mapPruefung)) jeFall.set(r.fallId, [...(jeFall.get(r.fallId) ?? []), r]);
  return kennzahlen(jahr, f.rows.map((r: any) => ({ profil: r.profil, status: r.status as SaqStatus, runs: jeFall.get(r.id) ?? [] })));
}

/** Alle Vorgaenge im Feldformat des Cockpits bbz-saq (eine Zeile je Fall, Resultat als Anteil 0-1). */
export async function kubaExport(db: Db): Promise<KubaZeile[]> {
  const f = await db.query(
    `select f.*, k.nachname as k_nachname, k.vorname as k_vorname, k.geburtsdatum as k_geburtsdatum, k.sprache as k_sprache,
            k.funktion as k_funktion, o.name as organisation_name,
            z.zertifikat_nr as z_nr, z.ausgestellt_am as z_start, z.gueltig_bis as z_ende
     from saq_fall f
     join kontakt k on k.id = f.kontakt_id
     left join organisation o on o.id = f.organisation_id
     left join zertifizierung z on z.id = f.zertifizierung_id
     order by lower(k.nachname), lower(coalesce(k.vorname,'')), f.erstellt_am`);
  const runs = await db.query(
    `select p.*, r1.anzeigename as experte1, r2.anzeigename as experte2
     from saq_pruefung p
     left join referent r1 on r1.id = p.experte1_id
     left join referent r2 on r2.id = p.experte2_id`);
  const jeFall = new Map<string, any[]>();
  for (const r of runs.rows) jeFall.set(r.fall_id, [...(jeFall.get(r.fall_id) ?? []), r]);
  return f.rows.map((r: any) => {
    const fall = mapFall(r);
    const eigene = (jeFall.get(fall.id) ?? []).map((x) => ({ ...mapPruefung(x), experte1: x.experte1, experte2: x.experte2 }));
    return kubaZeile({
      fallId: fall.id, nachname: r.k_nachname, vorname: r.k_vorname, rolle: fall.rolle ?? r.k_funktion,
      organisationName: r.organisation_name, profil: fall.profil, sprache: fall.sprache, kommunikationssprache: r.k_sprache,
      geburtsdatum: r.k_geburtsdatum,
      zertifikat: r.z_start ? { zertifikatNr: r.z_nr, ausgestelltAm: r.z_start, gueltigBis: r.z_ende } : null,
      uebersicht: uebersicht(fall, eigene), runs: eigene,
    });
  });
}

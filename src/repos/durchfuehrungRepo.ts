import type pg from 'pg';
import type {
  Durchfuehrung, DurchfuehrungDetail, DurchfuehrungStatus, Kurstag, Belegung,
} from '../domain/bildungTypes';
import { AKTIVE_ANMELDESTATUS, berechneBelegung } from '../domain/bildungTypes';
import type { Einsatz } from '../domain/types';
import {
  werktageZwischen, durchfuehrungsCode, naechsteDurchfuehrungsNummer, pruefeDatum, pruefeKurstag,
  pruefeDurchfuehrungsStatus, zeitKurz,
} from '../domain/kursplanung';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, inTransaktion, patchSets, num } from './db';
import { createEinsatz, listEinsaetze, setEinsatzStatus } from './einsatzRepo';
import { enqueue, publiziere } from './outboxRepo';
import { audit } from './auditRepo';

/**
 * Fuehrt fn transaktional aus: mit Pool in einer eigenen Transaktion, mit PoolClient in der Transaktion des Aufrufers
 * (damit z. B. die Integrationsschicht Idempotenz-Eintrag und Fachaenderung gemeinsam committen kann).
 */
export async function mitTransaktion<T>(db: Db, fn: (c: Db) => Promise<T>): Promise<T> {
  if (typeof (db as pg.PoolClient).release === 'function') return fn(db);
  return inTransaktion(db as pg.Pool, fn);
}

const SELECT = `select d.*, k.code as angebot_code, k.titel as angebot_titel
  from durchfuehrung d join kursangebot k on k.id=d.kursangebot_id`;

const mapD = (r: any): Durchfuehrung => ({
  id: r.id, kursangebotId: r.kursangebot_id, kursangebotCode: r.angebot_code, kursangebotTitel: r.angebot_titel,
  projektId: r.projekt_id, code: r.code, titel: r.titel, startDatum: r.start_datum, endDatum: r.end_datum, ort: r.ort,
  kapazitaet: r.kapazitaet, minTeilnehmende: r.min_teilnehmende, anmeldeschluss: r.anmeldeschluss,
  preisChf: num(r.preis_chf), status: r.status, oeffentlich: r.oeffentlich, auftraggeberId: r.auftraggeber_id,
  moodleKursId: r.moodle_kurs_id, leitungId: r.leitung_id,
});

const mapKurstag = (r: any): Kurstag => ({
  id: r.id, durchfuehrungId: r.durchfuehrung_id, datum: r.datum, von: zeitKurz(r.von), bis: zeitKurz(r.bis),
  ort: r.ort, thema: r.thema,
});

export type KurstagInput = { datum: string; von?: string | null; bis?: string | null; ort?: string | null; thema?: string | null };

export type DurchfuehrungInput = {
  kursangebotId: string; startDatum: string; endDatum: string; projektId?: string | null; titel?: string | null;
  ort?: string | null; kapazitaet?: number; minTeilnehmende?: number; anmeldeschluss?: string | null;
  preisChf?: number | null; oeffentlich?: boolean; auftraggeberId?: string | null; moodleKursId?: number | null;
  leitungId?: string | null;
  /** Explizite Kurstage; fehlt die Liste, wird je Werktag zwischen Start und Ende ein Kurstag erzeugt ([] = keine). */
  kurstage?: KurstagInput[];
};

export type DurchfuehrungPatch = Partial<Omit<DurchfuehrungInput, 'kursangebotId' | 'kurstage'>>;

const COLS: Record<string, string> = {
  projektId: 'projekt_id', titel: 'titel', startDatum: 'start_datum', endDatum: 'end_datum', ort: 'ort',
  kapazitaet: 'kapazitaet', minTeilnehmende: 'min_teilnehmende', anmeldeschluss: 'anmeldeschluss', preisChf: 'preis_chf',
  oeffentlich: 'oeffentlich', auftraggeberId: 'auftraggeber_id', moodleKursId: 'moodle_kurs_id', leitungId: 'leitung_id',
};

function pruefeFelder(p: DurchfuehrungPatch): void {
  if (p.startDatum !== undefined) pruefeDatum(p.startDatum, 'startDatum');
  if (p.endDatum !== undefined) pruefeDatum(p.endDatum, 'endDatum');
  if (p.anmeldeschluss !== undefined && p.anmeldeschluss !== null) pruefeDatum(p.anmeldeschluss, 'anmeldeschluss');
  if (p.kapazitaet !== undefined && !(Number.isInteger(p.kapazitaet) && p.kapazitaet > 0)) {
    throw new ValidationError('kapazitaet muss eine ganze Zahl > 0 sein');
  }
  if (p.minTeilnehmende !== undefined && !(Number.isInteger(p.minTeilnehmende) && p.minTeilnehmende >= 0)) {
    throw new ValidationError('minTeilnehmende muss eine ganze Zahl >= 0 sein');
  }
  if (p.preisChf !== undefined && p.preisChf !== null && !(typeof p.preisChf === 'number' && p.preisChf >= 0)) {
    throw new ValidationError('preisChf muss >= 0 sein');
  }
}

function zeitraum(start: string, ende: string): void {
  if (ende < start) throw new ValidationError('endDatum liegt vor startDatum');
}

function kurstagKonflikt(e: any): never {
  if (e?.code === '23505' && String(e.constraint ?? '').startsWith('kurstag')) {
    throw new ConflictError('Kurstag mit gleichem Datum und Beginn existiert bereits');
  }
  throw e;
}

async function insertKurstag(c: Db, durchfuehrungId: string, k: KurstagInput): Promise<Kurstag> {
  const r = await c.query(
    'insert into kurstag(durchfuehrung_id,datum,von,bis,ort,thema) values ($1,$2,$3,$4,$5,$6) returning *',
    [durchfuehrungId, k.datum, k.von ?? null, k.bis ?? null, k.ort ?? null, k.thema ?? null]).catch(kurstagKonflikt);
  return mapKurstag(r.rows[0]);
}

const ereignisKurs = (d: { id: string; kursangebotId: string; code: string | null; status: string }) =>
  ({ durchfuehrungId: d.id, kursangebotId: d.kursangebotId, code: d.code, status: d.status });

// ---------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------

export async function getDurchfuehrungBasis(db: Db, id: string): Promise<Durchfuehrung> {
  const r = await db.query(`${SELECT} where d.id=$1`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Durchfuehrung ${id} nicht gefunden`);
  return mapD(r.rows[0]);
}

/** Durchfuehrung inkl. Angebotsdaten, gesperrt bis Transaktionsende (serialisiert Anmeldungen/Storni/Verrechnung). */
export type GesperrteDurchfuehrung = Durchfuehrung & {
  angebotPreisChf: number | null; lernstunden: number | null; mwstSatz: number; ertragskontoId: string | null;
  angebotOeffentlich: boolean; angebotAktiv: boolean;
};

export async function sperreDurchfuehrung(c: Db, id: string): Promise<GesperrteDurchfuehrung> {
  // "no key update": serialisiert Fachoperationen untereinander, blockiert aber keine FK-Pruefungen (Kurstage etc.).
  const r = await c.query(
    `select d.*, k.code as angebot_code, k.titel as angebot_titel, k.preis_chf as angebot_preis, k.lernstunden,
            k.mwst_satz, k.ertragskonto_id, k.oeffentlich as angebot_oeffentlich, k.aktiv as angebot_aktiv
     from durchfuehrung d join kursangebot k on k.id=d.kursangebot_id where d.id=$1 for no key update of d`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Durchfuehrung ${id} nicht gefunden`);
  const x = r.rows[0];
  return {
    ...mapD(x), angebotPreisChf: num(x.angebot_preis), lernstunden: num(x.lernstunden), mwstSatz: Number(x.mwst_satz),
    ertragskontoId: x.ertragskonto_id, angebotOeffentlich: x.angebot_oeffentlich, angebotAktiv: x.angebot_aktiv,
  };
}

export async function zaehleBelegung(db: Db, durchfuehrungId: string, kapazitaet: number): Promise<Belegung> {
  const r = await db.query(
    `select count(*) filter (where status = any($2))::int as aktiv, count(*) filter (where status='warteliste')::int as warteliste
     from anmeldung where durchfuehrung_id=$1`, [durchfuehrungId, AKTIVE_ANMELDESTATUS]);
  return berechneBelegung(kapazitaet, r.rows[0].aktiv, r.rows[0].warteliste);
}

export async function listKurstage(db: Db, durchfuehrungId: string): Promise<Kurstag[]> {
  const r = await db.query('select * from kurstag where durchfuehrung_id=$1 order by datum, von nulls first', [durchfuehrungId]);
  return r.rows.map(mapKurstag);
}

async function einsaetzeDerKurstage(db: Db, kurstage: Kurstag[]): Promise<Einsatz[]> {
  const alle: Einsatz[] = [];
  for (const k of kurstage) alle.push(...await listEinsaetze(db, { kurstagId: k.id }));
  return alle;
}

/** Durchfuehrung inkl. Kurstage, Einsaetze und Belegung. */
export async function getDurchfuehrung(db: Db, id: string): Promise<DurchfuehrungDetail> {
  const d = await getDurchfuehrungBasis(db, id);
  const kurstage = await listKurstage(db, id);
  return { ...d, kurstage, einsaetze: await einsaetzeDerKurstage(db, kurstage), belegung: await zaehleBelegung(db, id, d.kapazitaet) };
}

export async function listDurchfuehrungen(db: Db, filter: { kursangebotId?: string; von?: string; bis?: string; status?: string } = {}): Promise<(Durchfuehrung & { belegung: Belegung })[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.kursangebotId) add('d.kursangebot_id=?', filter.kursangebotId);
  if (filter.von) add('d.start_datum>=?', pruefeDatum(filter.von, 'von'));
  if (filter.bis) add('d.start_datum<=?', pruefeDatum(filter.bis, 'bis'));
  if (filter.status) add('d.status = any(?)', filter.status.split(',').map((s) => s.trim()));
  args.push(AKTIVE_ANMELDESTATUS);
  const r = await db.query(
    `select x.*,
       (select count(*) from anmeldung a where a.durchfuehrung_id=x.id and a.status = any($${args.length}))::int as n_aktiv,
       (select count(*) from anmeldung a where a.durchfuehrung_id=x.id and a.status='warteliste')::int as n_warteliste
     from (${SELECT} ${cond.length ? 'where ' + cond.join(' and ') : ''}) x
     order by x.start_datum, x.code`, args);
  return r.rows.map((x: any) => ({ ...mapD(x), belegung: berechneBelegung(x.kapazitaet, x.n_aktiv, x.n_warteliste) }));
}

// ---------------------------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------------------------

export async function createDurchfuehrung(db: Db, input: DurchfuehrungInput): Promise<DurchfuehrungDetail> {
  if (!input.kursangebotId) throw new ValidationError('kursangebotId ist Pflicht');
  pruefeDatum(input.startDatum, 'startDatum');
  pruefeDatum(input.endDatum, 'endDatum');
  pruefeFelder(input);
  zeitraum(input.startDatum, input.endDatum);
  if (input.kurstage !== undefined && !Array.isArray(input.kurstage)) throw new ValidationError('kurstage muss eine Liste sein');
  const kurstage: KurstagInput[] = input.kurstage
    ? input.kurstage.map((k) => pruefeKurstag(k, input.startDatum, input.endDatum))
    : werktageZwischen(input.startDatum, input.endDatum).map((datum) => ({ datum }));

  return mitTransaktion(db, async (c) => {
    // Angebot sperren: serialisiert die Nummernvergabe {ANGEBOT}-{JAHR}-{n} bei parallelen Anlagen.
    const a = await c.query('select code from kursangebot where id=$1 for no key update', [input.kursangebotId]);
    if (!a.rowCount) throw new NotFoundError(`Kursangebot ${input.kursangebotId} nicht gefunden`);
    const jahr = Number(input.startDatum.slice(0, 4));
    // Ueber alle Angebote suchen: ein frueher umbenanntes Angebot kann Codes mit demselben Praefix hinterlassen haben.
    const praefix = `${a.rows[0].code}-${jahr}-`;
    const codes = await c.query('select code from durchfuehrung where left(code, length($1)) = $1', [praefix]);
    const code = durchfuehrungsCode(a.rows[0].code, jahr,
      naechsteDurchfuehrungsNummer(codes.rows.map((x: any) => x.code), a.rows[0].code, jahr));
    const r = await c.query(
      `insert into durchfuehrung(kursangebot_id,projekt_id,code,titel,start_datum,end_datum,ort,kapazitaet,min_teilnehmende,
         anmeldeschluss,preis_chf,oeffentlich,auftraggeber_id,moodle_kurs_id,leitung_id)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,16),coalesce($9,1),$10,$11,coalesce($12,true),$13,$14,$15) returning id`,
      [input.kursangebotId, input.projektId ?? null, code, input.titel ?? null, input.startDatum, input.endDatum,
       input.ort ?? null, input.kapazitaet ?? null, input.minTeilnehmende ?? null, input.anmeldeschluss ?? null,
       input.preisChf ?? null, input.oeffentlich ?? null, input.auftraggeberId ?? null, input.moodleKursId ?? null,
       input.leitungId ?? null]);
    const id: string = r.rows[0].id;
    for (const k of kurstage) await insertKurstag(c, id, k);
    return getDurchfuehrung(c, id);
  });
}

/**
 * Stammdaten aendern. Mehr Kapazitaet laesst die Warteliste nachruecken; eine neu gesetzte Moodle-Kurs-ID macht
 * bestehende Anmeldungen Moodle-relevant (bestaetigte werden eingeschrieben).
 */
export async function updateDurchfuehrung(db: Db, id: string, patch: DurchfuehrungPatch): Promise<DurchfuehrungDetail> {
  pruefeFelder(patch);
  return mitTransaktion(db, async (c) => {
    const alt = await sperreDurchfuehrung(c, id);
    zeitraum(patch.startDatum ?? alt.startDatum, patch.endDatum ?? alt.endDatum);
    const args: unknown[] = [id];
    const sets = patchSets(patch as Record<string, unknown>, COLS, args);
    if (!sets.length) return getDurchfuehrung(c, id);
    sets.push('geaendert_am=now()');
    await c.query(`update durchfuehrung set ${sets.join(',')} where id=$1`, args);
    if (patch.kapazitaet !== undefined) await rueckeNach(c, id, patch.kapazitaet);
    if (patch.moodleKursId && patch.moodleKursId !== alt.moodleKursId) {
      const r = await c.query(
        `update anmeldung set moodle_status='ausstehend' where durchfuehrung_id=$1 and moodle_status='nicht_relevant'
         and status <> 'storniert' returning id, status`, [id]);
      for (const a of r.rows) if (a.status === 'bestaetigt') await enqueue(c, 'moodle.einschreiben', a.id, { anmeldungId: a.id });
    }
    const neu = await getDurchfuehrung(c, id);
    await publiziere(c, 'kurs.aktualisiert', ereignisKurs(neu));
    return neu;
  });
}

/**
 * Statuswechsel (geplant -> ausgeschrieben -> bestaetigt -> durchgefuehrt, nicht-final -> abgesagt).
 * Absage: alle nicht stornierten Anmeldungen gebuehrenfrei stornieren (+ Moodle-Ausschreibung) und
 * Referenten-Einsaetze der Kurstage absagen (gibt die Tage frei).
 */
export async function setDurchfuehrungStatus(db: Db, id: string, status: DurchfuehrungStatus, benutzer: string | null = null): Promise<DurchfuehrungDetail> {
  return mitTransaktion(db, async (c) => {
    const d = await sperreDurchfuehrung(c, id);
    const kurstage = await listKurstage(c, id);
    pruefeDurchfuehrungsStatus(d.status, status, kurstage.length);
    await c.query('update durchfuehrung set status=$2, geaendert_am=now() where id=$1', [id, status]);
    let storniert = 0;
    if (status === 'abgesagt') {
      storniert = await storniereWegenAbsage(c, id);
      for (const e of await einsaetzeDerKurstage(c, kurstage)) {
        if (e.status === 'angefragt' || e.status === 'bestaetigt') await setEinsatzStatus(c, e.id, 'abgesagt');
      }
    }
    await audit(c, { benutzer, aktion: 'statuswechsel', entitaet: 'durchfuehrung', entitaetId: id,
      details: { von: d.status, nach: status, ...(status === 'abgesagt' ? { stornierteAnmeldungen: storniert } : {}) } });
    await publiziere(c, 'kurs.aktualisiert', ereignisKurs({ ...d, status }));
    return getDurchfuehrung(c, id);
  });
}

export async function addKurstag(db: Db, durchfuehrungId: string, input: KurstagInput): Promise<Kurstag> {
  return mitTransaktion(db, async (c) => {
    const d = await sperreDurchfuehrung(c, durchfuehrungId);
    const k = await insertKurstag(c, durchfuehrungId, pruefeKurstag(input ?? ({} as KurstagInput), d.startDatum, d.endDatum));
    await publiziere(c, 'kurs.aktualisiert', ereignisKurs(d));
    return k;
  });
}

/** Loescht einen Kurstag (Einsaetze daran werden mitgeloescht). Eine Ausschreibung behaelt mindestens einen Kurstag. */
export async function deleteKurstag(db: Db, kurstagId: string): Promise<void> {
  await mitTransaktion(db, async (c) => {
    const k = await c.query('select durchfuehrung_id from kurstag where id=$1', [kurstagId]);
    if (!k.rowCount) throw new NotFoundError(`Kurstag ${kurstagId} nicht gefunden`);
    const d = await sperreDurchfuehrung(c, k.rows[0].durchfuehrung_id);
    const n = (await listKurstage(c, d.id)).length;
    if (n <= 1 && (d.status === 'ausgeschrieben' || d.status === 'bestaetigt')) {
      throw new ConflictError('Eine ausgeschriebene Durchfuehrung braucht mindestens einen Kurstag');
    }
    await c.query('delete from kurstag where id=$1', [kurstagId]);
    await publiziere(c, 'kurs.aktualisiert', ereignisKurs(d));
  });
}

/** Referent:in an einem Kurstag einplanen: Einsatz im Projekt der Durchfuehrung (Ueberbuchungsschutz -> 409). */
export async function referentZuweisen(db: Db, kurstagId: string, input: {
  referentId: string; dauerTage?: number; rolle?: string; honorarChf?: number | null; bemerkung?: string | null;
}): Promise<Einsatz> {
  if (!input?.referentId) throw new ValidationError('referentId ist Pflicht');
  const r = await db.query(
    'select k.datum, d.projekt_id, d.code from kurstag k join durchfuehrung d on d.id=k.durchfuehrung_id where k.id=$1', [kurstagId]);
  if (!r.rowCount) throw new NotFoundError(`Kurstag ${kurstagId} nicht gefunden`);
  const { datum, projekt_id: projektId, code } = r.rows[0];
  if (!projektId) throw new ValidationError(`Durchfuehrung ${code} hat kein Projekt (Kostentraeger) fuer den Einsatz`);
  return createEinsatz(db, {
    referentId: input.referentId, projektId, datum, kurstagId, dauerTage: input.dauerTage, rolle: input.rolle,
    honorarChf: input.honorarChf, bemerkung: input.bemerkung,
  });
}

// ---------------------------------------------------------------------------------------------
// Kapazitaet / Warteliste (in der Transaktion des Aufrufers, Durchfuehrung bereits gesperrt)
// ---------------------------------------------------------------------------------------------

/** Wartelistenpositionen lueckenlos 1..n in bisheriger Reihenfolge. */
export async function nummeriereWarteliste(c: Db, durchfuehrungId: string): Promise<void> {
  await c.query(
    `update anmeldung a set wartelisten_position = x.rn
     from (select id, row_number() over (order by wartelisten_position nulls last, angemeldet_am, id)::int as rn
           from anmeldung where durchfuehrung_id=$1 and status='warteliste') x
     where a.id = x.id and a.wartelisten_position is distinct from x.rn`, [durchfuehrungId]);
}

/** Fuellt freie Plaetze aus der Warteliste (Status angemeldet) und nummeriert den Rest neu. Gibt die Nachgerueckten zurueck. */
export async function rueckeNach(c: Db, durchfuehrungId: string, kapazitaet: number): Promise<string[]> {
  const b = await zaehleBelegung(c, durchfuehrungId, kapazitaet);
  let ids: string[] = [];
  if (b.frei > 0 && b.warteliste > 0) {
    const r = await c.query(
      `update anmeldung set status='angemeldet', wartelisten_position=null
       where id in (select id from anmeldung where durchfuehrung_id=$1 and status='warteliste'
                    order by wartelisten_position nulls last, angemeldet_am, id limit $2)
       returning id`, [durchfuehrungId, b.frei]);
    ids = r.rows.map((x: any) => x.id);
    for (const anmeldungId of ids) await publiziere(c, 'anmeldung.nachgerueckt', { anmeldungId, durchfuehrungId });
  }
  await nummeriereWarteliste(c, durchfuehrungId);
  return ids;
}

const STORNO_ABSAGE = 'Durchfuehrung abgesagt';

/** Absage-Kaskade: alle nicht stornierten Anmeldungen gebuehrenfrei stornieren, Moodle ausschreiben, Ereignisse. */
async function storniereWegenAbsage(c: Db, durchfuehrungId: string): Promise<number> {
  const r = await c.query(
    `update anmeldung set status='storniert', storniert_am=now(), stornogrund=$2, stornogebuehr_chf=0, wartelisten_position=null
     where durchfuehrung_id=$1 and status <> 'storniert' returning id, moodle_status`, [durchfuehrungId, STORNO_ABSAGE]);
  for (const a of r.rows) {
    if (a.moodle_status === 'eingeschrieben') await enqueue(c, 'moodle.ausschreiben', a.id, { anmeldungId: a.id });
    await publiziere(c, 'anmeldung.storniert', { anmeldungId: a.id, durchfuehrungId, grund: STORNO_ABSAGE });
  }
  return r.rowCount ?? 0;
}

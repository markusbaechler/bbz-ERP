import type pg from 'pg';
import type { Anmeldung, Lernnachweis, TeilnahmeStatus } from '../domain/bildungTypes';
import { ANMELDUNG_OFFEN, STORNIERBAR, pruefeTeilnahmeStatus } from '../domain/bildungTypes';
import type { Kontakt } from '../domain/types';
import { annullationsgebuehr } from '../domain/annullation';
import { staffelFuer } from '../config/bildung';
import { heuteIso, pruefeDatum, datumInZuerich } from '../domain/kursplanung';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, patchSets, num } from './db';
import { findOrCreateKontaktByEmail, getKontakt } from './kontaktRepo';
import { enqueue, publiziere } from './outboxRepo';
import { audit } from './auditRepo';
import {
  mitTransaktion, sperreDurchfuehrung, zaehleBelegung, rueckeNach, getDurchfuehrungBasis, type GesperrteDurchfuehrung,
} from './durchfuehrungRepo';
import { lernnachweisFuerAnmeldung } from './lernnachweisRepo';

const zeit = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export const mapAnmeldung = (r: any): Anmeldung => ({
  id: r.id, durchfuehrungId: r.durchfuehrung_id, kontaktId: r.kontakt_id, rechnungsempfaengerId: r.rechnungsempfaenger_id,
  status: r.status, quelle: r.quelle, angemeldetAm: zeit(r.angemeldet_am)!, bestaetigtAm: zeit(r.bestaetigt_am),
  storniertAm: zeit(r.storniert_am), stornogrund: r.stornogrund, preisChf: num(r.preis_chf),
  stornogebuehrChf: num(r.stornogebuehr_chf), wartelistenPosition: r.wartelisten_position,
  rechnungsreferenz: r.rechnungsreferenz, bemerkung: r.bemerkung, rechnungId: r.rechnung_id, moodleStatus: r.moodle_status,
  moodleFehler: r.moodle_fehler, abgeschlossenAm: zeit(r.abgeschlossen_am),
});

/** Person zur Anmeldung: bestehender Kontakt (kontaktId) oder Angaben mit E-Mail (Dublettenschutz ueber E-Mail). */
export type KontaktReferenz = {
  kontaktId?: string;
  kontakt?: {
    email: string; nachname?: string; vorname?: string | null; anrede?: Kontakt['anrede']; funktion?: string | null;
    telefon?: string | null; organisationId?: string | null;
  };
};

export type MeldeAnInput = KontaktReferenz & {
  rechnungsempfaengerId?: string | null; rechnungsreferenz?: string | null; bemerkung?: string | null;
  quelle?: 'manuell' | 'homepage' | 'import' | 'moodle'; idempotenzSchluessel?: string | null;
};

export type MeldeAnErgebnis = { anmeldung: Anmeldung; warteliste: boolean; kontaktNeu: boolean };

const QUELLEN = ['manuell', 'homepage', 'import', 'moodle'];
const istClient = (db: Db): boolean => typeof (db as pg.PoolClient).release === 'function';

async function ermittleKontakt(c: Db, ref: KontaktReferenz): Promise<{ kontakt: Kontakt; neu: boolean }> {
  if (ref.kontaktId) return { kontakt: await getKontakt(c, ref.kontaktId), neu: false };
  const k = ref.kontakt;
  if (!k) throw new ValidationError('kontaktId oder kontakt ist Pflicht');
  if (!k.email?.trim()) throw new ValidationError('kontakt.email ist Pflicht');
  return findOrCreateKontaktByEmail(c, {
    email: k.email, nachname: k.nachname ?? '', vorname: k.vorname ?? null, anrede: k.anrede ?? null,
    funktion: k.funktion ?? null, telefon: k.telefon ?? null, organisationId: k.organisationId ?? null,
  });
}

/** Doppelanmeldung derselben Person (409 intern; die Homepage antwortet neutral, um kein Teilnahme-Orakel zu bieten). */
export class DoppelanmeldungError extends ConflictError {}

async function pruefeKeineDoppelanmeldung(c: Db, durchfuehrungId: string, kontaktId: string): Promise<void> {
  const r = await c.query(
    `select 1 from anmeldung where durchfuehrung_id=$1 and kontakt_id=$2 and status <> 'storniert'`, [durchfuehrungId, kontaktId]);
  if (r.rowCount) throw new DoppelanmeldungError('Diese Person ist fuer die Durchfuehrung bereits angemeldet');
}

/** Rechnungsempfaenger-Default: bestellende Bank (Firmenkurs), sonst Debitor der Organisation des Kontakts. */
async function standardEmpfaenger(c: Db, d: GesperrteDurchfuehrung, kontakt: Kontakt): Promise<string | null> {
  if (d.auftraggeberId) return d.auftraggeberId;
  if (!kontakt.organisationId) return null;
  const r = await c.query('select id from auftraggeber where organisation_id=$1 and aktiv', [kontakt.organisationId]);
  return r.rows[0]?.id ?? null;
}

async function wiederholung(db: Db, schluessel: string, durchfuehrungId: string): Promise<MeldeAnErgebnis | null> {
  const r = await db.query('select * from anmeldung where idempotenz_schluessel=$1', [schluessel]);
  if (!r.rowCount) return null;
  const anmeldung = mapAnmeldung(r.rows[0]);
  if (anmeldung.durchfuehrungId !== durchfuehrungId) {
    throw new ConflictError('Idempotenz-Schluessel wurde bereits fuer eine andere Durchfuehrung verwendet');
  }
  return { anmeldung, warteliste: anmeldung.status === 'warteliste', kontaktNeu: false };
}

type NeueAnmeldung = {
  durchfuehrungId: string; kontaktId: string; rechnungsempfaengerId: string | null; status: Anmeldung['status'];
  quelle: string; preisChf: number | null; wartelistenPosition: number | null; rechnungsreferenz: string | null;
  bemerkung: string | null; moodleStatus: Anmeldung['moodleStatus']; idempotenzSchluessel?: string | null;
};

async function insertAnmeldung(c: Db, a: NeueAnmeldung): Promise<Anmeldung> {
  const r = await c.query(
    `insert into anmeldung(durchfuehrung_id,kontakt_id,rechnungsempfaenger_id,status,quelle,preis_chf,wartelisten_position,
       rechnungsreferenz,bemerkung,moodle_status,idempotenz_schluessel,bestaetigt_am)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $4='bestaetigt' then now() end) returning *`,
    [a.durchfuehrungId, a.kontaktId, a.rechnungsempfaengerId, a.status, a.quelle, a.preisChf, a.wartelistenPosition,
     a.rechnungsreferenz, a.bemerkung, a.moodleStatus, a.idempotenzSchluessel ?? null]);
  return mapAnmeldung(r.rows[0]);
}

/**
 * Anmeldung zu einer Durchfuehrung (intern und Homepage). In EINER Transaktion mit Zeilensperre auf der Durchfuehrung,
 * damit parallele Anmeldungen nie ueberbuchen: Status/Anmeldeschluss pruefen, Kontakt per E-Mail finden oder anlegen,
 * Doppelanmeldung 409, Preis-Snapshot, bei voller Durchfuehrung Warteliste (naechste Position), Webhook-Ereignis.
 * Ein bereits verwendeter Idempotenz-Schluessel liefert die bestehende Anmeldung zurueck.
 * Mit PoolClient laeuft die Anmeldung in der Transaktion des Aufrufers.
 */
export async function meldeAn(db: Db, durchfuehrungId: string, input: MeldeAnInput, opt: { heute?: string } = {}): Promise<MeldeAnErgebnis> {
  const quelle = input?.quelle ?? 'manuell';
  if (!QUELLEN.includes(quelle)) throw new ValidationError(`quelle muss ${QUELLEN.join('/')} sein`);
  const schluessel = input.idempotenzSchluessel?.trim() || null;
  if (schluessel) {
    const w = await wiederholung(db, schluessel, durchfuehrungId);
    if (w) return w;
  }
  try {
    return await mitTransaktion(db, async (c) => {
      const d = await sperreDurchfuehrung(c, durchfuehrungId);
      if (schluessel) {
        const w = await wiederholung(c, schluessel, durchfuehrungId);   // parallele Wiederholung wartete auf die Sperre
        if (w) return w;
      }
      if (quelle === 'homepage' && !(d.oeffentlich && d.angebotOeffentlich && d.angebotAktiv)) {
        throw new NotFoundError(`Durchfuehrung ${durchfuehrungId} nicht gefunden`);
      }
      // Geplant: nur intern (manuell) und aus Moodle, dem Buchungskanal der Kurse; Homepage erst ab ausgeschrieben.
      const offen = ANMELDUNG_OFFEN.includes(d.status) || (d.status === 'geplant' && (quelle === 'manuell' || quelle === 'moodle'));
      if (!offen) throw new ConflictError(`Durchfuehrung ${d.code} nimmt keine Anmeldungen an (Status ${d.status})`);
      if (quelle === 'homepage') {
        const frist = d.anmeldeschluss ?? d.startDatum;
        if ((opt.heute ?? heuteIso()) > frist) throw new ConflictError(`Anmeldeschluss ${frist} ist vorbei`);
      }
      const { kontakt, neu } = await ermittleKontakt(c, input);
      await pruefeKeineDoppelanmeldung(c, d.id, kontakt.id);

      const belegung = await zaehleBelegung(c, d.id, d.kapazitaet);
      const warteliste = belegung.aktiv >= d.kapazitaet;
      const position = warteliste
        ? (await c.query(`select coalesce(max(wartelisten_position),0)+1 as p from anmeldung where durchfuehrung_id=$1 and status='warteliste'`, [d.id])).rows[0].p
        : null;
      const anmeldung = await insertAnmeldung(c, {
        durchfuehrungId: d.id, kontaktId: kontakt.id,
        rechnungsempfaengerId: input.rechnungsempfaengerId ?? await standardEmpfaenger(c, d, kontakt),
        status: warteliste ? 'warteliste' : 'angemeldet', quelle, preisChf: d.preisChf ?? d.angebotPreisChf,
        wartelistenPosition: position, rechnungsreferenz: input.rechnungsreferenz ?? null, bemerkung: input.bemerkung ?? null,
        moodleStatus: d.moodleKursId === null ? 'nicht_relevant' : 'ausstehend', idempotenzSchluessel: schluessel,
      });
      // Webhook nur mit IDs (keine Personendaten, nDSG)
      await publiziere(c, 'anmeldung.eingegangen', { anmeldungId: anmeldung.id, durchfuehrungId: d.id, status: anmeldung.status, quelle });
      return { anmeldung, warteliste, kontaktNeu: neu };
    });
  } catch (e: any) {
    // Gleicher Schluessel parallel auf anderer Durchfuehrung o. ae.: nach Rollback die bestehende Anmeldung liefern.
    if (schluessel && !istClient(db) && e?.code === '23505' && String(e.constraint ?? '').includes('idempotenz')) {
      const w = await wiederholung(db, schluessel, durchfuehrungId);
      if (w) return w;
    }
    if (e?.code === '23505' && e.constraint === 'anmeldung_aktiv_uq') {
      throw new DoppelanmeldungError('Diese Person ist fuer die Durchfuehrung bereits angemeldet');
    }
    throw e;
  }
}

async function sperreAnmeldung(c: Db, id: string): Promise<any> {
  const r = await c.query(
    `select a.*, d.moodle_kurs_id, d.code as d_code, d.titel as d_titel, k.titel as k_titel, k.lernstunden
     from anmeldung a join durchfuehrung d on d.id=a.durchfuehrung_id join kursangebot k on k.id=d.kursangebot_id
     where a.id=$1 for update of a`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Anmeldung ${id} nicht gefunden`);
  return r.rows[0];
}

export async function getAnmeldung(db: Db, id: string): Promise<Anmeldung> {
  const r = await db.query('select * from anmeldung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Anmeldung ${id} nicht gefunden`);
  return mapAnmeldung(r.rows[0]);
}

/** Bestaetigung (nur aus angemeldet); mit Moodle-Kurs Outbox `moodle.einschreiben`. Warteliste -> 409. */
export async function bestaetigeAnmeldung(db: Db, id: string, benutzer: string | null = null): Promise<Anmeldung> {
  return mitTransaktion(db, async (c) => {
    const a = await sperreAnmeldung(c, id);
    if (a.status === 'warteliste') throw new ConflictError('Eine Anmeldung auf der Warteliste kann nicht direkt bestaetigt werden');
    if (a.status !== 'angemeldet') throw new ConflictError(`Bestaetigung nur aus Status angemeldet (Status ${a.status})`);
    const moodle = a.moodle_kurs_id !== null && a.moodle_status !== 'eingeschrieben';
    await c.query(
      `update anmeldung set status='bestaetigt', bestaetigt_am=now(),
         moodle_status = case when $2 then 'ausstehend' else moodle_status end, moodle_fehler = case when $2 then null else moodle_fehler end
       where id=$1`, [id, moodle]);
    if (moodle) await enqueue(c, 'moodle.einschreiben', id, { anmeldungId: id });
    await publiziere(c, 'anmeldung.bestaetigt', { anmeldungId: id, durchfuehrungId: a.durchfuehrung_id });
    await audit(c, { benutzer, aktion: 'bestaetigt', entitaet: 'anmeldung', entitaetId: id });
    return getAnmeldung(c, id);
  });
}

export type StornoInput = {
  grund: string;
  /** Eingang der Abmeldung (Default heute), massgebend fuer die Annullationskosten. */
  datum?: string;
  /** Manuelle Gebuehr (Kulanz), uebersteuert die Staffel. */
  stornogebuehrChf?: number;
  /** Ersatzperson uebernimmt den Platz kostenlos (AGB). */
  ersatzKontakt?: KontaktReferenz;
};

export type StornoErgebnis = { anmeldung: Anmeldung; nachgerueckt: Anmeldung[]; ersatz: Anmeldung | null };

/**
 * Storno mit Annullationskosten nach Tagen vor Kursbeginn (Warteliste gebuehrenfrei). Freie Plaetze werden aus der
 * Warteliste nachbesetzt, der Rest neu nummeriert. Eingeschriebene erhalten `moodle.ausschreiben`.
 * Mit Ersatzperson: gebuehrenfrei, die Ersatzperson uebernimmt Status, Preis und Rechnungsempfaenger (kein Nachruecken).
 */
export async function storniereAnmeldung(db: Db, id: string, input: StornoInput, benutzer: string | null = null): Promise<StornoErgebnis> {
  if (!input?.grund?.trim()) throw new ValidationError('grund ist Pflicht');
  const datum = input.datum !== undefined ? pruefeDatum(input.datum, 'datum') : heuteIso();
  if (input.stornogebuehrChf !== undefined && !(typeof input.stornogebuehrChf === 'number' && input.stornogebuehrChf >= 0)) {
    throw new ValidationError('stornogebuehrChf muss >= 0 sein');
  }
  return mitTransaktion(db, async (c) => {
    const vorab = await c.query('select durchfuehrung_id from anmeldung where id=$1', [id]);
    if (!vorab.rowCount) throw new NotFoundError(`Anmeldung ${id} nicht gefunden`);
    // Sperrreihenfolge wie meldeAn: zuerst Durchfuehrung, dann Anmeldung (keine Deadlocks).
    const d = await sperreDurchfuehrung(c, vorab.rows[0].durchfuehrung_id);
    const a = await sperreAnmeldung(c, id);
    if (!STORNIERBAR.includes(a.status)) throw new ConflictError(`Storno aus Status ${a.status} nicht moeglich`);

    let ersatzKontakt: Kontakt | null = null;
    if (input.ersatzKontakt) {
      if (a.status !== 'angemeldet' && a.status !== 'bestaetigt') throw new ConflictError('Ersatzperson nur fuer Anmeldungen mit Platz');
      ersatzKontakt = (await ermittleKontakt(c, input.ersatzKontakt)).kontakt;
      await pruefeKeineDoppelanmeldung(c, d.id, ersatzKontakt.id);
    }
    const gebuehr = input.stornogebuehrChf
      ?? (ersatzKontakt || a.status === 'warteliste' ? 0 : annullationsgebuehr(num(a.preis_chf), d.startDatum, datum, staffelFuer(d.annullationsregel)).gebuehrChf);
    await c.query(
      `update anmeldung set status='storniert', storniert_am=now(), stornogrund=$2, stornogebuehr_chf=$3, wartelisten_position=null
       where id=$1`, [id, input.grund.trim(), gebuehr]);
    if (a.moodle_status === 'eingeschrieben') await enqueue(c, 'moodle.ausschreiben', id, { anmeldungId: id });

    let ersatz: Anmeldung | null = null;
    if (ersatzKontakt) {
      ersatz = await insertAnmeldung(c, {
        durchfuehrungId: d.id, kontaktId: ersatzKontakt.id, rechnungsempfaengerId: a.rechnungsempfaenger_id, status: a.status,
        quelle: 'manuell', preisChf: num(a.preis_chf), wartelistenPosition: null, rechnungsreferenz: a.rechnungsreferenz,
        bemerkung: `Ersatz fuer Anmeldung ${id}`, moodleStatus: d.moodleKursId === null ? 'nicht_relevant' : 'ausstehend',
      });
      if (ersatz.status === 'bestaetigt' && d.moodleKursId !== null) await enqueue(c, 'moodle.einschreiben', ersatz.id, { anmeldungId: ersatz.id });
      await publiziere(c, 'anmeldung.eingegangen', { anmeldungId: ersatz.id, durchfuehrungId: d.id, status: ersatz.status, quelle: 'manuell' });
    }
    await publiziere(c, 'anmeldung.storniert', { anmeldungId: id, durchfuehrungId: d.id, ersatzAnmeldungId: ersatz?.id ?? null });
    const nachIds = ersatz ? [] : await rueckeNach(c, d.id, d.kapazitaet);
    await audit(c, { benutzer, aktion: 'storno', entitaet: 'anmeldung', entitaetId: id,
      details: { grund: input.grund.trim(), datum, gebuehrChf: gebuehr, ersatzAnmeldungId: ersatz?.id ?? null, nachgerueckt: nachIds } });
    const nachgerueckt: Anmeldung[] = [];
    for (const n of nachIds) nachgerueckt.push(await getAnmeldung(c, n));
    return { anmeldung: await getAnmeldung(c, id), nachgerueckt, ersatz };
  });
}

export type AbschlussErgebnis = { anmeldung: Anmeldung; lernnachweis: Lernnachweis; geaendert: boolean };

/**
 * Kursabschluss (Moodle-Sync oder manuell): Status abgeschlossen + genau ein Lernnachweis mit den Lernstunden des
 * Angebots. Idempotent: ein erneuter Aufruf aendert nichts und liefert den bestehenden Nachweis.
 */
export async function markiereAbgeschlossen(
  db: Db, anmeldungId: string, zeitpunkt: Date | string, quelle: 'moodle' | 'manuell', benutzer: string | null = null,
): Promise<AbschlussErgebnis> {
  const zp = zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt);
  if (Number.isNaN(zp.getTime())) throw new ValidationError('zeitpunkt ist ungueltig');
  if (quelle !== 'moodle' && quelle !== 'manuell') throw new ValidationError('quelle muss moodle oder manuell sein');
  return mitTransaktion(db, async (c) => {
    const a = await sperreAnmeldung(c, anmeldungId);
    pruefeTeilnahmeStatus(a.status, 'abgeschlossen');
    const geaendert = a.status !== 'abgeschlossen';
    if (geaendert) {
      await c.query(`update anmeldung set status='abgeschlossen', abgeschlossen_am=$2 where id=$1`, [anmeldungId, zp]);
      await audit(c, { benutzer, aktion: 'abschluss', entitaet: 'anmeldung', entitaetId: anmeldungId, details: { quelle } });
    }
    const lernnachweis = await lernnachweisFuerAnmeldung(c, {
      kontaktId: a.kontakt_id, anmeldungId, datum: datumInZuerich(a.abgeschlossen_am ?? zp),
      titel: `${a.d_titel ?? a.k_titel} (${a.d_code})`, lernstunden: num(a.lernstunden) ?? 0,
      quelle: quelle === 'moodle' ? 'moodle' : 'kurs',
    });
    return { anmeldung: await getAnmeldung(c, anmeldungId), lernnachweis, geaendert };
  });
}

/** Teilnahme setzen: teilgenommen / abgeschlossen (-> Lernnachweis) / nicht_bestanden. */
export async function setzeTeilnahme(db: Db, id: string, status: TeilnahmeStatus, benutzer: string | null = null): Promise<Anmeldung> {
  if (status === 'abgeschlossen') return (await markiereAbgeschlossen(db, id, new Date(), 'manuell', benutzer)).anmeldung;
  return mitTransaktion(db, async (c) => {
    const a = await sperreAnmeldung(c, id);
    pruefeTeilnahmeStatus(a.status, status);
    if (a.status !== status) {
      await c.query('update anmeldung set status=$2 where id=$1', [id, status]);
      await audit(c, { benutzer, aktion: 'teilnahme', entitaet: 'anmeldung', entitaetId: id, details: { von: a.status, nach: status } });
    }
    return getAnmeldung(c, id);
  });
}

const PATCH_COLS: Record<string, string> = {
  rechnungsempfaengerId: 'rechnungsempfaenger_id', rechnungsreferenz: 'rechnungsreferenz', bemerkung: 'bemerkung',
};

/** Verrechnungsangaben nachtragen (z. B. vor dem Verrechnungslauf); nach Verrechnung ist der Empfaenger gesperrt. */
export async function updateAnmeldung(db: Db, id: string, patch: { rechnungsempfaengerId?: string | null; rechnungsreferenz?: string | null; bemerkung?: string | null }): Promise<Anmeldung> {
  const alt = await getAnmeldung(db, id);
  if (alt.rechnungId && patch && 'rechnungsempfaengerId' in patch && patch.rechnungsempfaengerId !== alt.rechnungsempfaengerId) {
    throw new ConflictError('Anmeldung ist bereits verrechnet; Rechnungsempfaenger kann nicht mehr geaendert werden');
  }
  const args: unknown[] = [id];
  const sets = patchSets((patch ?? {}) as Record<string, unknown>, PATCH_COLS, args);
  if (!sets.length) return alt;
  const r = await db.query(`update anmeldung set ${sets.join(',')} where id=$1 returning *`, args);
  return mapAnmeldung(r.rows[0]);
}

export type AnmeldungListenZeile = Anmeldung & {
  kontaktName: string; durchfuehrungCode: string | null; durchfuehrungTitel: string | null; startDatum: string;
};

/** organisationId: Anmeldungen der Mitarbeitenden eines Instituts ueber alle Kurse (FileMaker "Liste nach Institut"). */
export async function listAnmeldungen(db: Db, filter: { durchfuehrungId?: string; kontaktId?: string; status?: string; organisationId?: string } = {}): Promise<AnmeldungListenZeile[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.durchfuehrungId) add('a.durchfuehrung_id=?', filter.durchfuehrungId);
  if (filter.kontaktId) add('a.kontakt_id=?', filter.kontaktId);
  if (filter.status) add('a.status = any(?)', filter.status.split(',').map((s) => s.trim()));
  if (filter.organisationId) add('k.organisation_id=?', filter.organisationId);
  const r = await db.query(
    `select a.*, k.vorname as kontakt_vorname, k.nachname as kontakt_nachname, d.code as d_code, d.titel as d_titel, d.start_datum as d_start
     from anmeldung a join kontakt k on k.id=a.kontakt_id join durchfuehrung d on d.id=a.durchfuehrung_id
     ${cond.length ? 'where ' + cond.join(' and ') : ''} order by a.angemeldet_am, a.id`, args);
  return r.rows.map((x: any) => ({
    ...mapAnmeldung(x), kontaktName: [x.kontakt_vorname, x.kontakt_nachname].filter(Boolean).join(' '),
    durchfuehrungCode: x.d_code, durchfuehrungTitel: x.d_titel, startDatum: x.d_start,
  }));
}

export type TeilnehmerZeile = {
  anmeldungId: string; status: Anmeldung['status']; wartelistenPosition: number | null; anrede: string | null;
  vorname: string | null; nachname: string; email: string | null; telefon: string | null; funktion: string | null;
  organisation: string | null; rechnungsempfaenger: string | null; rechnungsreferenz: string | null; bemerkung: string | null;
  /** Postadresse der Organisation – fuer Etiketten, Namensschilder und Ordneretiketten (Serienbrief/Avery aus der CSV) */
  strasse: string | null; plz: string | null; ort: string | null;
};

/** Praesenzliste: alle nicht stornierten Anmeldungen, Teilnehmende alphabetisch, danach die Warteliste. */
export async function teilnehmerliste(db: Db, durchfuehrungId: string): Promise<TeilnehmerZeile[]> {
  await getDurchfuehrungBasis(db, durchfuehrungId);
  const r = await db.query(
    `select a.id, a.status, a.wartelisten_position, a.rechnungsreferenz, a.bemerkung, k.anrede, k.vorname, k.nachname,
            k.email, coalesce(k.telefon, k.mobile) as telefon, k.funktion, o.name as organisation, ag.name as empfaenger,
            o.strasse, o.plz, o.ort
     from anmeldung a join kontakt k on k.id=a.kontakt_id
       left join organisation o on o.id=k.organisation_id left join auftraggeber ag on ag.id=a.rechnungsempfaenger_id
     where a.durchfuehrung_id=$1 and a.status <> 'storniert'
     order by (a.status='warteliste'), a.wartelisten_position nulls first, lower(k.nachname), lower(k.vorname)`, [durchfuehrungId]);
  return r.rows.map((x: any) => ({
    anmeldungId: x.id, status: x.status, wartelistenPosition: x.wartelisten_position, anrede: x.anrede, vorname: x.vorname,
    nachname: x.nachname, email: x.email, telefon: x.telefon, funktion: x.funktion, organisation: x.organisation,
    rechnungsempfaenger: x.empfaenger, rechnungsreferenz: x.rechnungsreferenz, bemerkung: x.bemerkung,
    strasse: x.strasse, plz: x.plz, ort: x.ort,
  }));
}

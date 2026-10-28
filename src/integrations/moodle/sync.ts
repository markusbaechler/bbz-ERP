import type pg from 'pg';
import type { MoodleClient } from './client';
import { MoodleFehler } from './client';

/*
 * Moodle-Abgleich (Spec v2 §6.2). Handler fuer die Outbox-Auftraege moodle.einschreiben / moodle.ausschreiben
 * sowie der Abschluss-Sync (Pull). Die Handler sind idempotent: ein wiederholter Auftrag schadet nicht.
 */

export type MoodleTiming = { einschreibenTageVorBeginn: number; zugangTageNachEnde: number };
export const MOODLE_TIMING_DEFAULT: MoodleTiming = { einschreibenTageVorBeginn: 14, zugangTageNachEnde: 60 };

const epoch = (datum: string, tage: number) => Math.floor((Date.parse(`${datum}T00:00:00Z`) + tage * 86400_000) / 1000);

async function ladeAnmeldung(pool: pg.Pool, anmeldungId: string) {
  const r = await pool.query(
    `select a.id, a.status, a.quelle, a.moodle_status, a.kontakt_id, k.email, k.vorname, k.nachname, k.sprache, k.moodle_user_id,
            d.moodle_kurs_id, d.start_datum, d.end_datum
     from anmeldung a join kontakt k on k.id = a.kontakt_id join durchfuehrung d on d.id = a.durchfuehrung_id
     where a.id = $1`, [anmeldungId]);
  return r.rows[0] ?? null;
}

async function setzeStatus(pool: pg.Pool, anmeldungId: string, status: string, fehler: string | null) {
  await pool.query('update anmeldung set moodle_status=$2, moodle_fehler=$3 where id=$1', [anmeldungId, status, fehler]);
}

/** Moodle-Benutzer zur E-Mail finden oder anlegen; merkt die ID am Kontakt (Selbstregistrierung in mybbz ist aktiv). */
export async function stelleBenutzerSicher(pool: pg.Pool, moodle: MoodleClient, k: { kontakt_id: string; email: string; vorname: string | null; nachname: string; sprache: string; moodle_user_id: number | null }): Promise<number> {
  if (k.moodle_user_id) return k.moodle_user_id;
  const vorhanden = await moodle.findeBenutzerPerEmail(k.email);
  const id = vorhanden?.id ?? await moodle.erstelleBenutzer({ email: k.email, vorname: k.vorname ?? '', nachname: k.nachname, sprache: k.sprache });
  // Haelt bereits ein anderer (z. B. archivierter Dubletten-)Kontakt diese Moodle-ID, wird sie nicht doppelt vergeben;
  // die Einschreibung laeuft trotzdem.
  await pool.query(
    `update kontakt set moodle_user_id=$2 where id=$1 and moodle_user_id is null
       and not exists (select 1 from kontakt where moodle_user_id=$2)`, [k.kontakt_id, id]);
  return id;
}

export async function moodleEinschreiben(pool: pg.Pool, moodle: MoodleClient | null, anmeldungId: string, timing = MOODLE_TIMING_DEFAULT): Promise<'eingeschrieben' | 'uebersprungen'> {
  const a = await ladeAnmeldung(pool, anmeldungId);
  if (!a || !['bestaetigt', 'teilgenommen', 'abgeschlossen'].includes(a.status)) return 'uebersprungen';
  if (!a.moodle_kurs_id) { await setzeStatus(pool, anmeldungId, 'nicht_relevant', null); return 'uebersprungen'; }
  // In Moodle gebucht (Face-to-Face): Person ist dort bereits im Kurs -> nur Status nachfuehren.
  if (a.quelle === 'moodle') { await setzeStatus(pool, anmeldungId, 'eingeschrieben', null); return 'uebersprungen'; }
  if (!moodle) throw new Error('Moodle ist nicht konfiguriert (MOODLE_URL/MOODLE_TOKEN)');
  if (!a.email) { await setzeStatus(pool, anmeldungId, 'fehler', 'Kontakt ohne E-Mail'); throw new Error('Kontakt ohne E-Mail'); }
  try {
    const userid = await stelleBenutzerSicher(pool, moodle, a);
    await moodle.schreibeEin({
      userid, courseid: a.moodle_kurs_id,
      timestart: epoch(a.start_datum, -timing.einschreibenTageVorBeginn), timeend: epoch(a.end_datum, timing.zugangTageNachEnde),
    });
    await setzeStatus(pool, anmeldungId, 'eingeschrieben', null);
    return 'eingeschrieben';
  } catch (e) {
    await setzeStatus(pool, anmeldungId, 'fehler', (e as Error).message.slice(0, 500));
    throw e;
  }
}

export async function moodleAusschreiben(pool: pg.Pool, moodle: MoodleClient | null, anmeldungId: string): Promise<'ausgeschrieben' | 'uebersprungen'> {
  const a = await ladeAnmeldung(pool, anmeldungId);
  if (!a || !a.moodle_kurs_id || !a.moodle_user_id || a.moodle_status !== 'eingeschrieben') return 'uebersprungen';
  if (!moodle) throw new Error('Moodle ist nicht konfiguriert (MOODLE_URL/MOODLE_TOKEN)');
  await moodle.schreibeAus({ userid: a.moodle_user_id, courseid: a.moodle_kurs_id });
  await setzeStatus(pool, anmeldungId, 'ausgeschrieben', null);
  return 'ausgeschrieben';
}

export type Abschliessen = (pool: pg.Pool, anmeldungId: string, zeitpunkt: Date) => Promise<void>;

/** Pull-Sync: fragt fuer alle eingeschriebenen, noch nicht abgeschlossenen Anmeldungen den Kursabschluss ab. */
export async function abschlussSync(pool: pg.Pool, moodle: MoodleClient, abschliessen: Abschliessen,
  filter: { durchfuehrungId?: string } = {}): Promise<{ geprueft: number; abgeschlossen: number; ohneKriterien: number; fehler: { anmeldungId: string; fehler: string }[] }> {
  const args: unknown[] = [];
  let sql = `select a.id, k.moodle_user_id, d.moodle_kurs_id from anmeldung a
             join kontakt k on k.id=a.kontakt_id join durchfuehrung d on d.id=a.durchfuehrung_id
             where a.moodle_status='eingeschrieben' and a.status in ('bestaetigt','teilgenommen')
               and k.moodle_user_id is not null and d.moodle_kurs_id is not null`;
  if (filter.durchfuehrungId) { args.push(filter.durchfuehrungId); sql += ` and d.id=$${args.length}`; }
  const lauf = await pool.query(`insert into integration_lauf(typ) values ('moodle.abschluss') returning id`);
  const ergebnis = { geprueft: 0, abgeschlossen: 0, ohneKriterien: 0, fehler: [] as { anmeldungId: string; fehler: string }[] };
  for (const r of (await pool.query(sql, args)).rows) {
    ergebnis.geprueft++;
    try {
      const s = await moodle.abschluss(r.moodle_kurs_id, r.moodle_user_id);
      if (s === null) { ergebnis.ohneKriterien++; continue; }
      if (s.abgeschlossen) {
        await abschliessen(pool, r.id, s.zeitpunkt ? new Date(s.zeitpunkt * 1000) : new Date());
        ergebnis.abgeschlossen++;
      }
    } catch (e) {
      ergebnis.fehler.push({ anmeldungId: r.id, fehler: e instanceof MoodleFehler ? e.message : String(e) });
    }
  }
  const status = ergebnis.fehler.length === 0 ? 'ok' : ergebnis.fehler.length < ergebnis.geprueft ? 'teilweise' : 'fehler';
  await pool.query('update integration_lauf set beendet_am=now(), status=$2, ergebnis=$3 where id=$1', [lauf.rows[0].id, status, JSON.stringify(ergebnis)]);
  return ergebnis;
}

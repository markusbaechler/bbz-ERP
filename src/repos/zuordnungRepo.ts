import type { Db } from './db';
import { BANK_ALIASE } from '../config/bankAliase';

/*
 * Zuordnung von Freitext-Angaben aus Formularen/Importen zu Stammdaten. Bewusst konservativ: nur eindeutige
 * Treffer werden verknuepft, sonst bleibt die Angabe als Text erhalten und wird intern geklaert.
 */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(ag|sa|genossenschaft|cie)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const ALIAS_NORM = new Map(Object.entries(BANK_ALIASE).map(([a, k]) => [norm(a), k]));

/** Organisation zu einem Banknamen (Alias -> kanonischer Name; exakt nach Normalisierung; eindeutig). */
export async function findeOrganisationPerName(db: Db, name: string | null | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const kandidaten = [name, ALIAS_NORM.get(norm(name))].filter((x): x is string => !!x).map(norm);
  const r = await db.query('select id, name from organisation where not archiviert');
  const treffer = r.rows.filter((o: any) => kandidaten.includes(norm(o.name)));
  return treffer.length === 1 ? treffer[0].id : null;
}

/** Oeffentliche, buchbare Durchfuehrung per Code (Homepage/Formulare uebergeben Codes, keine IDs). */
export async function findeDurchfuehrungPerCode(db: Db, code: string): Promise<string | null> {
  const r = await db.query('select id from durchfuehrung where upper(code)=upper($1)', [code.trim()]);
  return r.rowCount ? r.rows[0].id : null;
}

/** Durchfuehrung zur Moodle-Face-to-Face-Session. */
export async function findeDurchfuehrungPerMoodleSession(db: Db, sessionId: number): Promise<string | null> {
  const r = await db.query('select id from durchfuehrung where moodle_session_id=$1', [sessionId]);
  return r.rowCount ? r.rows[0].id : null;
}

/** Bereits uebernommene Buchung (Idempotenz-Schluessel der Anmeldung). */
export async function findeAnmeldungPerIdempotenz(db: Db, schluessel: string): Promise<{ id: string; status: string } | null> {
  const r = await db.query('select id, status from anmeldung where idempotenz_schluessel=$1', [schluessel]);
  return r.rowCount ? r.rows[0] : null;
}

/** Offene Anmeldungen, die zu einem Moodle-Kursabschluss (Kurs + Moodle-Benutzer) gehoeren. */
export async function anmeldungenZuMoodleAbschluss(db: Db, moodleKursId: number, moodleUserId: number): Promise<string[]> {
  const r = await db.query(
    `select a.id from anmeldung a join kontakt k on k.id=a.kontakt_id join durchfuehrung d on d.id=a.durchfuehrung_id
     where d.moodle_kurs_id=$1 and k.moodle_user_id=$2 and a.status in ('bestaetigt','teilgenommen')`, [moodleKursId, moodleUserId]);
  return r.rows.map((x: any) => x.id);
}

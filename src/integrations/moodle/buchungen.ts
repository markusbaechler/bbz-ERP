import type pg from 'pg';
import { meldeAn, bestaetigeAnmeldung, setzeTeilnahme } from '../../repos/anmeldungRepo';
import { ConflictError, ValidationError } from '../../domain/errors';
import { csvObjekte } from '../../../tools/fm-import/csv';
import { findeAnmeldungPerIdempotenz } from '../../repos/zuordnungRepo';

/*
 * Uebernahme von Buchungen aus Moodle-Face-to-Face (heutiger Buchungskanal der oeffentlichen Kurse, Spec v2 §6.2/4).
 * Eingabe: Teilnehmerliste einer Session als CSV-Export (Spalten deutsch/englisch) oder als JSON-Zeilen.
 * Idempotent: gleiche Session + E-Mail erzeugt keine zweite Anmeldung.
 */

export type MoodleBuchung = { email: string; vorname?: string | null; nachname?: string | null; status?: string | null };
export type BuchungsImport = { neu: number; bereitsVorhanden: number; bestaetigt: number; warteliste: number; uebersprungen: number; fehler: { zeile: number; email: string | null; fehler: string }[] };

const SPALTEN: Record<keyof MoodleBuchung, string[]> = {
  email: ['email', 'e-mail', 'e-mail-adresse', 'emailadresse', 'email address', 'mail'],
  vorname: ['vorname', 'first name', 'firstname'],
  nachname: ['nachname', 'last name', 'lastname', 'surname'],
  status: ['status', 'signup status', 'buchungsstatus', 'anmeldestatus', 'teilnahmestatus', 'attendance'],
};

export function liesBuchungenCsv(csv: string): MoodleBuchung[] {
  return csvObjekte(csv).map((zeile) => {
    const index = new Map(Object.entries(zeile).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const feld = (k: keyof MoodleBuchung) => SPALTEN[k].map((s) => index.get(s)).find((v) => v !== undefined && v !== '') ?? null;
    return { email: feld('email') ?? '', vorname: feld('vorname'), nachname: feld('nachname'), status: feld('status') };
  });
}

/** Face-to-Face-Status -> ERP-Aktion. Storniert/abgesagt wird nicht uebernommen. */
export function statusAktion(s: string | null | undefined): 'bestaetigen' | 'teilgenommen' | 'warteliste' | 'ignorieren' | 'anmelden' {
  const n = (s ?? '').toLowerCase();
  if (/cancel|storn|abgesagt|declined|abgelehnt/.test(n)) return 'ignorieren';
  if (/wait|warte/.test(n)) return 'warteliste';
  if (/attended|teilgenommen|anwesend|fully|partially/.test(n)) return 'teilgenommen';
  if (/book|gebucht|best[aä]tig|approved|requested|angemeldet/.test(n)) return 'bestaetigen';
  return 'anmelden';
}

export async function importiereBuchungen(pool: pg.Pool, durchfuehrungId: string, buchungen: MoodleBuchung[], benutzer: string | null = null): Promise<BuchungsImport> {
  const erg: BuchungsImport = { neu: 0, bereitsVorhanden: 0, bestaetigt: 0, warteliste: 0, uebersprungen: 0, fehler: [] };
  const lauf = await pool.query(`insert into integration_lauf(typ, ergebnis) values ('moodle.buchungen', $1) returning id`, [JSON.stringify({ durchfuehrungId })]);
  for (const [i, b] of buchungen.entries()) {
    const aktion = statusAktion(b.status);
    if (aktion === 'ignorieren') { erg.uebersprungen++; continue; }
    const email = b.email?.trim().toLowerCase() || null;
    try {
      if (!email) throw new ValidationError('E-Mail fehlt');
      const schluessel = `moodle:${durchfuehrungId}:${email}`;
      const vorhanden = await findeAnmeldungPerIdempotenz(pool, schluessel);
      if (vorhanden) {
        // Wiederholter Import: nur Fortschritt nachfuehren (z. B. inzwischen teilgenommen)
        if (aktion === 'teilgenommen' && vorhanden.status === 'bestaetigt') await setzeTeilnahme(pool, vorhanden.id, 'teilgenommen', benutzer);
        erg.bereitsVorhanden++; continue;
      }
      const r = await meldeAn(pool, durchfuehrungId, {
        kontakt: { email, vorname: b.vorname ?? null, nachname: b.nachname || email.split('@')[0] },
        quelle: 'moodle', idempotenzSchluessel: schluessel,
      });
      erg.neu++;
      if (r.warteliste) { erg.warteliste++; continue; }
      if (aktion === 'bestaetigen' || aktion === 'teilgenommen') {
        if (r.anmeldung.status === 'angemeldet') { await bestaetigeAnmeldung(pool, r.anmeldung.id, benutzer); erg.bestaetigt++; }
        if (aktion === 'teilgenommen') await setzeTeilnahme(pool, r.anmeldung.id, 'teilgenommen', benutzer);
      }
    } catch (e) {
      if (e instanceof ConflictError) { erg.bereitsVorhanden++; continue; }
      erg.fehler.push({ zeile: i + 2, email, fehler: (e as Error).message });
    }
  }
  const status = erg.fehler.length === 0 ? 'ok' : erg.fehler.length < buchungen.length ? 'teilweise' : 'fehler';
  await pool.query('update integration_lauf set beendet_am=now(), status=$2, ergebnis=$3 where id=$1', [lauf.rows[0].id, status, JSON.stringify({ durchfuehrungId, ...erg })]);
  return erg;
}

import type pg from 'pg';
import { meldeAn, bestaetigeAnmeldung, setzeTeilnahme, DoppelanmeldungError } from '../../repos/anmeldungRepo';
import { ValidationError } from '../../domain/errors';
import { csvObjekte } from '../../../tools/fm-import/csv';
import {
  findeAnmeldungPerIdempotenz, findeAuftraggeberPerOrganisation, findeDurchfuehrungPerSeminarnummer, findeOrganisationPerName,
} from '../../repos/zuordnungRepo';

/*
 * Uebernahme von Buchungen aus Moodle-Face-to-Face (heutiger Buchungskanal der oeffentlichen Kurse, Spec v2 §6.2/4).
 * Eingabe: Teilnehmerliste einer Session als CSV-Export (Spalten deutsch/englisch) oder als JSON-Zeilen.
 * Idempotent: gleiche Session + E-Mail erzeugt keine zweite Anmeldung.
 */

export type MoodleBuchung = {
  email: string; vorname?: string | null; nachname?: string | null; status?: string | null;
  // Bericht "Anmeldungen Kursdaten V2" (Profilfelder und Terminfeld Seminarnummer)
  funktion?: string | null; telefon?: string | null; rechnungsadresse?: string | null; bank?: string | null; seminarnummer?: string | null;
};
export type BuchungsImport = { neu: number; bereitsVorhanden: number; bestaetigt: number; warteliste: number; uebersprungen: number; fehler: { zeile: number; email: string | null; fehler: string }[] };

// "Session status" (Ausgebucht/Buchung moeglich) ist der Stand des Termins, nicht der Buchung – bewusst nicht als Status gelesen.
const SPALTEN: Record<keyof MoodleBuchung, string[]> = {
  email: ['email', 'e-mail', 'e-mail-adresse', 'emailadresse', 'email address', 'mail'],
  vorname: ['vorname', 'first name', 'firstname'],
  nachname: ['nachname', 'last name', 'lastname', 'surname'],
  status: ['status', 'signup status', 'buchungsstatus', 'anmeldestatus', 'teilnahmestatus', 'attendance'],
  funktion: ['funktion', 'function'],
  telefon: ['telefonnummer', 'telefon', 'phone'],
  rechnungsadresse: ['rechnungsadresse (falls abweichend von geschäftsadresse)', 'rechnungsadresse', 'invoice address'],
  bank: ['bank'],
  seminarnummer: ['seminarnummer', 'seminar nr.', 'seminar number'],
};

export function liesBuchungenCsv(csv: string): MoodleBuchung[] {
  return csvObjekte(csv).map((zeile) => {
    const index = new Map(Object.entries(zeile).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const feld = (k: keyof MoodleBuchung) => SPALTEN[k].map((s) => index.get(s)).find((v) => v !== undefined && v !== '') ?? null;
    return {
      email: feld('email') ?? '', vorname: feld('vorname'), nachname: feld('nachname'), status: feld('status'),
      funktion: feld('funktion'), telefon: feld('telefon'), rechnungsadresse: feld('rechnungsadresse'), bank: feld('bank'),
      seminarnummer: feld('seminarnummer'),
    };
  });
}

/** Rechnungsempfaenger aus der Bank (Profilfeld): CRM-Organisation per Name, deren Debitor. "Andere"/unbekannt -> null. */
async function empfaengerAusBank(pool: pg.Pool, bank: string | null | undefined): Promise<{ organisationId: string | null; auftraggeberId: string | null }> {
  const organisationId = await findeOrganisationPerName(pool, bank);
  return { organisationId, auftraggeberId: organisationId ? await findeAuftraggeberPerOrganisation(pool, organisationId) : null };
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
      const bank = await empfaengerAusBank(pool, b.bank);
      const r = await meldeAn(pool, durchfuehrungId, {
        kontakt: { email, vorname: b.vorname ?? null, nachname: b.nachname || email.split('@')[0], funktion: b.funktion ?? null,
          telefon: b.telefon ?? null, organisationId: bank.organisationId },
        rechnungsempfaengerId: bank.auftraggeberId,
        bemerkung: b.rechnungsadresse ? `Rechnungsadresse laut Moodle: ${b.rechnungsadresse.replace(/\s*\n\s*/g, ', ')}` : null,
        quelle: 'moodle', idempotenzSchluessel: schluessel,
      });
      erg.neu++;
      if (r.warteliste) { erg.warteliste++; continue; }
      if (aktion === 'bestaetigen' || aktion === 'teilgenommen') {
        if (r.anmeldung.status === 'angemeldet') { await bestaetigeAnmeldung(pool, r.anmeldung.id, benutzer); erg.bestaetigt++; }
        if (aktion === 'teilgenommen') await setzeTeilnahme(pool, r.anmeldung.id, 'teilgenommen', benutzer);
      }
    } catch (e) {
      // Nur die Doppelbuchung ist "bereits vorhanden"; andere Konflikte (z. B. Durchfuehrung nicht ausgeschrieben) sind Fehler.
      if (e instanceof DoppelanmeldungError) { erg.bereitsVorhanden++; continue; }
      erg.fehler.push({ zeile: i + 2, email, fehler: (e as Error).message });
    }
  }
  const status = erg.fehler.length === 0 ? 'ok' : erg.fehler.length < buchungen.length ? 'teilweise' : 'fehler';
  await pool.query('update integration_lauf set beendet_am=now(), status=$2, ergebnis=$3 where id=$1', [lauf.rows[0].id, status, JSON.stringify({ durchfuehrungId, ...erg })]);
  return erg;
}

export type KursdatenImport = {
  seminare: ({ seminarnummer: string; durchfuehrungId: string } & BuchungsImport)[];
  unbekannteSeminarnummern: string[];
  ohneSeminarnummer: number;
};

/**
 * Moodle-Bericht "Anmeldungen Kursdaten V2" (Berichtsgenerator, alle Face-to-Face-Termine): Zuordnung je Zeile ueber
 * die Seminarnummer zur Durchfuehrung. Der Bericht listet Buchungen; ohne eigene Statusspalte gilt eine Zeile als gebucht.
 */
export async function importiereKursdatenBericht(pool: pg.Pool, csv: string, benutzer: string | null = null): Promise<KursdatenImport> {
  const zeilen = liesBuchungenCsv(csv);
  if (!zeilen.length) throw new ValidationError('Bericht ohne Zeilen');
  const gruppen = new Map<string, MoodleBuchung[]>();
  let ohneSeminarnummer = 0;
  for (const z of zeilen) {
    const nr = z.seminarnummer?.trim();
    if (!nr) { ohneSeminarnummer++; continue; }
    gruppen.set(nr, [...(gruppen.get(nr) ?? []), { ...z, status: z.status ?? 'gebucht' }]);
  }
  const erg: KursdatenImport = { seminare: [], unbekannteSeminarnummern: [], ohneSeminarnummer };
  for (const [seminarnummer, buchungen] of gruppen) {
    const durchfuehrungId = await findeDurchfuehrungPerSeminarnummer(pool, seminarnummer);
    if (!durchfuehrungId) { erg.unbekannteSeminarnummern.push(seminarnummer); continue; }
    erg.seminare.push({ seminarnummer, durchfuehrungId, ...await importiereBuchungen(pool, durchfuehrungId, buchungen, benutzer) });
  }
  return erg;
}

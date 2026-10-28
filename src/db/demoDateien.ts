/**
 * Beispieldateien fuer die lokale Testumgebung (`npm run demo:neu` legt sie in demo-dateien/ ab), passend zu den Demo-Daten:
 * - Moodle-Bericht "Anmeldungen Kursdaten V2" (CSV-Export): drei Buchungen auf die Seminarnummern der Demo-Kurse
 *   (Bank = Debitor, Bank ohne Debitor in der Liste der Sparkasse, "Andere" mit abweichender Rechnungsadresse)
 * - camt.054 der Bank: Restzahlung der aeltesten offenen Rechnung (QR-Referenz) und eine Zahlung ohne passende Rechnung
 * NUR synthetische Namen. Importieren in der PWA: Bildung -> "Moodle-Buchungen importieren", Finanzen -> Zahlungsimport.
 */
import type pg from 'pg';
import { heuteIso } from '../domain/crm';
import { baueCamt054 } from '../domain/camt054';
import { qrReferenzRoh } from '../domain/qrReferenz';
import { offenePosten } from '../repos/debitorRepo';

export type DemoDateien = { moodleKursdatenCsv: string; camt054: string };

const KOPF = ['Nachname', 'Vorname', 'E-Mail-Adresse', 'Funktion', 'Telefonnummer', 'Geschäftsadresse',
  'Rechnungsadresse (falls abweichend von Geschäftsadresse)', 'Seminarnummer', 'Vollständiger Kursname',
  'Datum des Veranstaltungsbeginns', 'Booked / Capacity', 'Erstellungsdatum', 'Session status', 'Profil', 'Bank'];

const datumCh = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const csvFeld = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function moodleKursdaten(pool: pg.Pool): Promise<string> {
  const kurse = new Map<string, any>((await pool.query(
    `select ka.code, d.seminarnummer, d.start_datum, d.kapazitaet, coalesce(d.titel, ka.titel) as titel
     from durchfuehrung d join kursangebot ka on ka.id=d.kursangebot_id
     where ka.code in ('SAQV', 'FUE') and d.seminarnummer is not null`)).rows.map((r) => [r.code, r]));
  const buchungen: [string, string, string, string, string, string, string, string, string][] = [
    // Kurs, Nachname, Vorname, Funktion, Telefon, Geschaeftsadresse, Rechnungsadresse, Profil, Bank
    ['SAQV', 'Moodlemuster', 'Rita', 'Kundenberaterin', '071 000 00 21', 'Bahnhofstrasse 10, 9000 St. Gallen', '', 'Privatkunden', 'Musterbank AG'],
    ['SAQV', 'Demotest', 'Stefan', 'Kundenberater', '', 'Marktgasse 7, 3011 Bern', '', 'KMU', 'Sparkasse Beispielstadt'],
    ['FUE', 'Beispielfrau', 'Tanja', 'Teamleiterin', '044 000 00 22', 'Musterweg 3, 8000 Zürich', 'Postfach 12, 8000 Zürich', 'Affluent', 'Andere'],
  ];
  const zeilen = buchungen.map(([code, nachname, vorname, funktion, telefon, adresse, rechnungsadresse, profil, bank]) => {
    const k = kurse.get(code);
    const email = `${vorname}.${nachname}`.toLowerCase() + '@moodle-demo.example';
    return [nachname, vorname, email, funktion, telefon, adresse, rechnungsadresse, k.seminarnummer, k.titel, datumCh(k.start_datum),
      `1 / ${k.kapazitaet}`, datumCh(heuteIso()), 'Buchung möglich', profil, bank].map(csvFeld).join(',');
  });
  return [KOPF.map(csvFeld).join(','), ...zeilen].join('\n') + '\n';
}

async function camt054(pool: pg.Pool): Promise<string> {
  const heute = heuteIso();
  const zahlungen = [];
  const aelteste = (await offenePosten(pool)).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  if (aelteste) {
    const lfdNr = (await pool.query('select lfd_nr from rechnung where id=$1', [aelteste.rechnungId])).rows[0].lfd_nr;
    zahlungen.push({ betrag: aelteste.offen, datum: heute, txRef: `DEMO-${heute}-1`, qrr: qrReferenzRoh(lfdNr) });
  }
  zahlungen.push({ betrag: 150, datum: heute, txRef: `DEMO-${heute}-2`, qrr: qrReferenzRoh(999999), mitteilung: 'Zahlung ohne passende Rechnung' });
  return baueCamt054(zahlungen);
}

export async function demoDateien(pool: pg.Pool): Promise<DemoDateien> {
  return { moodleKursdatenCsv: await moodleKursdaten(pool), camt054: await camt054(pool) };
}

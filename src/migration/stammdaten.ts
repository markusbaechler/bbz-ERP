import type pg from 'pg';
import { upsertMwstSatz } from '../repos/mwstSatzRepo';

// Hier stand bis zum Kontenplan-Import eine Liste von elf Konten, deren Bezeichnungen
// aus der Bereichs-Spalte des Projekt-Exports abgeleitet — also erfunden — waren. Sie
// ist ersatzlos weg: die Migration erfindet keine Daten, und das gilt fuer Stammdaten
// genauso wie fuer Bewegungsdaten. Der echte Kontenplan kommt aus der Datei des Kunden
// ("Kontoplan 2024.xlsx") und wird ueber `--konten=<pfad.csv>` importiert
// (src/migration/konten.ts). Ohne diesen Lauf bleibt jede Kontierung offen — und der
// Report sagt das in einem Satz, statt es je Projekt zu wiederholen.
//
// Uebrig bleibt die MWSt-Satzhistorie: die ist extern nachpruefbar (ESTV) und
// unveraendert.

// Schweizer MWSt-Satzhistorie. Deckt alle 12 im Faktura-Export vorkommenden Saetze ab
// (0, 2, 2.4, 2.5, 2.6, 3.6, 3.7, 3.8, 7.6, 7.7, 8, 8.1) — noetig, damit historische
// Belege beim spaeteren Rechnungsimport ihren gueltigen Satz finden.
export const MWST_SAETZE = [
  { satz: 0.0, bezeichnung: 'Befreit/ausgenommen', gueltigAb: '1995-01-01', gueltigBis: null },
  { satz: 2.0, bezeichnung: 'Reduziert', gueltigAb: '1995-01-01', gueltigBis: '1998-12-31' },
  { satz: 2.4, bezeichnung: 'Reduziert', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 2.5, bezeichnung: 'Reduziert', gueltigAb: '2011-01-01', gueltigBis: '2023-12-31' },
  { satz: 2.6, bezeichnung: 'Reduziert', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 3.6, bezeichnung: 'Beherbergung', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 3.7, bezeichnung: 'Beherbergung', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 7.6, bezeichnung: 'Normal', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 8.0, bezeichnung: 'Normal', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 7.7, bezeichnung: 'Normal', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01', gueltigBis: null },
] as const satisfies ReadonlyArray<{ satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string | null }>;

export async function importStammdaten(pool: pg.Pool): Promise<{
  mwstSaetze: { angelegt: number; vorhanden: number };
}> {
  const mwstSaetze = { angelegt: 0, vorhanden: 0 };
  for (const s of MWST_SAETZE) {
    const r = await upsertMwstSatz(pool, s);
    r.neu ? mwstSaetze.angelegt++ : mwstSaetze.vorhanden++;
  }
  return { mwstSaetze };
}

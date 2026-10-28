/*
 * Synthetische Reporting_KUBA.xlsx fuer Tests (keine Personendaten: alle Namen sind erfunden).
 * Aufbau wie die echte Datei laut bbz-saq: Zeilen 1-9 Titel/Legende, Header in Zeile 10, Daten ab Zeile 11.
 * Die zwei Sheets sind absichtlich NICHT spaltenidentisch: "Ausgestellte Zertifikate" hat andere Spaltenreihenfolge,
 * die Header-Variante "... yes" statt "... Passed", zusaetzlich die Zertifikatsspalten und keine "WE6 RUN1 Location".
 */
import * as XLSXns from 'xlsx';

const XLSX: typeof XLSXns = (XLSXns as any).read ? XLSXns : (XLSXns as any).default;

/** Zellwert: Text/Zahl/Boolean, Datum mit Datumsformat ({ datum: 'YYYY-MM-DD' }), Excel-Fehler ({ fehler: '#N/A' }). */
export type TestZelle = string | number | boolean | { datum: string } | { fehler: '#N/A' | '#VALUE!' } | null | undefined;
/** Zeile: Header-Name (Variante "Passed") -> Wert; `_kommentar` = Threaded Comment auf B{zeile}. */
export type TestZeile = Record<string, TestZelle> & { _kommentar?: string };

/** Excel-Serienzahl (Tage seit 1899-12-30) eines ISO-Datums, zeitzonenfrei. */
export function serienzahl(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function runHeader(art: 'WE' | 'OE', teile: number, issued: boolean): string[] {
  const h: string[] = [];
  const ok = issued ? 'yes' : 'Passed';
  h.push(`${art} All ${ok}`);
  for (let t = 1; t <= teile; t++) {
    h.push(`${art}${t} ${ok}`);
    for (let r = 1; r <= 3; r++) {
      const run = `${art}${t} RUN${r}`;
      h.push(`${run} ${ok}`, `${run} Date`, `${run} Score`, `${run} Result`);
      if (!(issued && art === 'WE' && t === 6 && r === 1)) h.push(`${run} Location`);
      if (art === 'OE') h.push(`${run} Expert 1`, `${run} Expert 2`);
    }
  }
  return h;
}

/** Header-Zeile (Zeile 10) je Sheet; `ohne` entfernt Header (Test "fehlender Pflicht-Header"). */
export function kubaHeader(sheet: 'first' | 'issued', ohne: string[] = []): string[] {
  const kopf = sheet === 'first'
    ? ['Nr', 'Last Name', 'First Name', 'Birth Date', 'Role', 'Employer', 'Certificate Program', 'Certificate Language', 'Communication Language']
    : ['Nr', 'First Name', 'Last Name', 'Employer', 'Role', 'Birth Date', 'Certificate Program', 'Certificate Language',
      'Certificate Number', 'Certificate Start Date', 'Certificate End Date', 'Communication Language'];
  return [...kopf, ...runHeader('WE', 6, sheet === 'issued'), ...runHeader('OE', 2, sheet === 'issued')].filter((h) => !ohne.includes(h));
}

/** "WE1 RUN1 Passed" -> "WE1 RUN1 yes" fuer das Sheet "Ausgestellte Zertifikate". */
const variante = (header: string, issued: boolean) => (issued ? header.replace(/ Passed$/, ' yes') : header);

function zelle(v: TestZelle): XLSXns.CellObject | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return { t: 's', v };
  if (typeof v === 'number') return { t: 'n', v };
  if (typeof v === 'boolean') return { t: 'b', v };
  if ('datum' in v) return { t: 'n', v: serienzahl(v.datum), z: 'dd.mm.yyyy' };
  return { t: 'e', v: v.fehler === '#N/A' ? 0x2a : 0x0f, w: v.fehler };
}

function baueSheet(sheet: 'first' | 'issued', zeilen: (TestZeile | null)[], ohne: string[] = []): XLSXns.WorkSheet {
  const header = kubaHeader(sheet, ohne);
  const issued = sheet === 'issued';
  const ws: XLSXns.WorkSheet = {};
  const setze = (r: number, c: number, cell: XLSXns.CellObject | null) => { if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  // Zeilen 1-9: Titel und Legende (werden nie gelesen); bewusst mit Inhalt, der wie Daten aussieht
  setze(0, 0, { t: 's', v: `Reporting KUBA – ${issued ? 'Ausgestellte Zertifikate' : 'First Certification'} (synthetisch)` });
  setze(4, 1, { t: 's', v: 'Legende: yes = bestanden' });
  setze(6, 3, { t: 'n', v: 12345 });
  header.forEach((h, c) => setze(9, c, { t: 's', v: h }));
  zeilen.forEach((z, i) => {
    if (!z) return;   // Leerzeile
    const r = 10 + i;
    setze(r, 0, { t: 'n', v: i + 1 });   // Hilfsspalte "Nr" zaehlt nicht als Inhalt
    for (const [name, wert] of Object.entries(z)) {
      if (name === '_kommentar') continue;
      const c = header.indexOf(variante(name, issued));
      if (c < 0) throw new Error(`Testdaten: Header ${name} fehlt im Sheet ${sheet}`);
      setze(r, c, zelle(wert));
    }
    if (z._kommentar) {
      const ref = XLSX.utils.encode_cell({ r, c: 1 });   // Threaded Comments haengen an B{zeile}
      ws[ref] = ws[ref] ?? { t: 'z' } as XLSXns.CellObject;
      (ws[ref] as any).c = [{ a: 'Synthetisch', t: z._kommentar, T: true }];
    }
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 10 + Math.max(zeilen.length, 1), c: header.length - 1 } });
  return ws;
}

/** Baut die Arbeitsmappe als Buffer. Optional ein drittes Sheet, das nie gelesen werden darf. */
export function baueKubaXlsx(def: {
  first: (TestZeile | null)[]; issued: (TestZeile | null)[]; ohneHeader?: { first?: string[]; issued?: string[] };
  ohneSheet?: 'first' | 'issued'; fremdesSheet?: boolean;
}): Buffer {
  const wb = XLSX.utils.book_new();
  if (def.fremdesSheet) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Last Name'], ['Fremd']]), 'Auswertung');
  }
  if (def.ohneSheet !== 'first') XLSX.utils.book_append_sheet(wb, baueSheet('first', def.first, def.ohneHeader?.first), 'First Certification');
  if (def.ohneSheet !== 'issued') XLSX.utils.book_append_sheet(wb, baueSheet('issued', def.issued, def.ohneHeader?.issued), 'Ausgestellte Zertifikate');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ---------------------------------------------------------------- Standard-Testdatei (erfundene Personen)

export const HEUTE = '2026-10-28';

/**
 * First Certification (Zeile = 11 + Index):
 *  11 Muster Anna     PK, BEKB (Alias), DE, WE1+OE1 bestanden (Experten), Kommentar VSM -> Duplikat in Sheet 2
 *  12 Beispiel Bruno  "Affluent" -> AFFL, Geburtsdatum als Serienzahl, Sprache "f", WE1 RUN1 no / RUN2 yes, WE2 yes,
 *                     OE1 RUN1 geplant, unbekannte Bank -> schriftlich_bestanden
 *  13 Exempel Clara   "PK FRZ" ohne Sprache -> PK/FR, Raiffeisen KB, WE1 RUN1-3 FAILED/no/no -> nicht_bestanden
 *  14 Probe Dora      "CCOB", unlesbare Zellen (Passed, Datum, Result, Sprache, #N/A), WE1 RUN2 Textdatum -> in_pruefung
 *  15 (Leerzeile)
 *  16 ohne Namen, aber mit Daten -> DQ "Name fehlt"
 *  17 Test Emil       Profil "XYZ" -> nicht importierbar
 *  18 Fiktiv Gina     IK, ohne Geburtsdatum, Communication Language EN, SGKB (nicht im CRM), keine Runs -> angemeldet
 *  19 Konflikt Hans   PK, WE1 RUN1 2024-03-01 yes (Profilkonflikt mit Sheet 2)
 *  20 Muster Anna     "AFF" -> AFFL (zweites Profil derselben Person), WE1 RUN1 mit Ergebnis ohne Datum
 */
export function standardDatei(): Buffer {
  const first: (TestZeile | null)[] = [
    {
      'Last Name': 'Muster', 'First Name': 'Anna', 'Birth Date': { datum: '1990-04-12' }, Role: 'Kundenberaterin', Employer: 'BEKB',
      'Certificate Program': 'PK', 'Certificate Language': 'de', 'Communication Language': 'DE',
      'WE All Passed': 'yes', 'WE1 Passed': 'yes', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2024-03-04' }, 'WE1 RUN1 Score': 41, 'WE1 RUN1 Result': 0.82, 'WE1 RUN1 Location': 'Bern',
      'OE All Passed': 'YES', 'OE1 Passed': 'yes', 'OE1 RUN1 Passed': 'PASSED', 'OE1 RUN1 Date': { datum: '2024-05-06' }, 'OE1 RUN1 Score': 18, 'OE1 RUN1 Result': '90.00%',
      'OE1 RUN1 Location': 'Remote', 'OE1 RUN1 Expert 1': 'Erika Expertin', 'OE1 RUN1 Expert 2': 'Zeno  Zweitpruefer',
      _kommentar: 'VSM 8718 28.08./05.09.24: Synthetisch',
    },
    {
      'Last Name': 'Beispiel', 'First Name': 'Bruno', 'Birth Date': serienzahl('1985-11-30'), Role: 'Kundenberater', Employer: 'Bank Unbekannt AG',
      'Certificate Program': 'Affluent', 'Certificate Language': 'f',
      'WE All Passed': 'yes', 'WE1 Passed': 'yes', 'WE1 RUN1 Passed': 'no', 'WE1 RUN1 Date': serienzahl('2024-02-01'), 'WE1 RUN1 Result': 0.55,
      'WE1 RUN2 Passed': 'yes', 'WE1 RUN2 Date': { datum: '2024-04-01' }, 'WE1 RUN2 Result': 71.5,
      'WE2 Passed': 'yes', 'WE2 RUN1 Passed': 'Yes', 'WE2 RUN1 Date': { datum: '2024-04-02' }, 'WE2 RUN1 Result': 0.8,
      'OE1 RUN1 Date': { datum: '2026-12-03' }, 'OE1 RUN1 Location': 'Zuerich', 'OE1 RUN1 Score': 0, 'OE1 RUN1 Result': 0,
    },
    {
      'Last Name': 'Exempel', 'First Name': 'Clara', 'Birth Date': { datum: '1992-01-15' }, Role: 'Kundenberaterin', Employer: 'Raiffeisen KB',
      'Certificate Program': 'PK FRZ',
      'WE All Passed': 'no', 'WE1 Passed': 'no',
      'WE1 RUN1 Passed': 'FAILED', 'WE1 RUN1 Date': { datum: '2023-09-01' }, 'WE1 RUN1 Result': 0.6,
      'WE1 RUN2 Passed': 'no', 'WE1 RUN2 Date': { datum: '2023-11-01' }, 'WE1 RUN2 Result': 0.65,
      'WE1 RUN3 Passed': 'No', 'WE1 RUN3 Date': '15.01.2024', 'WE1 RUN3 Result': 0.68,
    },
    {
      'Last Name': 'Probe', 'First Name': 'Dora', 'Birth Date': { datum: '1988-07-07' }, Role: 'Beraterin', Employer: 'BEKB',
      'Certificate Program': 'CCOB', 'Certificate Language': 'XX', 'Communication Language': 'IT',
      'WE1 RUN1 Passed': 'vielleicht', 'WE1 RUN1 Date': '31.02.2024', 'WE1 RUN1 Result': 'abc', 'WE1 RUN1 Score': { fehler: '#N/A' },
      'WE1 RUN2 Passed': 'yes', 'WE1 RUN2 Date': '15.03.2024 / 09:00', 'WE1 RUN2 Result': 0.75,
    },
    null,
    { 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2024-01-01' } },
    { 'Last Name': 'Test', 'First Name': 'Emil', 'Birth Date': { datum: '1991-02-02' }, 'Certificate Program': 'XYZ', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2024-01-10' } },
    { 'Last Name': 'Fiktiv', 'First Name': 'Gina', Employer: 'SGKB', 'Certificate Program': 'IK', 'Communication Language': 'EN' },
    {
      'Last Name': 'Konflikt', 'First Name': 'Hans', 'Birth Date': { datum: '1980-05-05' }, Employer: 'BEKB', 'Certificate Program': 'PK', 'Certificate Language': 'DE',
      'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2024-03-01' }, 'WE1 RUN1 Result': 0.9,
    },
    {
      'Last Name': 'Muster', 'First Name': 'Anna', 'Birth Date': { datum: '1990-04-12' }, Employer: 'BEKB', 'Certificate Program': 'AFF', 'Certificate Language': 'DE',
      'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Result': 0.77,
    },
  ];
  /**
   * Ausgestellte Zertifikate:
   *  11 Muster Anna    PK (Duplikat von First:11, nur Lueckenfueller), Zertifikat Z-1001, Start/Ende
   *  12 Beispiel Bruno CWMA (zweites Profil), WE/OE All leer -> als bestanden abgeleitet, Zertifikat ohne Ende -> +3 Jahre
   *  13 Konflikt Hans  PK, WE1 RUN1 2025-03-01 (widerspricht First:19) -> eigener Vorgang, Zertifikat ohne Startdatum
   */
  const issued: (TestZeile | null)[] = [
    {
      'Last Name': 'Muster', 'First Name': 'Anna', 'Birth Date': { datum: '1990-04-12' }, Employer: 'Berner Kantonalbank AG', 'Certificate Program': 'PK',
      'Certificate Language': 'DE', 'Certificate Number': 'Z-1001', 'Certificate Start Date': { datum: '2024-06-01' }, 'Certificate End Date': { datum: '2027-05-31' },
      'WE All Passed': 'yes', 'OE All Passed': 'yes', 'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2024-03-04' },
    },
    {
      'Last Name': 'Beispiel', 'First Name': 'Bruno', 'Birth Date': { datum: '1985-11-30' }, Employer: 'Bank Unbekannt AG', 'Certificate Program': 'CWMA',
      'Certificate Language': 'FR', 'Certificate Number': 'Z-2002', 'Certificate Start Date': '01.09.2025',
      'WE1 RUN1 Passed': 'fulfilled', 'WE1 RUN1 Date': { datum: '2025-05-05' }, 'WE1 RUN1 Result': 0.88,
      'OE1 RUN1 Passed': 'yes', 'OE1 RUN1 Date': { datum: '2025-07-07' }, 'OE1 RUN1 Result': 0.92, 'OE1 RUN1 Expert 1': 'Erika Expertin',
    },
    {
      'Last Name': 'Konflikt', 'First Name': 'Hans', 'Birth Date': { datum: '1980-05-05' }, Employer: 'BEKB', 'Certificate Program': 'PK', 'Certificate Language': 'DE',
      'WE1 RUN1 Passed': 'yes', 'WE1 RUN1 Date': { datum: '2025-03-01' }, 'OE1 RUN1 Passed': 'yes', 'OE1 RUN1 Date': { datum: '2025-04-01' },
    },
  ];
  return baueKubaXlsx({ first, issued, fremdesSheet: true });
}

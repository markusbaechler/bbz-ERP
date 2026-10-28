/*
 * Reporting_KUBA.xlsx lesen und normalisieren (DB-frei). Fachliche Autoritaet ist das Cockpit bbz-saq
 * (config.js, store.js, glossary.js); die Regeln sind hierher portiert, damit ERP und Cockpit dasselbe zaehlen:
 *
 * - Nur die Sheets "First Certification" und "Ausgestellte Zertifikate"; Header in Zeile 10, Daten ab Zeile 11.
 * - Spalten ausschliesslich ueber Header-Namen (die zwei Sheets sind nicht spaltenidentisch). Fehlender
 *   Pflicht-Header oder mehrdeutiger Header = harter Fehler (KubaStrukturFehler), kein Fallback.
 * - Jede nicht interpretierbare Zelle landet im Data-Quality-Log (Sheet, Zeile, Header, Rohwert, Grund), nie stilles
 *   Ueberspringen. Stufen wie bbz-saq: fehler (Wert ignoriert), hinweis (interpretiert/abgeleitet/auffaellig),
 *   nicht-ausgewertet (Score).
 * - Vorgang = eine Zeile = Person x Profil. Personenschluessel = Nachname|Vorname|Geburtsdatum (normalisiert,
 *   bewusst ohne Arbeitgeber). Duplikat = gleiche Person + gleiches Profil ohne widerspruechliche Pruefungsdaten:
 *   zusammengefuehrt (Luecken auffuellen, nie ueberschreiben; behalten wird die Zeile mit den meisten absolvierten
 *   Runs, bei Gleichstand die aus "Ausgestellte Zertifikate").
 * - Status je Vorgang aus "WE All" / "OE All": yes -> bestanden, no -> nicht bestanden, leer -> offen,
 *   unlesbar -> nicht erfasst. Im Sheet "Ausgestellte Zertifikate" gelten leere Gesamtergebnisse als bestanden.
 *
 * Zusaetzlich bildet `erp` jeden Vorgang auf das ERP-Modell ab (saq_fall-Status, saq_pruefung-Runs, Zertifikat).
 * Datumswerte sind durchgehend zeitzonenfreie ISO-Strings (YYYY-MM-DD). Excel-Datumszellen werden deshalb nicht
 * ueber SheetJS-Date-Objekte (lokale Zeitzone) gelesen, sondern als Serienzahl mit Datumsformat (ExcelDatum).
 */
import * as XLSXns from 'xlsx';
import { SAQ, SAQ_PROFILE, SAQ_PROFIL_ALIASE, SAQ_TEILE } from '../../src/config/saq';
import { BANK_ALIASE } from '../../src/config/bankAliase';
import { gueltigBis } from '../../src/domain/saq';
import type { SaqProfil, SaqSprache, SaqStatus, SaqPruefungArt } from '../../src/domain/saqTypes';

// SheetJS: unter vitest/ESM benannte Exporte (xlsx.mjs), unter tsx/Node das CommonJS-Modul (default)
const XLSX: typeof XLSXns = (XLSXns as any).read ? XLSXns : (XLSXns as any).default;

export const KUBA = {
  sheets: { first: 'First Certification', issued: 'Ausgestellte Zertifikate' },
  headerZeile: 10,
  datenAbZeile: 11,
  /** Threaded Comments (VSS/VSM) haengen an Zelle B{zeile}. */
  kommentarSpalte: 1,
  we: { teile: 6, runs: 3 },
  oe: { teile: 2, runs: 3 },
  /** bbz-saq PASSED_TRUE / PASSED_FALSE (Vergleich ohne Gross-/Kleinschreibung). */
  passedJa: ['yes', 'passed', 'fulfilled'],
  passedNein: ['no', 'failed'],
  /** bbz-saq DATE_RULES / BIRTH_DATE_RULES: plausible Jahre und Bereich der Excel-Serienzahlen. */
  datum: { minJahr: 2000, maxJahr: 2100, serialMin: 36526, serialMax: 60000 },
  geburtsdatum: { minJahr: 1920, maxJahr: 2010, serialMin: 7306, serialMax: 40179 },
  /** bbz-saq PASS_THRESHOLD: dient nur dem Hinweis "Passed widerspricht Resultat"; massgebend ist Passed. */
  bestehensgrenze: SAQ.bestehensgrenzeProzent / 100,
  /** bbz-saq PROFILE_LANGUAGE_HINTS: Programmbezeichnung, die eine Sprache impliziert. */
  programmSprache: { 'PK FRZ': 'FR' } as Record<string, SaqSprache>,
  /** saq_pruefung.score numeric(6,2) */
  maxScore: 9999.99,
} as const;

export type Quelle = keyof typeof KUBA.sheets;
const QUELLEN: Quelle[] = ['first', 'issued'];
export type Stufe = 'fehler' | 'hinweis' | 'nicht-ausgewertet';
export type KubaStatus = 'bestanden' | 'nicht bestanden' | 'offen' | 'nicht erfasst';
export const KUBA_STATUS: KubaStatus[] = ['bestanden', 'nicht bestanden', 'offen', 'nicht erfasst'];
type Kind = 'we' | 'oe';
const ART: Record<Kind, SaqPruefungArt> = { we: 'schriftlich', oe: 'muendlich' };
const KIND: Record<SaqPruefungArt, Kind> = { schriftlich: 'we', muendlich: 'oe' };

// ---------------------------------------------------------------- Zellen

/** Excel-Serienzahl (Tage seit 1899-12-30) -> YYYY-MM-DD; Uhrzeitanteil wird abgeschnitten. */
export function serialZuIso(serial: number): string {
  const tage = Math.floor(serial + 1e-7);
  return new Date(Date.UTC(1899, 11, 30) + tage * 86_400_000).toISOString().slice(0, 10);
}

/** Zahlzelle mit Datumsformat (in Excel als Datum formatiert). */
export class ExcelDatum {
  constructor(readonly serial: number) {}
  get iso(): string { return serialZuIso(this.serial); }
  toString(): string { return this.iso; }
}

export type Zelle = string | number | boolean | ExcelDatum | null;
export type RohZeile = { zeile: number; zellen: Zelle[]; kommentar: string | null };
export type RohSheet = { quelle: Quelle; sheet: string; header: string[]; zeilen: RohZeile[] };

export type DqEintrag = { stufe: Stufe; sheet: string; zeile: number; header: string; roh: string; grund: string };

export class KubaStrukturFehler extends Error {
  constructor(message: string) { super(message); this.name = 'KubaStrukturFehler'; }
}

export const istLeer = (z: Zelle | undefined): boolean =>
  z === null || z === undefined || (typeof z === 'string' && z.trim() === '');
const alsText = (z: Zelle | undefined): string | null => (istLeer(z) ? null : String(z).trim());
const typName = (z: Zelle): string =>
  z instanceof ExcelDatum ? 'Datum' : typeof z === 'boolean' ? 'Boolean' : typeof z === 'number' ? 'Zahl' : typeof z;
export const rohText = (z: Zelle | undefined): string => (istLeer(z) ? '' : String(z));

// ---------------------------------------------------------------- Header-Mapping (bbz-saq HEADER_FIELDS)

type Feld = { key: string; kandidaten: string[]; pflicht: 'beide' | 'issued' | 'nein' };

const runKey = (kind: Kind, teil: number, run: number, was: string) => `${kind}${teil}.run${run}.${was}`;
const teilKey = (kind: Kind, teil: number) => `${kind}${teil}.passed`;

function bildeFelder(): Feld[] {
  const f: Feld[] = [
    { key: 'nachname', kandidaten: ['Last Name'], pflicht: 'beide' },
    { key: 'vorname', kandidaten: ['First Name'], pflicht: 'beide' },
    { key: 'rolle', kandidaten: ['Role'], pflicht: 'beide' },
    { key: 'arbeitgeber', kandidaten: ['Employer'], pflicht: 'beide' },
    { key: 'profil', kandidaten: ['Certificate Program'], pflicht: 'beide' },
    { key: 'sprache', kandidaten: ['Certificate Language'], pflicht: 'beide' },
    { key: 'kommunikationssprache', kandidaten: ['Communication Language'], pflicht: 'nein' },
    { key: 'geburtsdatum', kandidaten: ['Birth Date'], pflicht: 'beide' },
    { key: 'zertifikatNr', kandidaten: ['Certificate Number'], pflicht: 'nein' },
    { key: 'zertifikatStart', kandidaten: ['Certificate Start Date'], pflicht: 'issued' },
    { key: 'zertifikatEnde', kandidaten: ['Certificate End Date'], pflicht: 'nein' },
  ];
  for (const [kind, label, raster] of [['we', 'WE', KUBA.we], ['oe', 'OE', KUBA.oe]] as const) {
    f.push({ key: `${kind}All`, kandidaten: [`${label} All Passed`, `${label} All yes`], pflicht: 'beide' });
    for (let t = 1; t <= raster.teile; t++) {
      f.push({ key: teilKey(kind, t), kandidaten: [`${label}${t} Passed`, `${label}${t} yes`], pflicht: 'beide' });
      for (let r = 1; r <= raster.runs; r++) {
        const run = `${label}${t} RUN${r}`;
        f.push({ key: runKey(kind, t, r, 'passed'), kandidaten: [`${run} Passed`, `${run} yes`], pflicht: 'beide' });
        f.push({ key: runKey(kind, t, r, 'date'), kandidaten: [`${run} Date`], pflicht: 'beide' });
        f.push({ key: runKey(kind, t, r, 'score'), kandidaten: [`${run} Score`], pflicht: 'beide' });
        f.push({ key: runKey(kind, t, r, 'result'), kandidaten: [`${run} Result`], pflicht: 'beide' });
        f.push({ key: runKey(kind, t, r, 'location'), kandidaten: [`${run} Location`], pflicht: 'nein' });
        if (kind === 'oe') {
          f.push({ key: runKey(kind, t, r, 'expert1'), kandidaten: [`${run} Expert 1`], pflicht: 'nein' });
          f.push({ key: runKey(kind, t, r, 'expert2'), kandidaten: [`${run} Expert 2`], pflicht: 'nein' });
        }
      }
    }
  }
  return f;
}

export const KUBA_FELDER: Feld[] = bildeFelder();
const FELD = new Map(KUBA_FELDER.map((f) => [f.key, f]));

const headerNorm = (h: unknown) => String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Feldschluessel -> Spaltenindex, ausschliesslich ueber die Header-Namen der Zeile 10. */
export function loeseHeader(header: string[], quelle: Quelle, sheet: string): Map<string, number> {
  const positionen = new Map<string, number[]>();
  header.forEach((h, i) => {
    const n = headerNorm(h);
    if (n) positionen.set(n, [...(positionen.get(n) ?? []), i]);
  });
  const map = new Map<string, number>();
  const fehlend: string[] = [];
  const doppelt: string[] = [];
  for (const f of KUBA_FELDER) {
    const treffer = f.kandidaten.flatMap((k) => positionen.get(headerNorm(k)) ?? []);
    if (treffer.length > 1) doppelt.push(treffer.map((i) => `«${header[i]}»`).join(', '));
    else if (treffer.length === 1) map.set(f.key, treffer[0]);
    else if (f.pflicht === 'beide' || (f.pflicht === 'issued' && quelle === 'issued')) fehlend.push(f.kandidaten.map((k) => `«${k}»`).join(' | '));
  }
  if (doppelt.length) throw new KubaStrukturFehler(`Sheet «${sheet}»: Header mehrdeutig (mehrfach vorhanden): ${doppelt.join('; ')}`);
  if (fehlend.length) throw new KubaStrukturFehler(`Sheet «${sheet}»: Pflicht-Header fehlen in Zeile ${KUBA.headerZeile}: ${fehlend.join(', ')}`);
  return map;
}

// ---------------------------------------------------------------- Arbeitsmappe lesen (SheetJS)

function zellwert(cell: XLSXns.CellObject | undefined): Zelle {
  if (!cell || cell.t === 'z') return null;
  if (cell.t === 's') return String(cell.v ?? '');
  if (cell.t === 'b') return Boolean(cell.v);
  if (cell.t === 'e') return cell.w ?? '#FEHLER';
  if (cell.t === 'd') return new ExcelDatum((new Date(cell.v as any).getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
  if (cell.t === 'n') {
    const v = Number(cell.v);
    return cell.z && XLSX.SSF.is_date(cell.z as string) ? new ExcelDatum(v) : v;
  }
  return cell.v === undefined ? null : String(cell.v);
}

/**
 * Liest beide KUBA-Sheets (andere Sheets werden nie geparst). Zeilen bis zur letzten belegten Zelle, Spalten bis
 * zum letzten nicht leeren Header. Fehlendes Sheet = KubaStrukturFehler.
 */
export function leseWorkbook(daten: Uint8Array): RohSheet[] {
  const namen = QUELLEN.map((q) => KUBA.sheets[q]);
  const wb = XLSX.read(daten, { type: 'array', cellDates: false, cellNF: true, sheets: namen });
  return QUELLEN.map((quelle) => {
    const sheet = KUBA.sheets[quelle];
    const ws = wb.Sheets[sheet];
    if (!ws) throw new KubaStrukturFehler(`Sheet «${sheet}» fehlt in der Excel-Datei (erwartet: ${namen.map((n) => `«${n}»`).join(' und ')})`);
    const hz = KUBA.headerZeile - 1;
    let letzteSpalte = -1;
    let letzteZeile = hz;
    for (const adr of Object.keys(ws)) {
      if (adr.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(adr);
      if (r === hz && !istLeer(zellwert(ws[adr]))) letzteSpalte = Math.max(letzteSpalte, c);
      if (r > letzteZeile) letzteZeile = r;
    }
    const header: string[] = [];
    for (let c = 0; c <= letzteSpalte; c++) header.push(rohText(zellwert(ws[XLSX.utils.encode_cell({ r: hz, c })])).trim());
    const zeilen: RohZeile[] = [];
    for (let r = hz + 1; r <= letzteZeile; r++) {
      const zellen: Zelle[] = [];
      for (let c = 0; c <= letzteSpalte; c++) zellen.push(zellwert(ws[XLSX.utils.encode_cell({ r, c })]));
      const b = ws[XLSX.utils.encode_cell({ r, c: KUBA.kommentarSpalte })] as (XLSXns.CellObject & { c?: { t?: string; T?: boolean }[] }) | undefined;
      const threaded = (b?.c ?? []).filter((k) => k.T).map((k) => k.t ?? '').join('\n');
      zeilen.push({ zeile: r + 1, zellen, kommentar: threaded || null });
    }
    return { quelle, sheet, header, zeilen };
  });
}

// ---------------------------------------------------------------- Normalisierung (bbz-saq Normalisierungstabelle)

type Erg<T> = { wert: T; grund?: string; stufe?: Stufe };
const ok = <T>(wert: T): Erg<T> => ({ wert });
const fehler = <T>(wert: T, grund: string): Erg<T> => ({ wert, grund, stufe: 'fehler' });
const hinweis = <T>(wert: T, grund: string): Erg<T> => ({ wert, grund, stufe: 'hinweis' });

export function parsePassed(z: Zelle): Erg<boolean | null> {
  if (istLeer(z)) return ok(null);
  if (typeof z !== 'string') return fehler(null, `Passed-Wert ist kein Text (${typName(z)})`);
  const t = z.trim().toLowerCase();
  if ((KUBA.passedJa as readonly string[]).includes(t)) return ok(true);
  if ((KUBA.passedNein as readonly string[]).includes(t)) return ok(false);
  return fehler(null, 'Passed-Wert nicht in Whitelist (yes/PASSED/fulfilled bzw. no/FAILED, Gross-/Kleinschreibung egal)');
}

export function parseSprache(z: Zelle): Erg<SaqSprache | null> {
  if (istLeer(z)) return ok(null);
  if (typeof z !== 'string') return fehler(null, `Sprache ist kein Text (${typName(z)})`);
  const t = z.trim().toUpperCase();
  const s = (SAQ.sprachen as string[]).includes(t) ? (t as SaqSprache) : SAQ.spracheAliase[t];
  return s ? ok(s) : fehler(null, `Sprache unbekannt (erlaubt: ${SAQ.sprachen.join(', ')})`);
}

export function parseProfil(z: Zelle): Erg<SaqProfil | null> {
  if (istLeer(z)) return ok(null);
  const t = String(z).trim().toUpperCase();
  const p = SAQ_PROFILE.find((x) => x.toUpperCase() === t) ?? SAQ_PROFIL_ALIASE[t];
  return p ? ok(p) : fehler(null, `Profil unbekannt (erlaubt: ${SAQ_PROFILE.join(', ')} sowie Aliase) – Vorgang wird nicht importiert`);
}

const EMPLOYER = new Map([
  ...Object.values(BANK_ALIASE).map((k) => [k.toUpperCase(), k] as const),
  ...Object.entries(BANK_ALIASE).map(([a, k]) => [a.toUpperCase(), k] as const),
]);

/** Arbeitgeber: Rohwert + kanonischer Name (Alias-Map aus bbz-saq); unbekannt -> Rohwert, kein DQ-Eintrag. */
export function parseArbeitgeber(z: Zelle): { roh: string | null; kanon: string | null } {
  const t = alsText(z);
  return { roh: t, kanon: t === null ? null : EMPLOYER.get(t.toUpperCase()) ?? t };
}

const RESULT_TEXT = /^\s*(\d+(?:[.,]\d+)?)\s*(%*)\s*$/;

function resultatAusZahl(n: number, gezeigt: string): Erg<number | null> {
  if (n >= 0 && n <= 1) return ok(n);
  if (n > 1 && n <= 100) return hinweis(n / 100, `Result «${gezeigt}» ohne Prozentzeichen und > 1 – als Prozentwert interpretiert (${n} % -> ${n / 100})`);
  return fehler(null, 'Result ausserhalb 0–100');
}

/** Result als Anteil 0–1 (bbz-saq parseResult): 0–1 = Anteil, >1–100 = Prozent (Hinweis), "89.00%" = 0.89. */
export function parseResultat(z: Zelle): Erg<number | null> {
  if (istLeer(z)) return ok(null);
  if (typeof z === 'number') return Number.isFinite(z) ? resultatAusZahl(z, String(z)) : fehler(null, 'Result ist keine gueltige Zahl');
  if (typeof z === 'string') {
    const m = RESULT_TEXT.exec(z);
    if (!m) return fehler(null, 'Result-Text nicht interpretierbar (erwartet z. B. «89.00%» oder eine Zahl)');
    const n = parseFloat(m[1].replace(',', '.'));
    if (m[2]) return n < 0 || n > 100 ? fehler(null, 'Result ausserhalb 0–100 %') : ok(n / 100);
    return resultatAusZahl(n, z.trim());
  }
  return fehler(null, `Result hat unerwarteten Typ (${typName(z)})`);
}

/** Score (fliesst in keine Kennzahl, bbz-saq E6): ganze Zahl >= 0, sonst "nicht ausgewertet". */
export function parseScore(z: Zelle): Erg<number | null> {
  if (istLeer(z)) return ok(null);
  if (typeof z === 'number' && Number.isInteger(z) && z >= 0 && z <= KUBA.maxScore) return ok(z);
  return { wert: null, grund: 'Score ist keine ganze Zahl zwischen 0 und 9999 – Feld wird nicht uebernommen (Result ist massgebend; vermutlich verrutschte Zelle)', stufe: 'nicht-ausgewertet' };
}

const DATUM_TEXT = /^\s*(\d{1,2})[.,](\d{1,2})[.,](\d{2}|\d{4})(?:\s*\/\s*(\d{1,2})[.:](\d{2})\s*(?:h|uhr)?)?\s*$/i;
const DATUM_OHNE_JAHR = /^\s*\d{1,2}\.\d{1,2}\.\s*(?:\/.*)?$/;
const DATUM_3_JAHR = /^\s*\d{1,2}[.,]\d{1,2}[.,]\d{3}\s*(?:\/.*)?$/;

type DatumRegeln = { minJahr: number; maxJahr: number; serialMin: number; serialMax: number };

function datumMit(z: Zelle, regeln: DatumRegeln): Erg<string | null> {
  if (istLeer(z)) return ok(null);
  const plausibel = (iso: string): Erg<string | null> => {
    const j = Number(iso.slice(0, 4));
    return j >= regeln.minJahr && j <= regeln.maxJahr ? ok(iso) : fehler(null, `Jahr unplausibel (${j}), erwartet ${regeln.minJahr}–${regeln.maxJahr}`);
  };
  if (z instanceof ExcelDatum) return Number.isFinite(z.serial) ? plausibel(z.iso) : fehler(null, 'Datum ungueltig');
  if (typeof z === 'number') {
    if (Number.isFinite(z) && z >= regeln.serialMin && z <= regeln.serialMax) {
      return hinweis(serialZuIso(z), `Datum als Zahl ohne Datumsformat (${z}), als Excel-Serienzahl interpretiert (${serialZuIso(z)})`);
    }
    return fehler(null, `Datum liegt als Zahl vor (${z}), keine plausible Excel-Serienzahl`);
  }
  if (typeof z !== 'string') return fehler(null, `Datum hat unerwarteten Typ (${typName(z)})`);
  const m = DATUM_TEXT.exec(z);
  if (!m) {
    if (DATUM_OHNE_JAHR.test(z)) return fehler(null, 'Datum ohne Jahr (z. B. «27.04. / 09:00») – Jahr in der Datei ergaenzen');
    if (DATUM_3_JAHR.test(z)) return fehler(null, 'Datum mit dreistelligem Jahr (Tippfehler)');
    return fehler(null, 'Datum nicht interpretierbar (erwartet dd.mm.yy(yy)[ / hh.mm])');
  }
  const tag = Number(m[1]); const monat = Number(m[2]);
  const jahr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const tageImMonat = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  if (monat < 1 || monat > 12 || tag < 1 || tag > tageImMonat) return fehler(null, 'Datum ungueltig (Tag/Monat)');
  if ((m[4] !== undefined && Number(m[4]) > 23) || (m[5] !== undefined && Number(m[5]) > 59)) return fehler(null, 'Uhrzeit ungueltig');
  return plausibel(`${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`);
}

export const parseDatum = (z: Zelle) => datumMit(z, KUBA.datum);
export const parseGeburtsdatum = (z: Zelle) => datumMit(z, KUBA.geburtsdatum);

/** Experte (nur Name): leer -> null; Zahl oder Zahlentext -> Fehler; Mehrfach-Leerzeichen werden vereinheitlicht. */
export function parseExperte(z: Zelle): Erg<string | null> {
  if (istLeer(z)) return ok(null);
  if (typeof z !== 'string' && typeof z !== 'number') return fehler(null, `Experte nicht lesbar (${typName(z)})`);
  const t = String(z).trim().replace(/\s+/g, ' ');
  if (typeof z === 'number' || /^\d+([.,]\d+)?$/.test(t)) return fehler(null, `Experte nicht lesbar (Zahl «${t}»)`);
  return ok(t);
}

/** bbz-saq normalizeNamePart: ohne Akzente, ss statt ß, Kleinbuchstaben, nur Buchstaben/Ziffern. */
export function normalisiereNamensteil(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Personenschluessel "nachname|vorname|YYYY-MM-DD" (ohne Geburtsdatum bleibt der dritte Teil leer). */
export function personenSchluessel(nachname: string | null, vorname: string | null, geburtsdatum: string | null): string {
  return `${normalisiereNamensteil(nachname)}|${normalisiereNamensteil(vorname)}|${geburtsdatum ?? ''}`;
}

export function statusAus(wert: boolean | null, roh: Zelle): KubaStatus {
  if (wert === true) return 'bestanden';
  if (wert === false) return 'nicht bestanden';
  return istLeer(roh) ? 'offen' : 'nicht erfasst';
}

export function kombiniereStatus(we: KubaStatus, oe: KubaStatus): KubaStatus {
  if (we === 'nicht bestanden' || oe === 'nicht bestanden') return 'nicht bestanden';
  if (we === 'bestanden' && oe === 'bestanden') return 'bestanden';
  if (we === 'nicht erfasst' || oe === 'nicht erfasst') return 'nicht erfasst';
  return 'offen';
}

// ---------------------------------------------------------------- Vorgang

export type KubaRun = {
  art: SaqPruefungArt; teil: number; run: number; passed: boolean | null; datum: string | null; score: number | null;
  /** Anteil 0–1 wie bbz-saq */
  resultat: number | null; ort: string | null; experte1: string | null; experte2: string | null;
};

export type ErpRun = {
  art: SaqPruefungArt; teil: number; run: number; datum: string; bestanden: boolean | null; resultatProzent: number | null;
  score: number | null; ort: string | null; remote: boolean; experte1: string | null; experte2: string | null;
};

export type ErpAbbildung = {
  status: SaqStatus; sprache: SaqSprache; kennzeichnung: string | null; runs: ErpRun[];
  zertifikat: { nr: string | null; ausgestelltAm: string; gueltigBis: string } | null;
};

export type KubaVorgang = {
  quelle: Quelle; sheet: string; zeile: number;
  /** "Sheet:Zeile" der behaltenen Zeile, danach die zusammengefuehrten Duplikate */
  herkunft: string[];
  nachname: string | null; vorname: string | null; geburtsdatum: string | null;
  personKey: string; schluesselStufe: 'voll' | 'nur-name';
  rolle: string | null; arbeitgeber: string | null; arbeitgeberKanon: string | null;
  profil: SaqProfil | null; profilRoh: string | null;
  sprache: SaqSprache | null; kommunikationssprache: SaqSprache | null;
  zertifikatNr: string | null; zertifikatStart: string | null; zertifikatEnde: string | null;
  teile: { art: SaqPruefungArt; teil: number; passed: boolean | null }[];
  runs: KubaRun[];
  weAll: boolean | null; oeAll: boolean | null; weStatus: KubaStatus; oeStatus: KubaStatus; status: KubaStatus;
  ausgestellt: boolean; vss: boolean; vsm: boolean;
  absolvierteRuns: number;
  /** ERP-Abbildung; null = nicht importierbar (Grund in `nichtImportierbar`) */
  erp: ErpAbbildung | null;
  nichtImportierbar: string | null;
  /** Header-Namen des Sheets der behaltenen Zeile (fuer DQ-Eintraege nach der Zusammenfuehrung) */
  headerName: (key: string) => string;
};

export type KubaErgebnis = {
  vorgaenge: KubaVorgang[];
  dq: DqEintrag[];
  zaehler: {
    zeilen: Record<Quelle, number>; ohneName: number; vorgaenge: number; duplikate: number; profilKonflikte: number;
    personen: number; ohneGeburtsdatum: number; mehrereProfile: number;
  };
};

const kuerzel = (art: SaqPruefungArt) => (art === 'schriftlich' ? 'WE' : 'OE');
const runLabel = (r: { art: SaqPruefungArt; teil: number; run: number }) => `${kuerzel(r.art)}${r.teil} RUN${r.run}`;
const prozent = (x: number) => `${(x * 100).toFixed(1)} %`;

function normalisiereSheet(roh: RohSheet, heute: string, dq: DqEintrag[]): { vorgaenge: KubaVorgang[]; zeilen: number; ohneName: number } {
  const map = loeseHeader(roh.header, roh.quelle, roh.sheet);
  const gemappt = [...map.values()];
  const headerName = (key: string) => (map.has(key) ? roh.header[map.get(key)!] : FELD.get(key)?.kandidaten[0] ?? key);
  const vorgaenge: KubaVorgang[] = [];
  let zeilen = 0; let ohneName = 0;

  for (const { zeile, zellen, kommentar } of roh.zeilen) {
    // Leer = kein Inhalt in einer gemappten Spalte (Hilfsspalten wie Nummerierungen zaehlen nicht)
    if (!gemappt.some((i) => !istLeer(zellen[i]))) continue;
    zeilen++;
    const get = (key: string): Zelle => (map.has(key) ? zellen[map.get(key)!] ?? null : null);
    const log = (key: string, z: Zelle, grund: string, stufe: Stufe) =>
      dq.push({ stufe, sheet: roh.sheet, zeile, header: headerName(key), roh: rohText(z), grund });
    const feld = <T>(key: string, parser: (z: Zelle) => Erg<T>): T => {
      const z = get(key);
      const e = parser(z);
      if (e.grund) log(key, z, e.grund, e.stufe ?? 'fehler');
      return e.wert;
    };

    const nachname = alsText(get('nachname'));
    const vorname = alsText(get('vorname'));
    if (nachname === null && vorname === null) {
      const belegt = gemappt.filter((i) => !istLeer(zellen[i])).map((i) => roh.header[i]);
      log('nachname', get('nachname'), `Name fehlt (Daten in: ${belegt.slice(0, 6).join(', ')}${belegt.length > 6 ? ' …' : ''}) – Zeile wird nicht uebernommen`, 'fehler');
      ohneName++;
      continue;
    }

    const runs: KubaRun[] = [];
    const teile: KubaVorgang['teile'] = [];
    for (const [kind, raster] of [['we', KUBA.we], ['oe', KUBA.oe]] as const) {
      for (let t = 1; t <= raster.teile; t++) {
        for (let r = 1; r <= raster.runs; r++) {
          const k = (was: string) => runKey(kind, t, r, was);
          const run: KubaRun = {
            art: ART[kind], teil: t, run: r,
            passed: feld(k('passed'), parsePassed),
            datum: feld(k('date'), parseDatum),
            score: feld(k('score'), parseScore),
            resultat: feld(k('result'), parseResultat),
            ort: map.has(k('location')) ? alsText(get(k('location'))) : null,
            experte1: kind === 'oe' && map.has(k('expert1')) ? feld(k('expert1'), parseExperte) : null,
            experte2: kind === 'oe' && map.has(k('expert2')) ? feld(k('expert2'), parseExperte) : null,
          };
          if (run.experte1 && run.experte2 && normalisiereNamensteil(run.experte1) === normalisiereNamensteil(run.experte2)) {
            log(k('expert2'), get(k('expert2')), 'Experte 1 = Experte 2 – beide Felder nennen dieselbe Person; Experte 2 wird nicht uebernommen', 'hinweis');
            run.experte2 = null;
          }
          if (run.passed === null && istLeer(get(k('passed'))) && run.datum !== null && run.datum <= heute) {
            log(k('passed'), get(k('passed')), 'Pruefungsdatum vergangen, aber kein Passed-Wert (Ergebnis ausstehend oder nicht erfasst) – Run wird ohne Ergebnis uebernommen', 'hinweis');
          }
          if (run.passed !== null && run.datum !== null && run.datum > heute) {
            log(k('date'), get(k('date')), 'Passed-Wert erfasst, aber Pruefungsdatum liegt in der Zukunft', 'hinweis');
          }
          if (run.passed !== null && run.resultat !== null) {
            const grenze = ` der Bestehensgrenze von ${prozent(KUBA.bestehensgrenze)} – Passed-Wert oder Resultat pruefen (massgebend ist Passed)`;
            if (run.passed && run.resultat < KUBA.bestehensgrenze) log(k('result'), get(k('result')), `Als bestanden erfasst, aber Resultat ${prozent(run.resultat)} liegt unter${grenze}`, 'hinweis');
            if (!run.passed && run.resultat >= KUBA.bestehensgrenze) log(k('result'), get(k('result')), `Als nicht bestanden erfasst, aber Resultat ${prozent(run.resultat)} liegt auf oder ueber${grenze}`, 'hinweis');
          }
          runs.push(run);
        }
        teile.push({ art: ART[kind], teil: t, passed: feld(teilKey(kind, t), parsePassed) });
      }
    }

    const profil = feld('profil', parseProfil);
    const profilRoh = alsText(get('profil'));
    const { roh: arbeitgeber, kanon: arbeitgeberKanon } = parseArbeitgeber(get('arbeitgeber'));
    const geburtsdatum = feld('geburtsdatum', parseGeburtsdatum);
    const kommunikation = map.has('kommunikationssprache') ? parseSprache(get('kommunikationssprache')).wert : null;

    // Sprache: Certificate Language; leer -> Programmbezeichnung (PK FRZ -> FR) -> Communication Language (bbz-saq)
    let sprache = feld('sprache', parseSprache);
    if (sprache === null) {
      const zustand = istLeer(get('sprache')) ? 'leer' : 'unlesbar';
      const ausProgramm = profilRoh ? KUBA.programmSprache[profilRoh.toUpperCase()] : undefined;
      if (ausProgramm) {
        sprache = ausProgramm;
        log('sprache', get('sprache'), `Certificate Language ${zustand} – Sprache aus Programmbezeichnung «${profilRoh}» uebernommen (${ausProgramm})`, 'hinweis');
      } else if (kommunikation) {
        sprache = kommunikation;
        log('sprache', get('sprache'), `Certificate Language ${zustand} – Sprache aus «Communication Language» uebernommen (${kommunikation})`, 'hinweis');
      } else if (!istLeer(get('kommunikationssprache'))) {
        log('kommunikationssprache', get('kommunikationssprache'), 'Certificate Language leer oder unlesbar und Communication Language nicht deutbar', 'hinweis');
      }
    }

    let weAll = feld('weAll', parsePassed);
    let oeAll = feld('oeAll', parsePassed);
    // "Ausgestellte Zertifikate": Zertifikat setzt schriftlich und muendlich voraus -> leere Gesamtergebnisse = bestanden
    if (roh.quelle === 'issued') {
      if (istLeer(get('weAll'))) { weAll = true; log('weAll', get('weAll'), 'WE All leer bei ausgestelltem Zertifikat – schriftlich als bestanden uebernommen', 'hinweis'); }
      if (istLeer(get('oeAll'))) { oeAll = true; log('oeAll', get('oeAll'), 'OE All leer bei ausgestelltem Zertifikat – muendlich als bestanden uebernommen', 'hinweis'); }
    }
    if (runs.some((r) => r.art === 'muendlich' && r.passed !== null) && weAll !== true && (weAll === false || istLeer(get('weAll')))) {
      log('weAll', get('weAll'), 'Muendliche Pruefung mit Ergebnis erfasst, aber schriftliche Pruefung nicht als bestanden markiert (Voraussetzung fuer muendlich)', 'hinweis');
    }
    const weStatus = statusAus(weAll, get('weAll'));
    const oeStatus = statusAus(oeAll, get('oeAll'));
    if (geburtsdatum === null) {
      log('geburtsdatum', get('geburtsdatum'), 'Geburtsdatum fehlt oder unlesbar – Person wird nur ueber den Namen erkannt (Verwechslungsgefahr bei Namensgleichheit)', 'hinweis');
    }
    const text = kommentar ?? '';
    vorgaenge.push({
      quelle: roh.quelle, sheet: roh.sheet, zeile, herkunft: [`${roh.sheet}:${zeile}`],
      nachname, vorname, geburtsdatum, personKey: personenSchluessel(nachname, vorname, geburtsdatum),
      schluesselStufe: geburtsdatum ? 'voll' : 'nur-name',
      rolle: alsText(get('rolle')), arbeitgeber, arbeitgeberKanon, profil, profilRoh, sprache, kommunikationssprache: kommunikation,
      zertifikatNr: map.has('zertifikatNr') ? alsText(get('zertifikatNr')) : null,
      zertifikatStart: map.has('zertifikatStart') ? feld('zertifikatStart', parseDatum) : null,
      zertifikatEnde: map.has('zertifikatEnde') ? feld('zertifikatEnde', parseDatum) : null,
      teile, runs, weAll, oeAll, weStatus, oeStatus, status: kombiniereStatus(weStatus, oeStatus),
      ausgestellt: roh.quelle === 'issued', vss: /\bVSS\b/i.test(text), vsm: /\bVSM\b/i.test(text),
      absolvierteRuns: runs.filter((r) => r.passed !== null).length,
      erp: null, nichtImportierbar: null, headerName,
    });
  }
  return { vorgaenge, zeilen, ohneName };
}

// ---------------------------------------------------------------- Duplikate (bbz-saq linkPersons / mergeVorgang)

/** Widerspruch: derselbe Run hat in beiden Zeilen ein Datum bzw. einen Passed-Wert, und diese weichen ab. */
export function runKonflikte(a: { runs: KubaRun[] }, b: { runs: KubaRun[] }): string[] {
  const andere = new Map(b.runs.map((r) => [runLabel(r), r]));
  const k: string[] = [];
  for (const r of a.runs) {
    const o = andere.get(runLabel(r));
    if (!o) continue;
    if (r.datum && o.datum && r.datum !== o.datum) k.push(`${runLabel(r)} Date`);
    if (r.passed !== null && o.passed !== null && r.passed !== o.passed) k.push(`${runLabel(r)} Passed`);
  }
  return k;
}

function fuelle<T extends object>(ziel: T, quelle: T, felder: (keyof T)[]): void {
  for (const f of felder) if (ziel[f] === null && quelle[f] !== null) ziel[f] = quelle[f];
}

/** Luecken des behaltenen Vorgangs aus dem Duplikat auffuellen – nie ueberschreiben. */
function fuehreZusammen(keep: KubaVorgang, dup: KubaVorgang): void {
  keep.runs.forEach((r, i) => {
    const o = dup.runs[i];
    fuelle(r, o, ['passed', 'datum', 'score', 'resultat', 'ort']);
    if (!r.experte1 && !r.experte2 && (o.experte1 || o.experte2)) { r.experte1 = o.experte1; r.experte2 = o.experte2; }
  });
  keep.teile.forEach((t, i) => fuelle(t, dup.teile[i], ['passed']));
  if (keep.weAll === null && dup.weAll !== null) { keep.weAll = dup.weAll; keep.weStatus = dup.weStatus; }
  if (keep.oeAll === null && dup.oeAll !== null) { keep.oeAll = dup.oeAll; keep.oeStatus = dup.oeStatus; }
  fuelle(keep, dup, ['zertifikatNr', 'zertifikatStart', 'zertifikatEnde', 'geburtsdatum', 'profil', 'sprache', 'kommunikationssprache', 'arbeitgeber', 'arbeitgeberKanon', 'rolle']);
  keep.vss ||= dup.vss;
  keep.vsm ||= dup.vsm;
  keep.ausgestellt ||= dup.ausgestellt;
  keep.herkunft.push(...dup.herkunft);
  keep.absolvierteRuns = keep.runs.filter((r) => r.passed !== null).length;
  keep.status = kombiniereStatus(keep.weStatus, keep.oeStatus);
}

function verknuepfe(alle: KubaVorgang[], dq: DqEintrag[]): { vorgaenge: KubaVorgang[]; duplikate: number; profilKonflikte: number } {
  const jePerson = new Map<string, { v: KubaVorgang; i: number }[]>();
  alle.forEach((v, i) => jePerson.set(v.personKey, [...(jePerson.get(v.personKey) ?? []), { v, i }]));
  const entfernt = new Set<KubaVorgang>();
  let duplikate = 0; let profilKonflikte = 0;
  for (const eintraege of jePerson.values()) {
    const jeProfil = new Map<string, { v: KubaVorgang; i: number }[]>();
    for (const e of eintraege) {
      const k = e.v.profil ?? `?${e.v.profilRoh ?? ''}`;
      jeProfil.set(k, [...(jeProfil.get(k) ?? []), e]);
    }
    for (const kandidaten of jeProfil.values()) {
      if (kandidaten.length < 2) continue;
      // Cluster kompatibler Zeilen: jede Zeile kommt zum ersten Cluster, dem sie nicht widerspricht
      const cluster: { v: KubaVorgang; i: number }[][] = [];
      for (const e of kandidaten) {
        const ziel = cluster.find((c) => c.every((o) => runKonflikte(e.v, o.v).length === 0));
        if (ziel) ziel.push(e); else cluster.push([e]);
      }
      const erster = cluster[0][0].v;
      for (const c of cluster.slice(1)) {
        const v = c[0].v;
        profilKonflikte++;
        dq.push({
          stufe: 'hinweis', sheet: v.sheet, zeile: v.zeile, header: v.headerName('profil'), roh: v.profilRoh ?? '',
          grund: `Gleiche Person und gleiches Profil wie «${erster.sheet}» Zeile ${erster.zeile}, aber abweichende Pruefungsdaten (${runKonflikte(v, erster).join(', ')}) – als eigener Vorgang uebernommen (Wiederholung?)`,
        });
      }
      for (const c of cluster) {
        if (c.length < 2) continue;
        const sortiert = [...c].sort((a, b) => (b.v.absolvierteRuns - a.v.absolvierteRuns)
          || (Number(b.v.quelle === 'issued') - Number(a.v.quelle === 'issued')) || (a.i - b.i));
        const keep = sortiert[0].v;
        for (const { v: dup } of sortiert.slice(1)) {
          fuehreZusammen(keep, dup);
          entfernt.add(dup);
          duplikate++;
          dq.push({
            stufe: 'hinweis', sheet: dup.sheet, zeile: dup.zeile, header: dup.headerName('nachname'), roh: '',
            grund: `Duplikat: derselbe Zertifizierungsvorgang wie «${keep.sheet}» Zeile ${keep.zeile} (gleiche Person, gleiches Profil, keine abweichenden Pruefungsdaten) – zusammengefuehrt, zaehlt nicht doppelt`,
          });
        }
      }
    }
  }
  return { vorgaenge: alle.filter((v) => !entfernt.has(v)), duplikate, profilKonflikte };
}

// ---------------------------------------------------------------- Profilvorgabe und ERP-Abbildung

function pruefeVorgabe(v: KubaVorgang, dq: DqEintrag[]): void {
  if (!v.profil) return;
  const vorgabe = SAQ_TEILE[v.profil];
  const log = (key: string, grund: string) => dq.push({ stufe: 'hinweis', sheet: v.sheet, zeile: v.zeile, header: v.headerName(key), roh: '', grund });
  for (const art of ['schriftlich', 'muendlich'] as const) {
    const ausserhalb = [...new Set(v.runs.filter((r) => r.art === art && r.passed !== null && !vorgabe[art].includes(r.teil)).map((r) => r.teil))];
    for (const t of ausserhalb) {
      log(teilKey(KIND[art], t), `Absolvierter Run in ${kuerzel(art)}${t}, aber die Vorgabe fuer ${v.profil} umfasst nur ${vorgabe[art].map((x) => `${kuerzel(art)}${x}`).join(', ')} – Run wird uebernommen, zaehlt im ERP aber nicht als Pflichtteil`);
    }
    const status = art === 'schriftlich' ? v.weStatus : v.oeStatus;
    const komplett = vorgabe[art].every((t) => v.teile.find((x) => x.art === art && x.teil === t)?.passed === true
      || v.runs.some((r) => r.art === art && r.teil === t && r.passed === true));
    if (status === 'offen' && komplett) {
      log(`${KIND[art]}All`, `Alle Teilpruefungen der Vorgabe fuer ${v.profil} (${vorgabe[art].map((x) => `${kuerzel(art)}${x}`).join(', ')}) bestanden, aber Gesamtergebnis leer – Vorgang bleibt offen; vermutlich fehlt «yes»`);
    }
  }
}

/**
 * ERP-Abbildung eines Vorgangs. Status (saq_fall.status):
 *   bestanden + Zertifikat (Sheet "Ausgestellte Zertifikate" oder Certificate Number/Start Date) mit Startdatum -> zertifiziert
 *   bestanden -> bestanden; nicht bestanden -> nicht_bestanden;
 *   sonst offen: schriftlich bestanden -> schriftlich_bestanden, mit Run -> in_pruefung, sonst angemeldet.
 * Runs nur mit Datum (saq_pruefung.datum ist Pflicht); Resultat in Prozent; Experten nur muendlich.
 */
export function erpAbbildung(v: KubaVorgang, log: (key: string, grund: string, stufe?: Stufe) => void): ErpAbbildung | null {
  if (!v.profil) return null;
  const runs: ErpRun[] = [];
  for (const r of v.runs) {
    const inhalt = r.passed !== null || (r.resultat ?? 0) !== 0 || (r.score ?? 0) !== 0 || r.ort || r.experte1 || r.experte2;
    if (!r.datum) {
      if (inhalt) log(runKey(KIND[r.art], r.teil, r.run, 'date'), `${runLabel(r)}: ${r.passed !== null ? 'Passed-Wert' : 'Run-Daten'} erfasst, aber kein Pruefungsdatum – Run wird nicht ins ERP uebernommen (Datum ist Pflicht)`);
      continue;
    }
    // Ohne Passed-Wert sind Result/Score = 0 Formelvorgaben der Datei (bbz-saq), kein Resultat
    const vorgabe = (x: number | null) => r.passed === null && x === 0;
    runs.push({
      art: r.art, teil: r.teil, run: r.run, datum: r.datum, bestanden: r.passed,
      resultatProzent: r.resultat === null || vorgabe(r.resultat) ? null : Math.round(r.resultat * 10_000) / 100,
      score: vorgabe(r.score) ? null : r.score, ort: r.ort, remote: /^(remote|online)$/i.test(r.ort ?? ''),
      experte1: r.art === 'muendlich' ? r.experte1 : null, experte2: r.art === 'muendlich' ? r.experte2 : null,
    });
  }
  let sprache = v.sprache;
  if (!sprache) {
    sprache = 'DE';
    log('sprache', 'Keine Sprache ermittelbar – im ERP als DE erfasst (saq_fall.sprache ist Pflicht)');
  }
  const zertDaten = v.ausgestellt || v.zertifikatNr !== null || v.zertifikatStart !== null;
  let status: SaqStatus;
  let zertifikat: ErpAbbildung['zertifikat'] = null;
  if (v.status === 'bestanden') {
    status = 'bestanden';
    if (zertDaten && v.zertifikatStart) {
      status = 'zertifiziert';
      let bis = v.zertifikatEnde;
      if (bis && bis <= v.zertifikatStart) {
        log('zertifikatEnde', `Certificate End Date ${bis} liegt nicht nach dem Start ${v.zertifikatStart} – Gueltigkeit 3 Jahre ab Start angenommen`);
        bis = null;
      }
      zertifikat = { nr: v.zertifikatNr, ausgestelltAm: v.zertifikatStart, gueltigBis: bis ?? gueltigBis(v.zertifikatStart) };
    } else if (zertDaten) {
      log('zertifikatStart', 'Zertifikat ausgestellt, aber Certificate Start Date fehlt oder unlesbar – Status bestanden, Zertifikat im ERP nicht angelegt (nachtragen)');
    }
  } else if (v.status === 'nicht bestanden') {
    status = 'nicht_bestanden';
    if (zertDaten && v.zertifikatStart) log('zertifikatStart', 'Zertifikatsdaten vorhanden, aber Vorgang nicht bestanden – Zertifikat im ERP nicht angelegt');
  } else {
    status = v.weStatus === 'bestanden' ? 'schriftlich_bestanden' : runs.length ? 'in_pruefung' : 'angemeldet';
    if (zertDaten && v.zertifikatStart) log('zertifikatStart', 'Zertifikatsdaten vorhanden, aber Gesamtergebnis offen – Zertifikat im ERP nicht angelegt');
  }
  const kennzeichnung = [v.vss ? 'VSS' : null, v.vsm ? 'VSM' : null].filter(Boolean).join(', ') || null;
  return { status, sprache, kennzeichnung, runs, zertifikat };
}

/**
 * Beide Sheets -> Vorgaenge (Duplikate zusammengefuehrt) + Data-Quality-Log + Zaehler.
 * heute = Stichtag (YYYY-MM-DD) fuer "Datum vergangen/in der Zukunft".
 */
export function normalisiere(sheets: RohSheet[], heute: string): KubaErgebnis {
  const dq: DqEintrag[] = [];
  const alle: KubaVorgang[] = [];
  const zeilen: Record<Quelle, number> = { first: 0, issued: 0 };
  let ohneName = 0;
  for (const s of sheets) {
    const e = normalisiereSheet(s, heute, dq);
    alle.push(...e.vorgaenge);
    zeilen[s.quelle] += e.zeilen;
    ohneName += e.ohneName;
  }
  const { vorgaenge, duplikate, profilKonflikte } = verknuepfe(alle, dq);
  for (const v of vorgaenge) {
    pruefeVorgabe(v, dq);
    v.erp = erpAbbildung(v, (key, grund, stufe = 'hinweis') => dq.push({ stufe, sheet: v.sheet, zeile: v.zeile, header: v.headerName(key), roh: '', grund }));
    if (!v.erp) v.nichtImportierbar = v.profilRoh ? `Profil «${v.profilRoh}» unbekannt` : 'Certificate Program leer';
    if (!v.erp && !v.profilRoh) dq.push({ stufe: 'fehler', sheet: v.sheet, zeile: v.zeile, header: v.headerName('profil'), roh: '', grund: 'Certificate Program leer – Vorgang wird nicht importiert' });
  }
  const personen = new Map<string, Set<string>>();
  for (const v of vorgaenge) personen.set(v.personKey, (personen.get(v.personKey) ?? new Set()).add(v.profil ?? '?'));
  const reihenfolge = (d: DqEintrag) => `${d.sheet === KUBA.sheets.first ? 0 : 1}|${String(d.zeile).padStart(7, '0')}`;
  dq.sort((a, b) => reihenfolge(a).localeCompare(reihenfolge(b)));
  return {
    vorgaenge, dq,
    zaehler: {
      zeilen, ohneName, vorgaenge: vorgaenge.length, duplikate, profilKonflikte, personen: personen.size,
      ohneGeburtsdatum: vorgaenge.filter((v) => v.schluesselStufe === 'nur-name').length,
      mehrereProfile: [...personen.values()].filter((p) => p.size > 1).length,
    },
  };
}

/** Datei lesen und normalisieren (Strukturfehler werfen KubaStrukturFehler). */
export function leseKuba(daten: Uint8Array, heute: string): KubaErgebnis {
  return normalisiere(leseWorkbook(daten), heute);
}

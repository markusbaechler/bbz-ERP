import { ValidationError, ConflictError } from './errors';
import type { DurchfuehrungStatus } from './bildungTypes';

// ---------------------------------------------------------------------------------------------
// Datumsrechnung auf 'YYYY-MM-DD'-Strings (UTC-Arithmetik, damit Sommerzeit keine Tage verschiebt)
// ---------------------------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_MS = 86_400_000;

export function istIsoDatum(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function pruefeDatum(s: unknown, feld: string): string {
  if (!istIsoDatum(s)) throw new ValidationError(`${feld} muss ein Datum YYYY-MM-DD sein`);
  return s;
}

const utc = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addTage(datum: string, tage: number): string {
  return iso(utc(datum) + tage * TAG_MS);
}

/** Monate addieren; am Monatsende wird auf den letzten Tag des Zielmonats begrenzt (31.01. + 1 = 28.02.). */
export function addMonate(datum: string, monate: number): string {
  const [y, m, d] = datum.split('-').map(Number);
  const ziel = new Date(Date.UTC(y, m - 1 + monate, 1));
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate();
  ziel.setUTCDate(Math.min(d, letzter));
  return iso(ziel.getTime());
}

/** Anzahl Tage von `von` bis `bis` (negativ, wenn `bis` vor `von` liegt). */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((utc(bis) - utc(von)) / TAG_MS);
}

/** Heutiges Datum in der Schweiz (Europe/Zurich) als 'YYYY-MM-DD'. */
export function heuteIso(jetzt: Date = new Date()): string {
  return datumInZuerich(jetzt);
}

export function datumInZuerich(zeitpunkt: Date): string {
  return zeitpunkt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
}

/** Postgres liefert time als 'HH:MM:SS'; nach aussen genuegt 'HH:MM'. */
export function zeitKurz(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

// ---------------------------------------------------------------------------------------------
// Kursplanung
// ---------------------------------------------------------------------------------------------

/** Alle Werktage (Mo-Fr) zwischen Start und Ende, beide inklusive. Feiertage werden nicht beruecksichtigt. */
export function werktageZwischen(start: string, ende: string): string[] {
  pruefeDatum(start, 'startDatum');
  pruefeDatum(ende, 'endDatum');
  if (ende < start) throw new ValidationError('endDatum liegt vor startDatum');
  const tage: string[] = [];
  for (let t = utc(start); t <= utc(ende); t += TAG_MS) {
    const wt = new Date(t).getUTCDay();
    if (wt !== 0 && wt !== 6) tage.push(iso(t));
  }
  return tage;
}

const ZEIT_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Kurstag pruefen: Datum innerhalb der Durchfuehrung, Zeiten HH:MM, `bis` nach `von`. Zeiten werden auf HH:MM gekuerzt. */
export function pruefeKurstag<T extends { datum: string; von?: string | null; bis?: string | null }>(k: T, start: string, ende: string): T {
  pruefeDatum(k.datum, 'kurstag.datum');
  if (k.datum < start || k.datum > ende) {
    throw new ValidationError(`Kurstag ${k.datum} liegt ausserhalb der Durchfuehrung (${start} bis ${ende})`);
  }
  for (const f of ['von', 'bis'] as const) {
    const v = k[f];
    if (v !== undefined && v !== null && !ZEIT_RE.test(v)) throw new ValidationError(`${f} muss eine Uhrzeit HH:MM sein`);
  }
  const von = zeitKurz(k.von); const bis = zeitKurz(k.bis);
  if (von && bis && von >= bis) throw new ValidationError('bis muss nach von liegen');
  return { ...k, von: von ?? null, bis: bis ?? null };
}

const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };

/** URL-tauglicher Slug: deutsche Umlaute ausgeschrieben, Akzente entfernt, alles andere zu Bindestrichen. */
export function slugify(text: string): string {
  return text
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTE[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function durchfuehrungsCode(angebotCode: string, jahr: number, n: number): string {
  return `${angebotCode}-${jahr}-${n}`;
}

/** Naechste laufende Nummer fuer {ANGEBOT}-{JAHR}-{n}: hoechste bestehende Nummer + 1 (Luecken bleiben Luecken). */
export function naechsteDurchfuehrungsNummer(bestehendeCodes: (string | null)[], angebotCode: string, jahr: number): number {
  const praefix = `${angebotCode}-${jahr}-`;
  let max = 0;
  for (const c of bestehendeCodes) {
    if (!c || !c.startsWith(praefix)) continue;
    const rest = c.slice(praefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return max + 1;
}

const DURCHFUEHRUNG_STATUS: DurchfuehrungStatus[] = ['geplant', 'ausgeschrieben', 'bestaetigt', 'durchgefuehrt', 'abgesagt'];
const NAECHSTER: Partial<Record<DurchfuehrungStatus, DurchfuehrungStatus>> = {
  geplant: 'ausgeschrieben', ausgeschrieben: 'bestaetigt', bestaetigt: 'durchgefuehrt',
};

/**
 * Uebergaenge: geplant -> ausgeschrieben -> bestaetigt -> durchgefuehrt; jeder nicht-finale Status -> abgesagt.
 * `ausgeschrieben` verlangt mindestens einen Kurstag.
 */
export function pruefeDurchfuehrungsStatus(von: DurchfuehrungStatus, nach: DurchfuehrungStatus, anzahlKurstage: number): void {
  if (!DURCHFUEHRUNG_STATUS.includes(nach)) throw new ValidationError(`Unbekannter Status: ${nach}`);
  const erlaubt = nach === 'abgesagt' ? von !== 'durchgefuehrt' && von !== 'abgesagt' : NAECHSTER[von] === nach;
  if (!erlaubt) throw new ConflictError(`Statuswechsel ${von} -> ${nach} nicht erlaubt`);
  if (nach === 'ausgeschrieben' && anzahlKurstage < 1) throw new ConflictError('Ausschreibung verlangt mindestens einen Kurstag');
}

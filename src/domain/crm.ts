/** Reine CRM-Regeln (DB-frei): Phasen/Wahrscheinlichkeit, Pipeline, Pflegeabdeckung, Wiedervorlagen, CSV. */
import { ValidationError, ConflictError } from './errors';
import type {
  Phase, Pipeline, PipelineSumme, PflegeabdeckungZeile, Klassifizierung, Wiedervorlagen, NewsletterEmpfaenger,
} from './crmTypes';

export const PHASEN: readonly Phase[] = ['lead', 'qualifiziert', 'offeriert', 'verhandlung', 'gewonnen', 'verloren'];
export const OFFENE_PHASEN: readonly Phase[] = ['lead', 'qualifiziert', 'offeriert', 'verhandlung'];
export const KLASSIFIZIERUNGEN: readonly Klassifizierung[] = ['A', 'B', 'C', 'akquisition'];

const DEFAULT_WAHRSCHEINLICHKEIT: Record<Phase, number> = {
  lead: 10, qualifiziert: 25, offeriert: 50, verhandlung: 75, gewonnen: 100, verloren: 0,
};

export const istPhase = (p: unknown): p is Phase => typeof p === 'string' && (PHASEN as readonly string[]).includes(p);
export const istOffen = (p: Phase): boolean => OFFENE_PHASEN.includes(p);

export function defaultWahrscheinlichkeit(phase: Phase): number {
  return DEFAULT_WAHRSCHEINLICHKEIT[phase];
}

export function pruefeWahrscheinlichkeit(w: unknown): number {
  if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 100) {
    throw new ValidationError('wahrscheinlichkeit muss eine ganze Zahl zwischen 0 und 100 sein');
  }
  return w;
}

export type PhasenFolge = { phase: Phase; wahrscheinlichkeit: number; abgeschlossenAm: string | null; verlustgrund: string | null };

/**
 * Prueft einen Phasenwechsel und liefert die Folgewerte.
 * Offene Phasen duerfen in jede Phase wechseln. gewonnen/verloren sind final; nur eine Wiedereroeffnung
 * (Admin, `wiedereroeffnen`) fuehrt zurueck in eine offene Phase. `verloren` verlangt einen Verlustgrund.
 */
export function phasenwechsel(von: Phase, nach: unknown, opts: {
  heute: string; verlustgrund?: string | null; wahrscheinlichkeit?: number | null; wiedereroeffnen?: boolean;
}): PhasenFolge {
  if (!istPhase(nach)) throw new ValidationError(`Unbekannte Phase: ${String(nach)} (erlaubt: ${PHASEN.join(', ')})`);
  if (!istOffen(von)) {
    if (!opts.wiedereroeffnen) {
      throw new ConflictError(`Verkaufschance ist bereits ${von}; Aenderung nur per Wiedereroeffnung (Admin, wiedereroeffnen=true)`);
    }
    if (!istOffen(nach)) throw new ValidationError('Wiedereroeffnung nur in eine offene Phase moeglich');
  }
  if (nach === 'verloren') {
    const grund = typeof opts.verlustgrund === 'string' ? opts.verlustgrund.trim() : '';
    if (!grund) throw new ValidationError('Phase verloren verlangt einen verlustgrund');
    return { phase: nach, wahrscheinlichkeit: 0, abgeschlossenAm: opts.heute, verlustgrund: grund };
  }
  if (nach === 'gewonnen') return { phase: nach, wahrscheinlichkeit: 100, abgeschlossenAm: opts.heute, verlustgrund: null };
  const w = opts.wahrscheinlichkeit === undefined || opts.wahrscheinlichkeit === null
    ? defaultWahrscheinlichkeit(nach) : pruefeWahrscheinlichkeit(opts.wahrscheinlichkeit);
  return { phase: nach, wahrscheinlichkeit: w, abgeschlossenAm: null, verlustgrund: null };
}

/* ---------- Eingabepruefung (gemeinsam fuer CRM-Repos) ---------- */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optionaler Text: undefined bleibt undefined (PATCH), null/leer -> null, sonst getrimmt. */
export function optText(v: unknown, feld: string, max = 500): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError(`${feld} muss Text sein`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${feld} ist zu lang (max. ${max} Zeichen)`);
  return s || null;
}

export function pflichtText(v: unknown, feld: string, max = 500): string {
  const s = optText(v, feld, max);
  if (!s) throw new ValidationError(`${feld} ist Pflicht`);
  return s;
}

export function optEmail(v: unknown, feld = 'email'): string | null | undefined {
  const s = optText(v, feld, 254);
  if (!s) return s;
  if (!EMAIL_RE.test(s)) throw new ValidationError(`Ungueltige E-Mail: ${s}`);
  return s.toLowerCase();
}

export function optWert<T extends string>(v: unknown, feld: string, erlaubt: readonly T[]): T | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'string' || !(erlaubt as readonly string[]).includes(v)) {
    throw new ValidationError(`${feld}: ungueltiger Wert ${String(v)} (erlaubt: ${erlaubt.join(', ')})`);
  }
  return v as T;
}

export function optBool(v: unknown, feld: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new ValidationError(`${feld} muss true oder false sein`);
  return v;
}

export function optDatum(v: unknown, feld: string): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (!istIsoDatum(v)) throw new ValidationError(`${feld} muss ein Datum YYYY-MM-DD sein`);
  return v;
}

/** Zeitpunkt (ISO-8601 oder YYYY-MM-DD) fuer timestamptz-Felder. */
export function optZeitpunkt(v: unknown, feld: string): string | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ValidationError(`${feld} muss ein Zeitpunkt (ISO-8601) sein`);
  }
  return v;
}

/** Betrag in CHF (>= 0, max. 2 Nachkommastellen werden kaufmaennisch gerundet). */
export function optBetrag(v: unknown, feld: string): number | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1e10) throw new ValidationError(`${feld} muss ein Betrag >= 0 sein`);
  return Math.round(v * 100) / 100;
}

/* ---------- Pipeline ---------- */

export type PipelineChance = { phase: Phase; wertChf: number | null; wahrscheinlichkeit: number | null; erwarteterAbschluss: string | null };

type Akku = { anzahl: number; rappen: number; gewichtetRappen: number };
const leer = (): Akku => ({ anzahl: 0, rappen: 0, gewichtetRappen: 0 });
const alsSumme = (a: Akku): PipelineSumme => ({ anzahl: a.anzahl, summeChf: a.rappen / 100, gewichtetChf: a.gewichtetRappen / 100 });

/** Je Phase Anzahl/Summe/gewichtete Summe; Forecast je Monat des erwarteten Abschlusses (nur offene Phasen). Rechnet in Rappen. */
export function aggregierePipeline(chancen: PipelineChance[]): Pipeline {
  const jePhase = new Map<Phase, Akku>(PHASEN.map((p) => [p, leer()]));
  const jeMonat = new Map<string, Akku>();
  const offen = leer(); const ohneTermin = leer();
  for (const c of chancen) {
    const rappen = Math.round((c.wertChf ?? 0) * 100);
    const w = c.wahrscheinlichkeit ?? defaultWahrscheinlichkeit(c.phase);
    const gewichtet = Math.round((rappen * w) / 100);
    const ziele = [jePhase.get(c.phase)!];
    if (istOffen(c.phase)) {
      ziele.push(offen);
      if (c.erwarteterAbschluss) {
        const monat = c.erwarteterAbschluss.slice(0, 7);
        if (!jeMonat.has(monat)) jeMonat.set(monat, leer());
        ziele.push(jeMonat.get(monat)!);
      } else {
        ziele.push(ohneTermin);
      }
    }
    for (const z of ziele) { z.anzahl += 1; z.rappen += rappen; z.gewichtetRappen += gewichtet; }
  }
  return {
    phasen: PHASEN.map((phase) => ({ phase, ...alsSumme(jePhase.get(phase)!) })),
    offen: alsSumme(offen),
    forecast: [...jeMonat.keys()].sort().map((monat) => ({ monat, ...alsSumme(jeMonat.get(monat)!) })),
    ohneTermin: alsSumme(ohneTermin),
  };
}

/* ---------- Pflegeabdeckung ---------- */

/** Ergaenzt fehlende Klassifizierungen (inkl. 'ohne') und berechnet die Abdeckung in Prozent (1 Nachkommastelle). */
export function pflegeabdeckung(zeilen: { klassifizierung: string | null; organisationen: number; gepflegt: number }[]): PflegeabdeckungZeile[] {
  const schluessel = [...KLASSIFIZIERUNGEN, 'ohne'] as const;
  return schluessel.map((k) => {
    const z = zeilen.find((x) => (x.klassifizierung ?? 'ohne') === k);
    const organisationen = z?.organisationen ?? 0; const gepflegt = z?.gepflegt ?? 0;
    return {
      klassifizierung: k, organisationen, gepflegt,
      abdeckungProzent: organisationen ? Math.round((gepflegt / organisationen) * 1000) / 10 : null,
    };
  });
}

/* ---------- Datum ---------- */

/** Heutiges Datum in Europe/Zurich als 'YYYY-MM-DD'. */
export function heuteIso(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt);
}

export function istIsoDatum(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Sonntag der Kalenderwoche (Mo-So), in der `datum` liegt. */
export function wochenende(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/* ---------- Wiedervorlagen ---------- */

/** Teilt offene Aufgaben nach Faelligkeit relativ zu `heute` auf; jede Gruppe aufsteigend nach Faelligkeit. */
export function bucketWiedervorlagen<T extends { faelligAm: string | null }>(aufgaben: T[], heute: string): Wiedervorlagen<T> {
  const ende = wochenende(heute);
  const sortiert = [...aufgaben].sort((a, b) => (a.faelligAm ?? '').localeCompare(b.faelligAm ?? ''));
  const out: Wiedervorlagen<T> = { ueberfaellig: [], dieseWoche: [], spaeter: [], ohneTermin: [] };
  for (const a of sortiert) {
    if (!a.faelligAm) out.ohneTermin.push(a);
    else if (a.faelligAm < heute) out.ueberfaellig.push(a);
    else if (a.faelligAm <= ende) out.dieseWoche.push(a);
    else out.spaeter.push(a);
  }
  return out;
}

/* ---------- Newsletter-CSV ---------- */

/** CSV-Zelle: Formel-Injektion entschaerfen (Excel), bei Sonderzeichen quoten, Anfuehrungszeichen verdoppeln. */
export function csvZelle(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Newsletter-Export: UTF-8 mit BOM (Excel), Semikolon, CRLF, Kopfzeile email;anrede;vorname;nachname;organisation. */
export function newsletterCsv(empfaenger: NewsletterEmpfaenger[]): string {
  const kopf = ['email', 'anrede', 'vorname', 'nachname', 'organisation'] as const;
  const zeilen = [kopf.join(';'), ...empfaenger.map((e) => kopf.map((k) => csvZelle(e[k])).join(';'))];
  return '﻿' + zeilen.map((z) => `${z}\r\n`).join('');
}

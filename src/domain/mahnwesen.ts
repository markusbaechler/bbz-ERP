// Reine Mahnregeln (DB-frei): Faelligkeit, naechste Mahnstufe, Inkasso. Datum als 'YYYY-MM-DD' (String-Vergleich ok).
import { MAHNWESEN, type MahnStufe } from '../config/mahnwesen';
import { ValidationError } from './errors';

export type BisherigeMahnung = { stufe: number; fristBis: string };

export type MahnBeurteilung = {
  faelligAm: string;
  ueberfaellig: boolean;
  letzteStufe: number | null;
  naechsteStufe: number | null;
  fristBis: string | null;      // Frist der naechsten Stufe, gerechnet ab Stichtag
  gebuehr: number;              // Gebuehr der naechsten Stufe (informativ)
  inkasso: boolean;             // hoechste Stufe erreicht und deren Frist abgelaufen
};

/** Datum + n Tage (UTC-Arithmetik, zeitzonenfrei). */
export function addTage(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function pruefeStichtag(s: unknown): string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || addTage(s, 0) !== s) {
    throw new ValidationError('stichtag muss ein Datum YYYY-MM-DD sein');
  }
  return s;
}

/** Heutiges Datum in Zuerich (Default-Stichtag). */
export function heute(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(jetzt);
}

/** Faelligkeit = Rechnungsdatum + Zahlungsfrist (Default 30 Tage, AGB). */
export function faelligAm(datum: string, fristTage: number = MAHNWESEN.zahlungsfristTage): string {
  return addTage(datum, fristTage);
}

const letzte = (bisherige: BisherigeMahnung[]) =>
  bisherige.reduce<BisherigeMahnung | null>((m, x) => (!m || x.stufe > m.stufe ? x : m), null);

const maxStufe = (stufen: MahnStufe[]) => Math.max(...stufen.map((s) => s.stufe));

/**
 * Naechste Mahnstufe zum Stichtag oder null: Stufe 1 erst, wenn die Faelligkeit VOR dem Stichtag liegt; jede weitere
 * Stufe erst, wenn die Frist der vorherigen VOR dem Stichtag abgelaufen ist; nach der hoechsten Stufe keine mehr.
 */
export function naechsteStufe(
  rechnung: { datum: string; zahlungsfristTage?: number | null }, bisherige: BisherigeMahnung[], stichtag: string,
  stufen: MahnStufe[] = MAHNWESEN.stufen,
): number | null {
  if (!(faelligAm(rechnung.datum, rechnung.zahlungsfristTage ?? MAHNWESEN.zahlungsfristTage) < stichtag)) return null;
  const l = letzte(bisherige);
  if (!l) return stufen[0].stufe;
  if (l.stufe >= maxStufe(stufen) || !(l.fristBis < stichtag)) return null;
  return l.stufe + 1;
}

/** Inkasso-Liste: hoechste Stufe gemahnt und deren Frist vor dem Stichtag abgelaufen. */
export function istInkasso(bisherige: BisherigeMahnung[], stichtag: string, stufen: MahnStufe[] = MAHNWESEN.stufen): boolean {
  const l = letzte(bisherige);
  return !!l && l.stufe >= maxStufe(stufen) && l.fristBis < stichtag;
}

export function stufe(nr: number, stufen: MahnStufe[] = MAHNWESEN.stufen): MahnStufe {
  const s = stufen.find((x) => x.stufe === nr);
  if (!s) throw new ValidationError(`Unbekannte Mahnstufe ${nr}`);
  return s;
}

/** Gesamtbeurteilung einer offenen Rechnung zum Stichtag (Mahnvorschlag). */
export function beurteileMahnung(
  rechnung: { datum: string; zahlungsfristTage?: number | null }, bisherige: BisherigeMahnung[], stichtag: string,
  stufen: MahnStufe[] = MAHNWESEN.stufen,
): MahnBeurteilung {
  const faellig = faelligAm(rechnung.datum, rechnung.zahlungsfristTage ?? MAHNWESEN.zahlungsfristTage);
  const naechste = naechsteStufe(rechnung, bisherige, stichtag, stufen);
  const s = naechste === null ? null : stufe(naechste, stufen);
  return {
    faelligAm: faellig,
    ueberfaellig: faellig < stichtag,
    letzteStufe: letzte(bisherige)?.stufe ?? null,
    naechsteStufe: naechste,
    fristBis: s ? addTage(stichtag, s.fristTage) : null,
    gebuehr: s?.gebuehrChf ?? 0,
    inkasso: istInkasso(bisherige, stichtag, stufen),
  };
}

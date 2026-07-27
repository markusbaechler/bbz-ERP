import { ValidationError } from '../domain/errors';

export function fmText(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export function fmZahl(v: string | undefined): number | null {
  let t = (v ?? '').trim();
  if (t === '') return null;
  t = t.replace(/['’s]/g, '');
  if (!t.includes('.') && t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fmDatum(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// '6231.26' -> Stammnummer 6231, Jahr 2026. Pivot 89: Werte darueber gelten als 19xx.
export function fmProjektNummer(v: string): { stammnummer: number; jahr: number } {
  const t = (v ?? '').trim();
  const m = /^(\d{1,5})\.(\d{2})$/.exec(t);
  if (!m) throw new ValidationError(`Projekt_Nr. "${v}" hat nicht das Format <Stammnummer>.<JJ>`);
  const jj = Number(m[2]);
  return { stammnummer: Number(m[1]), jahr: jj <= 89 ? 2000 + jj : 1900 + jj };
}

export function fmName(v: string): { name: string; zusatz: string | null } {
  const zeilen = (v ?? '').split('\n').map((z) => z.trim()).filter((z) => z !== '');
  return { name: zeilen[0] ?? '', zusatz: zeilen.length > 1 ? zeilen.slice(1).join('\n') : null };
}

// Bereich ist mehrzeilig; ein Datensatz enthaelt faelschlich eine Kontonummer (Befund B5).
export function fmBereich(v: string | undefined): string | null {
  const erste = fmText((v ?? '').split('\n')[0]);
  if (erste === null) return null;
  return /^\d+$/.test(erste) ? null : erste;
}

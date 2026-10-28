/*
 * CSV-Lesen fuer FileMaker-Exporte. Empfohlen ist das Format "Seriendruck (.mer)": CSV MIT Kopfzeile
 * (das FileMaker-Format "CSV" hat keine Feldnamen). FileMaker-Eigenheiten:
 *  - Zeilenumbruch innerhalb eines Feldes = \x0B (vertikaler Tab) -> \n
 *  - Wiederholfelder getrennt durch \x1D -> es zaehlt der erste Wert
 */

export function parseCsv(text: string, trenner?: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const sep = trenner ?? erkenneTrenner(t);
  const zeilen: string[][] = [];
  let feld = ''; let zeile: string[] = []; let inQuote = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuote) {
      if (c === '"') { if (t[i + 1] === '"') { feld += '"'; i++; } else inQuote = false; }
      else feld += c;
    } else if (c === '"' && feld === '') inQuote = true;
    else if (c === sep) { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      zeile.push(feld); zeilen.push(zeile); zeile = []; feld = '';
    } else feld += c;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((x) => x.trim() !== '')).map((z) => z.map(bereinige));
}

function erkenneTrenner(t: string): string {
  const kopf = t.split(/\r?\n/, 1)[0];
  const n = (s: string) => kopf.split(s).length;
  return [',', ';', '\t'].sort((a, b) => n(b) - n(a))[0];
}

const bereinige = (v: string) => v.replace(/\x0B/g, '\n').split('\x1D')[0].trim();

/** Zeilen als Objekte (Schluessel = Kopfzeile). */
export function csvObjekte(text: string, trenner?: string): Record<string, string>[] {
  const [kopf, ...rest] = parseCsv(text, trenner);
  if (!kopf) return [];
  return rest.map((z) => Object.fromEntries(kopf.map((k, i) => [k.trim(), z[i] ?? ''])));
}

/** 1'234.50 | 1234,50 | -12.3 -> Zahl; leer -> null; unlesbar -> NaN */
export function zahl(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  let s = v.trim().replace(/['’\s]|CHF/gi, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 23.07.2026 | 7/23/2026 | 2026-07-23 -> 2026-07-23; leer -> null; unlesbar -> 'ungueltig' */
export function datum(v: string | undefined): string | null | 'ungueltig' {
  if (v === undefined || v.trim() === '') return null;
  const s = v.trim();
  let y: string, m: string, d: string;
  let x: RegExpExecArray | null;
  if ((x = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s))) [d, m, y] = [x[1], x[2], x[3]];
  else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [m, d, y] = [x[1], x[2], x[3]];
  else if ((x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) [y, m, d] = [x[1], x[2], x[3]];
  else return 'ungueltig';
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) ? 'ungueltig' : iso;
}

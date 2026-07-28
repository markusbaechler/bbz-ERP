import { ValidationError } from '../domain/errors';

// Minimaler RFC4180-Parser fuer die FileMaker-Exporte: ';'-getrennt, UTF-8 mit BOM,
// Zeilenumbrueche innerhalb gequoteter Felder (mehrzeilige Beschrieb-/Adressfelder).
export function parseCsv(text: string, sep = ';'): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export type CsvOptionen = {
  /**
   * Erste Spaltenueberschrift, an der die Kopfzeile erkannt wird. Ohne diese Angabe
   * gilt Zeile 1 als Kopf (so liefern die FileMaker-Exporte).
   *
   * Der Kontenplan kommt dagegen aus einem Excel-Blatt, dessen Kopf ueber zwei Zeilen
   * laeuft ("MWST-" / "Code", "Sub-" / "total") und dem darueber noch Leerzeilen
   * vorausgehen koennen. Die gefundene Zeile wird darum spaltenweise mit der Zeile
   * direkt darueber zusammengezogen, damit "MWST-Code" und "Sub-total" wieder
   * vollstaendig sind. Genau eine Vorzeile — mehr waere Raterei.
   */
  kopfSpalte?: string;
};

export function csvRecords(text: string, sep = ';', opts: CsvOptionen = {}): { header: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text, sep);
  if (rows.length === 0) return { header: [], records: [] };
  if (opts.kopfSpalte === undefined) {
    // Unveraenderter Weg der FileMaker-Exporte: Zeile 1 ist der Kopf, woertlich.
    return baueRecords(rows[0], rows.slice(1));
  }
  const kopf = rows.findIndex((r) => (r[0] ?? '').trim() === opts.kopfSpalte);
  if (kopf < 0) {
    throw new ValidationError(
      `Kopfzeile mit "${opts.kopfSpalte}" in der ersten Spalte nicht gefunden — ` +
      `ist das die richtige Datei bzw. das richtige Blatt?`);
  }
  const oben = kopf > 0 ? rows[kopf - 1] : [];
  return baueRecords(rows[kopf].map((h, i) => `${(oben[i] ?? '').trim()}${h.trim()}`), rows.slice(kopf + 1));
}

function baueRecords(header: string[], zeilen: string[][]): { header: string[]; records: Array<Record<string, string>> } {
  const records = zeilen.map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    return rec;
  });
  return { header, records };
}

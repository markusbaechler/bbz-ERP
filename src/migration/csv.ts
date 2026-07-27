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

export function csvRecords(text: string, sep = ';'): { header: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text, sep);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    return rec;
  });
  return { header, records };
}

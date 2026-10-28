/*
 * FileMaker-Analyse: liest den Datenbank-Designreport (XML) und schreibt
 *   <out>/FUNKTIONSUMFANG.md   Bericht inkl. Abdeckungsmatrix
 *   <out>/inventar.json        vollstaendiges Inventar (Tabellen, Felder, Scripts, ...)
 *   <out>/mapping-entwurf.json Feld-Mapping-Vorschlag fuer die Datenmigration
 *
 * Aufruf:  npm run fm:analyse -- <DDR-Ordner|Datei.xml> [--out <Ordner>] [--mit-konten]
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueInventar, dekodiere } from './parser';
import { analysiere, liesErpSchema } from './analyse';
import { berichtMarkdown, mappingEntwurf } from './report';

function xmlDateien(pfad: string): string[] {
  if (statSync(pfad).isFile()) return [pfad];
  const out: string[] = [];
  for (const e of readdirSync(pfad)) {
    const p = join(pfad, e);
    if (statSync(p).isDirectory()) out.push(...xmlDateien(p));
    else if (/\.xml$/i.test(e)) out.push(p);
  }
  return out;
}

export function fuehreAus(argv: string[]): { out: string; luecken: number } {
  const eingabe = argv.find((a) => !a.startsWith('--'));
  if (!eingabe) throw new Error('Aufruf: fm-analyse <DDR-Ordner|Datei.xml> [--out <Ordner>] [--mit-konten]');
  const outIdx = argv.indexOf('--out');
  const out = resolve(outIdx >= 0 ? argv[outIdx + 1] : 'fm-analyse-out');
  const dateien = xmlDateien(resolve(eingabe)).map((p) => ({ name: basename(p), inhalt: dekodiere(readFileSync(p)) }));
  const inv = baueInventar(dateien);
  const migDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
  const schema = liesErpSchema(readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migDir, f), 'utf8')));
  const a = analysiere(inv, schema);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'FUNKTIONSUMFANG.md'), berichtMarkdown(inv, a, { mitKonten: argv.includes('--mit-konten'), quelle: basename(resolve(eingabe)) }));
  writeFileSync(join(out, 'inventar.json'), JSON.stringify(inv, null, 2));
  writeFileSync(join(out, 'mapping-entwurf.json'), JSON.stringify(mappingEntwurf(a), null, 2));
  return { out, luecken: a.luecken.length };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  try {
    const r = fuehreAus(process.argv.slice(2));
    console.log(`Bericht geschrieben: ${r.out} (${r.luecken} offene Luecken)`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

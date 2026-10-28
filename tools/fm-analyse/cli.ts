/*
 * FileMaker-Analyse: liest den Datenbank-Designreport (XML) oder die Data API und schreibt
 *   <out>/FUNKTIONSUMFANG.md   Bericht inkl. Abdeckungsmatrix
 *   <out>/inventar.json        vollstaendiges Inventar (Tabellen, Felder, Scripts, ...)
 *   <out>/mapping-entwurf.json Feld-Mapping-Vorschlag fuer die Datenmigration
 *
 * Aufruf DDR:      npm run fm:analyse -- <DDR-Ordner|Datei.xml> [--out <Ordner>] [--mit-konten]
 * Aufruf Data API: FM_PASSWORT=… npm run fm:analyse -- --data-api https://<server> --datenbank Projekte
 *                  [--datenbank Seminare] --benutzer <konto> [--api-version v1|vLatest] [--ohne-anzahl] [--out <Ordner>]
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueInventar, dekodiere } from './parser';
import { analysiere, liesErpSchema } from './analyse';
import { berichtMarkdown, mappingEntwurf } from './report';
import { sammleUeberDataApi } from './dataApi';
import type { FmInventar } from './typen';
import { istEinstieg } from '../../src/einstieg';

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

const wert = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const werte = (argv: string[], name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

function schreibe(inv: FmInventar, argv: string[], quelle: string): { out: string; luecken: number } {
  const out = resolve(wert(argv, '--out') ?? 'fm-analyse-out');
  const migDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
  const schema = liesErpSchema(readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migDir, f), 'utf8')));
  const a = analysiere(inv, schema);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'FUNKTIONSUMFANG.md'), berichtMarkdown(inv, a, { mitKonten: argv.includes('--mit-konten'), quelle }));
  writeFileSync(join(out, 'inventar.json'), JSON.stringify(inv, null, 2));
  writeFileSync(join(out, 'mapping-entwurf.json'), JSON.stringify(mappingEntwurf(a), null, 2));
  return { out, luecken: a.luecken.length };
}

/** Werte, die einem Schalter folgen, sind keine Eingabedatei. */
const MIT_WERT = new Set(['--out', '--data-api', '--datenbank', '--benutzer', '--api-version']);

export function fuehreAus(argv: string[]): { out: string; luecken: number } {
  const eingabe = argv.find((a, i) => !a.startsWith('--') && !MIT_WERT.has(argv[i - 1]));
  if (!eingabe) throw new Error('Aufruf: fm-analyse <DDR-Ordner|Datei.xml> [--out <Ordner>] [--mit-konten]');
  const dateien = xmlDateien(resolve(eingabe)).map((p) => ({ name: basename(p), inhalt: dekodiere(readFileSync(p)) }));
  return schreibe(baueInventar(dateien), argv, basename(resolve(eingabe)));
}

/** Data-API-Modus; das Passwort kommt ausschliesslich aus FM_PASSWORT (nie als Argument, landet sonst in der Shell-History). */
export async function fuehreAusDataApi(argv: string[], env: NodeJS.ProcessEnv = process.env, f?: typeof fetch): Promise<{ out: string; luecken: number }> {
  const server = wert(argv, '--data-api');
  if (!server) throw new Error('--data-api <https://server> fehlt');
  if (argv.includes('--passwort')) throw new Error('Passwort nicht als Argument uebergeben, sondern in der Umgebungsvariablen FM_PASSWORT');
  const inv = await sammleUeberDataApi({
    server, datenbanken: werte(argv, '--datenbank'), benutzer: wert(argv, '--benutzer') ?? env.FM_BENUTZER ?? '',
    passwort: env.FM_PASSWORT ?? '', version: wert(argv, '--api-version'), mitAnzahl: !argv.includes('--ohne-anzahl'), fetch: f,
  });
  return schreibe(inv, argv, `Data API ${new URL(server).host} (${werte(argv, '--datenbank').join(', ')})`);
}

if (istEinstieg(import.meta.url)) {
  const argv = process.argv.slice(2);
  (argv.includes('--data-api') ? fuehreAusDataApi(argv) : Promise.resolve().then(() => fuehreAus(argv)))
    .then((r) => console.log(`Bericht geschrieben: ${r.out} (${r.luecken} offene Luecken)`))
    .catch((e) => { console.error((e as Error).message); process.exit(1); });
}

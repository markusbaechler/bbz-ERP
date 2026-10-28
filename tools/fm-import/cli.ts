/*
 * FileMaker-Datenmigration:
 *   npm run fm:import -- --ordner <Exportordner> --mapping <mapping.json> [--ausfuehren] [--zaehler-start <naechste RgNr>]
 * Ohne --ausfuehren = PROBELAUF (alles wird geprueft und zurueckgerollt). Bericht: <Ordner>/IMPORT-BERICHT.md
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getPool, closePool } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';
import { importiere, berichtMarkdown, type Mapping, type Quellen, type Tabelle } from './import';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const ordner = resolve(arg('--ordner') ?? '.');
  const mapping = JSON.parse(readFileSync(resolve(arg('--mapping') ?? 'tools/fm-import/mapping.beispiel.json'), 'utf8')) as Mapping;
  const quellen: Quellen = {};
  for (const [t, m] of Object.entries(mapping) as [Tabelle, any][]) {
    if (!m?.datei) continue;
    const p = join(ordner, m.datei);
    if (existsSync(p)) quellen[t] = readFileSync(p, 'utf8');
    else console.warn(`Hinweis: ${m.datei} fehlt – ${t} wird uebersprungen`);
  }
  const pool = getPool();
  await runMigrations(pool);
  const start = arg('--zaehler-start');
  const b = await importiere(pool, quellen, mapping, { probelauf: !process.argv.includes('--ausfuehren'), zaehlerStart: start ? Number(start) : undefined });
  const ziel = join(ordner, 'IMPORT-BERICHT.md');
  writeFileSync(ziel, berichtMarkdown(b));
  console.log(`${b.probelauf ? 'Probelauf' : 'Import'} beendet: ${b.fehler.length} Fehlerzeilen. Bericht: ${ziel}`);
  await closePool();
}

main().catch(async (e) => { console.error(e); await closePool(); process.exit(1); });

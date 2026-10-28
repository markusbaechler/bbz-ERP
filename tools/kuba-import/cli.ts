/*
 * Historischer SAQ-Import aus Reporting_KUBA.xlsx (Doku: docs/analyse/KUBA-IMPORT.md):
 *   npm run kuba:import -- --datei <Reporting_KUBA.xlsx> [--ausfuehren] [--stichtag YYYY-MM-DD]
 * Ohne --ausfuehren = PROBELAUF (alles wird geprueft und zurueckgerollt). Bericht: KUBA-IMPORT-BERICHT.md neben der Datei.
 * Der Bericht enthaelt Rohwerte aus der Datei (Personendaten): nicht ins Repo legen, nur intern weitergeben.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { getPool, closePool } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';
import { pruefeDatum } from '../../src/domain/saq';
import { importiere, berichtMarkdown } from './import';
import { KubaStrukturFehler } from './kuba';

const AUFRUF = 'Aufruf: npm run kuba:import -- --datei <Reporting_KUBA.xlsx> [--ausfuehren] [--stichtag YYYY-MM-DD]';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const pfad = arg('--datei');
  if (!pfad) { console.error(AUFRUF); process.exit(2); }
  const stichtag = arg('--stichtag');
  if (stichtag) pruefeDatum(stichtag, '--stichtag');
  const datei = resolve(pfad);
  const daten = readFileSync(datei);
  const pool = getPool();
  await runMigrations(pool);
  const b = await importiere(pool, daten, { probelauf: !process.argv.includes('--ausfuehren'), heute: stichtag, datei: basename(datei) });
  const ziel = join(dirname(datei), 'KUBA-IMPORT-BERICHT.md');
  writeFileSync(ziel, berichtMarkdown(b));
  const fehler = b.dq.filter((d) => d.stufe === 'fehler').length;
  console.log(`${b.probelauf ? 'Probelauf (nichts gespeichert)' : 'Import'} beendet: ${b.vorgaenge} Vorgaenge -> ${b.faelle.neu} Faelle neu, ${b.faelle.vorhanden} vorhanden, `
    + `${b.faelle.fehler + b.nichtImportiert.length} nicht importiert; ${b.runs.neu} Runs neu; ${fehler} Data-Quality-Fehler. Bericht: ${ziel}`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof KubaStrukturFehler ? `Strukturfehler in der KUBA-Datei (nichts importiert): ${e.message}` : e);
  await closePool();
  process.exit(1);
});

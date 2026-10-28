/**
 * Lokale Testumgebung neu aufsetzen (`npm run demo:neu`, liest .env.demo):
 * Demo-DB anlegen (falls noetig) -> Schema leeren -> Migrationen -> Demo-Daten -> Beispieldateien nach demo-dateien/.
 * Loescht alle Daten der Ziel-DB; deshalb nur lokale Datenbanken mit "demo" im Namen. Danach: `npm run demo`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { istEinstieg } from '../../src/einstieg';
import { getPool, closePool } from '../../src/db/pool';
import { runMigrations } from '../../src/db/migrate';
import { seedDemo } from '../../src/db/seedDemo';
import { demoDateien } from '../../src/db/demoDateien';

const LOKAL = ['localhost', '127.0.0.1', '[::1]'];

export function pruefeDemoDb(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL fehlt (npm run demo:neu liest .env.demo)');
  const u = new URL(url);
  if (!LOKAL.includes(u.hostname)) throw new Error(`Nur lokale Datenbanken: Host «${u.hostname}» ist nicht lokal`);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/demo/i.test(name)) throw new Error(`Datenbank «${name}» hat kein "demo" im Namen und wird nicht geleert`);
}

/** Legt die Demo-DB auf demselben Server an, falls sie fehlt (Docker-Postgres kennt nur bbz_test). */
async function stelleDbSicher(url: string): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Ungueltiger Datenbankname «${name}»`);
  const wartung = new URL(url);
  wartung.pathname = '/postgres';
  const c = new pg.Client({ connectionString: wartung.toString() });
  await c.connect();
  try {
    const da = await c.query('select 1 from pg_database where datname=$1', [name]);
    if (!da.rowCount) { await c.query(`create database ${name}`); console.log(`Datenbank ${name} angelegt.`); }
  } finally {
    await c.end();
  }
}

if (istEinstieg(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  const ziel = join(dirname(fileURLToPath(import.meta.url)), '../../demo-dateien');
  try {
    pruefeDemoDb(url);
    await stelleDbSicher(url!);
    const pool = getPool();
    await pool.query('drop schema public cascade; create schema public;');
    await runMigrations(pool);
    await seedDemo(pool);
    const dateien = await demoDateien(pool);
    mkdirSync(ziel, { recursive: true });
    writeFileSync(join(ziel, 'moodle-anmeldungen-kursdaten-v2.csv'), dateien.moodleKursdatenCsv, 'utf8');
    writeFileSync(join(ziel, 'camt054-gutschriften.xml'), dateien.camt054, 'utf8');
    console.log(`Beispieldateien: ${ziel}`);
    console.log(`Starten: npm run demo  ->  http://localhost:${process.env.PORT ?? 3000}/app/  (Dev-Login: Kürzel ml = Admin, ph/sk = Standard)`);
  } catch (e) {
    console.error('Testumgebung nicht aufgesetzt:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz default now())');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('select 1 from schema_migrations where version=$1', [file]);
    if (done.rowCount) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(version) values ($1)', [file]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}

// CLI: `npm run migrate`
// pathToFileURL statt manueller string-Bau: unter Windows braucht ein Laufwerkspfad
// "file:///C:/..." (drei Slashes) — der frueher hier gebaute String hatte nur zwei,
// die Bedingung war nie wahr und `npm run migrate` still wirkungslos.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { getPool, closePool } = await import('./pool');
  await runMigrations(getPool());
  await closePool();
  console.log('migrations applied');
}

import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { resetDb } from './helpers/db';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

afterAll(async () => { await closePool(); });

describe('migrations', () => {
  it('legt schema_migrations an und ist idempotent', async () => {
    const pool = getPool();
    await resetDb(pool);
    await runMigrations(pool); // zweiter Lauf darf nicht crashen
    const r = await pool.query('select count(*)::int as n from schema_migrations');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  // `npm run migrate` war unter Windows still wirkungslos: der Vergleich
  // `import.meta.url === 'file://' + argv[1]` trifft bei Laufwerkspfaden nie zu
  // (file:///C:/... mit drei Slashes). Der Prozess lief durch und tat nichts.
  it('fuehrt die Migrationen aus, wenn src/db/migrate.ts direkt gestartet wird', async () => {
    const pool = getPool();
    await pool.query('drop schema public cascade; create schema public;');
    const out = execSync('npx tsx src/db/migrate.ts', {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://bbz:bbz@localhost:5433/bbz_test' },
    });
    expect(out).toContain('migrations applied');
    const r = await pool.query('select count(*)::int as n from schema_migrations');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    await resetDb(pool);
  }, 60000);
});

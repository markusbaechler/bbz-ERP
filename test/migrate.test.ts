import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { resetDb } from './helpers/db';

afterAll(async () => { await closePool(); });

describe('migrations', () => {
  it('legt schema_migrations an und ist idempotent', async () => {
    const pool = getPool();
    await resetDb(pool);
    await runMigrations(pool); // zweiter Lauf darf nicht crashen
    const r = await pool.query('select count(*)::int as n from schema_migrations');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

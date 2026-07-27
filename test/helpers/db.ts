import type pg from 'pg';
import { runMigrations } from '../../src/db/migrate';

export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema public cascade; create schema public;');
  await runMigrations(pool);
}

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { getPool, closePool } from '../src/db/pool';

/*
 * Bricht die Datenbank eine ruhende Verbindung ab (Neustart des Containers, Wartung oder Failover in Azure), meldet
 * node-postgres das als 'error'-Ereignis am Pool. Ohne Handler stuerzt der ganze Prozess ab (Server und Worker).
 */
const pool = getPool();
afterAll(async () => { await closePool(); });

describe('DB-Pool', () => {
  it('ueberlebt den Abbruch einer ruhenden Verbindung und arbeitet mit einer neuen weiter', async () => {
    const pid = (await pool.query('select pg_backend_pid() as pid')).rows[0].pid;
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      expect((await admin.query('select pg_terminate_backend($1) as ok', [pid])).rows[0].ok).toBe(true);
    } finally {
      await admin.end();
    }
    await new Promise((r) => setTimeout(r, 300));   // Fehlerereignis der ruhenden Verbindung abwarten
    const r = await pool.query('select pg_backend_pid() as pid');
    expect(r.rows[0].pid).not.toBe(pid);
  });

  it('haengt den Fehler-Handler nur einmal an, auch bei vielen getPool()-Aufrufen', () => {
    for (let i = 0; i < 20; i++) getPool();
    expect(getPool().listenerCount('error')).toBe(1);
  });
});

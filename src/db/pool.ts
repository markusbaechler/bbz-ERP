import pg from 'pg';

// DATE (OID 1082) als 'YYYY-MM-DD'-String zurückgeben, nicht als JS-Date.
// Verhindert Zeitzonen-Verschiebungen bei reinen Datumsfeldern (z. B. MWSt-Gültigkeit, Rechnungsdatum).
pg.types.setTypeParser(1082, (v: string) => v);

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  // Timeouts: eine haengende Verbindung darf den Pool nicht dauerhaft blockieren (Security-Review Befund 1)
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
      idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_IN_TX_TIMEOUT_MS ?? 30_000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 60_000),
    });
    // Ruhende Verbindung von der DB abgebrochen (Neustart, Wartung, Failover): Der Pool verwirft sie und verbindet bei der
    // naechsten Abfrage neu. Ohne Handler waere das ein unbehandeltes 'error'-Ereignis und beendet Server bzw. Worker.
    pool.on('error', (e) => console.error(`DB-Verbindung im Pool abgebrochen: ${e.message}`));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = undefined; }
}

import pg from 'pg';

// DATE (OID 1082) als 'YYYY-MM-DD'-String zurückgeben, nicht als JS-Date.
// Verhindert Zeitzonen-Verschiebungen bei reinen Datumsfeldern (z. B. MWSt-Gültigkeit, Rechnungsdatum).
pg.types.setTypeParser(1082, (v: string) => v);

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = undefined; }
}

import type pg from 'pg';

/** Pool oder Transaktions-Client: Repos, die in fremden Transaktionen laufen muessen, akzeptieren beides. */
export type Db = pg.Pool | pg.PoolClient;

/** Fuehrt fn in einer Transaktion aus (begin/commit/rollback) und gibt den Client wieder frei. */
export async function inTransaktion<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await fn(client);
    await client.query('commit');
    return res;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Baut "col=$n"-Zuweisungen fuer PATCH aus einem Feld-Mapping (camelCase -> Spalte); nur vorhandene Keys. */
export function patchSets(patch: Record<string, unknown>, cols: Record<string, string>, args: unknown[]): string[] {
  const sets: string[] = [];
  for (const [k, col] of Object.entries(cols)) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) { args.push(patch[k]); sets.push(`${col}=$${args.length}`); }
  }
  return sets;
}

export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

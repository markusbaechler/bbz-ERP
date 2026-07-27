import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createMwstSatz, findGueltigenSatz } from '../src/repos/mwstSatzRepo';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('mwstSatzRepo', () => {
  it('findet den am Datum gültigen Satz (7.7 -> 8.1 Wechsel)', async () => {
    const pool = getPool();
    await createMwstSatz(pool, { satz: 7.7, bezeichnung: 'Normal', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' });
    await createMwstSatz(pool, { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01', gueltigBis: null });
    const s = await findGueltigenSatz(pool, 8.1, '2026-07-23');
    expect(s.satz).toBe(8.1);
    expect(s.gueltigBis).toBeNull();
  });
});

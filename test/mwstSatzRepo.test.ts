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

  // Die Satzhistorie lebt von ueberschneidungsfreien Fenstern, die weder Schema noch
  // Constraint erzwingt. Faellt das je auseinander, muss die Abfrage trotzdem
  // deterministisch antworten: das juengste gueltig_ab gewinnt.
  it('liefert bei ueberlappenden Gueltigkeitsfenstern deterministisch das juengere', async () => {
    const pool = getPool();
    await createMwstSatz(pool, { satz: 5.5, bezeichnung: 'Alt', gueltigAb: '2010-01-01', gueltigBis: null });
    await createMwstSatz(pool, { satz: 5.5, bezeichnung: 'Neu', gueltigAb: '2020-01-01', gueltigBis: null });
    for (let i = 0; i < 5; i++) {
      expect((await findGueltigenSatz(pool, 5.5, '2026-01-01')).bezeichnung).toBe('Neu');
    }
    expect((await findGueltigenSatz(pool, 5.5, '2015-01-01')).bezeichnung).toBe('Alt');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createKonto, listKonten, getKontoById } from '../src/repos/kontoRepo';
import { NotFoundError } from '../src/domain/errors';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('kontoRepo', () => {
  it('legt Konto an und liest es', async () => {
    const pool = getPool();
    const k = await createKonto(pool, { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' });
    expect(k.id).toBeTruthy();
    expect(k.aktiv).toBe(true);
    const again = await getKontoById(pool, k.id);
    expect(again.nummer).toBe('3100');
    expect((await listKonten(pool)).length).toBe(1);
  });
  it('wirft NotFoundError bei unbekannter id', async () => {
    await expect(getKontoById(getPool(), '00000000-0000-0000-0000-000000000000'))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

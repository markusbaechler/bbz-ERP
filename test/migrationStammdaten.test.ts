import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { importStammdaten, KONTENPLAN, MWST_SAETZE } from '../src/migration/stammdaten';
import { findKontoByNummer, listKonten } from '../src/repos/kontoRepo';
import { findGueltigenSatz } from '../src/repos/mwstSatzRepo';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('importStammdaten', () => {
  it('legt Kontenplan und Satzhistorie an', async () => {
    const r = await importStammdaten(getPool());
    expect(r.konten.angelegt).toBe(KONTENPLAN.length);
    expect(r.mwstSaetze.angelegt).toBe(MWST_SAETZE.length);
    expect((await findKontoByNummer(getPool(), '3100'))?.typ).toBe('Ertrag');
    expect((await findKontoByNummer(getPool(), '5000'))?.typ).toBe('Aufwand');
    expect(await listKonten(getPool())).toHaveLength(KONTENPLAN.length);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await importStammdaten(getPool());
    expect(r.konten.angelegt).toBe(0);
    expect(r.konten.vorhanden).toBe(KONTENPLAN.length);
    expect(r.mwstSaetze.angelegt).toBe(0);
    expect(await listKonten(getPool())).toHaveLength(KONTENPLAN.length);
  });

  it('deckt alle im Export vorkommenden MWSt-Saetze zum passenden Datum ab', async () => {
    expect((await findGueltigenSatz(getPool(), 8.1, '2026-07-23')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.7, '2020-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.6, '2005-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 8.0, '2015-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 2.6, '2026-01-01')).bezeichnung).toBe('Reduziert');
    expect((await findGueltigenSatz(getPool(), 0, '2026-01-01')).bezeichnung).toBe('Befreit/ausgenommen');
  });
});

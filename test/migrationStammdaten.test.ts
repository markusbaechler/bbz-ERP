import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { importStammdaten, MWST_SAETZE } from '../src/migration/stammdaten';
import { listKonten } from '../src/repos/kontoRepo';
import { findGueltigenSatz } from '../src/repos/mwstSatzRepo';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('importStammdaten', () => {
  // Frueher legte importStammdaten zusaetzlich elf Konten an, deren Bezeichnungen aus
  // der Bereichs-Spalte des Projekt-Exports abgeleitet waren. Diese Liste ist weg — die
  // Migration erfindet keine Stammdaten. Der Kontenplan kommt jetzt aus der Datei des
  // Kunden, ueber --konten (siehe migrationKonten.test.ts).
  it('legt die Satzhistorie an und kein einziges Konto', async () => {
    const r = await importStammdaten(getPool());
    expect(r.mwstSaetze.angelegt).toBe(MWST_SAETZE.length);
    expect(await listKonten(getPool())).toHaveLength(0);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await importStammdaten(getPool());
    expect(r.mwstSaetze.angelegt).toBe(0);
    expect(r.mwstSaetze.vorhanden).toBe(MWST_SAETZE.length);
    expect(await listKonten(getPool())).toHaveLength(0);
  });

  it('deckt alle im Export vorkommenden MWSt-Saetze zum passenden Datum ab', async () => {
    expect((await findGueltigenSatz(getPool(), 8.1, '2026-07-23')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.7, '2020-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.6, '2005-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 8.0, '2015-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 2.6, '2026-01-01')).bezeichnung).toBe('Reduziert');
    expect((await findGueltigenSatz(getPool(), 0, '2026-01-01')).bezeichnung).toBe('Befreit/ausgenommen');
  });

  // 3.8 ist der einzige Satz, der zweimal mit disjunkten Perioden vorkommt
  // (Beherbergung 2011–2017 und wieder ab 2024). Genau die Zeile, die beim
  // "Aufraeumen" der Liste als Dublette geloescht wuerde.
  it('loest den doppelt vorkommenden Satz 3.8 je nach Datum auf die richtige Periode auf', async () => {
    const alt = await findGueltigenSatz(getPool(), 3.8, '2015-05-01');
    expect(alt.gueltigAb).toBe('2011-01-01');
    expect(alt.gueltigBis).toBe('2017-12-31');

    const neu = await findGueltigenSatz(getPool(), 3.8, '2026-05-01');
    expect(neu.gueltigAb).toBe('2024-01-01');
    expect(neu.gueltigBis).toBeNull();

    // In der Luecke dazwischen galt 3.7 — 3.8 darf dort nicht gefunden werden.
    await expect(findGueltigenSatz(getPool(), 3.8, '2020-05-01')).rejects.toThrow();
    expect((await findGueltigenSatz(getPool(), 3.7, '2020-05-01')).bezeichnung).toBe('Beherbergung');
  });
});

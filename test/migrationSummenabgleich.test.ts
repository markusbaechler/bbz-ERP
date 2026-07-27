import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';
import { formatReport } from '../src/migration/report';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';

// Zwei Jahrgaenge in einer Datei — genau der Fall des angekuendigten Vollexports
// (~4967 Projekte ueber alle Jahre, Befund B1).
const zweiJahre = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_zwei_jahrgaenge.csv');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('Summenabgleich ueber mehrere Jahrgaenge', () => {
  it('rechnet gegen genau die Projekte ab, die dieser Lauf geschrieben hat', async () => {
    // Ein Projekt, das nicht aus dem Export stammt (z.B. per REST erfasst). Es darf
    // den Abgleich nicht verfaelschen — frueher zaehlte "where jahr=$1" es mit.
    const fremd = await createAuftraggeber(getPool(), {
      name: 'Fremd AG', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf',
    });
    await createProjekt(getPool(), {
      stammnummer: 8888, jahr: 2026, name: 'Nicht aus dem Export',
      auftraggeberId: fremd.id, budgetChf: 999999,
    });

    const r = await fuehreMigrationAus(getPool(), { projekteCsv: zweiJahre, modus: 'apply' });
    expect(r.projekte.neu).toBe(4);
    expect(r.summen.budgetChf.csv).toBeCloseTo(1000, 2);
    expect(r.summen.budgetChf.db).toBeCloseTo(1000, 2);
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.offenProv.ok).toBe(true);
    expect(r.summen.abgerechnet.ok).toBe(true);
  });

  it('nennt im Report keinen einzelnen Jahrgang, wenn die Datei mehrere enthaelt', async () => {
    const apply = await fuehreMigrationAus(getPool(), { projekteCsv: zweiJahre, modus: 'apply' });
    expect(apply.jahre).toEqual([2025, 2026]);
    expect(apply.jahr).toBeNull();
    expect(formatReport(apply)).toContain('2025–2026');

    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: zweiJahre, modus: 'dry-run' });
    expect(dry.jahre).toEqual([2025, 2026]);
    expect(dry.jahr).toBeNull();
  });
});

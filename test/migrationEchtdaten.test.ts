import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';

// Liegt ausserhalb des Repos (Personen-/Bankdaten werden nicht eingecheckt).
const echt = join(dirname(fileURLToPath(import.meta.url)), '../../fm-discovery/export/export_daten.csv');
const vorhanden = existsSync(echt);

beforeAll(async () => { if (vorhanden) await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe.skipIf(!vorhanden)('Migration gegen den echten Projekt-Export', () => {
  it('importiert 151 Projekte und 49 Auftraggeber mit passenden Summen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.jahr).toBe(2026);
    expect(r.projekte.gelesen).toBe(151);
    expect(r.projekte.neu).toBe(151);
    expect(r.projekte.uebersprungen).toBe(0);
    expect(r.auftraggeber.gelesen).toBe(49);

    // Sollwerte aus dem FileMaker-Export (Befund B1)
    expect(r.summen.budgetChf.csv).toBeCloseTo(4435265.0, 2);
    expect(r.summen.offenProv.csv).toBeCloseTo(2048973.45, 2);
    expect(r.summen.abgerechnet.csv).toBeCloseTo(2401554.55, 2);

    // Datenbank stimmt mit der CSV ueberein
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.offenProv.ok).toBe(true);
    expect(r.summen.abgerechnet.ok).toBe(true);

    // Bekannte, erwartete Datenluecken (Befunde B3/B4)
    expect(r.auftraggeber.ohneAdresse).toBe(49);
    expect(r.warnungen.filter((w) => w.includes('nicht im Kontenplan')).length).toBeGreaterThan(0);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.projekte.neu).toBe(0);
    expect(r.projekte.aktualisiert).toBe(151);
    expect(r.auftraggeber.neu).toBe(0);
  });
});

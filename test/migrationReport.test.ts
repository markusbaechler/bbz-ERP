import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { vergleiche, formatReport } from '../src/migration/report';
import { fuehreMigrationAus } from '../src/migration/run';
import { getZaehler } from '../src/repos/zaehlerRepo';
import { listProjekte } from '../src/repos/projektRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('vergleiche', () => {
  it('toleriert einen Rappen Rundungsdifferenz', () => {
    expect(vergleiche(4435265, 4435265).ok).toBe(true);
    expect(vergleiche(100.0, 100.01).ok).toBe(true);
    expect(vergleiche(100.0, 100.05).ok).toBe(false);
    expect(vergleiche(100.0, null)).toEqual({ csv: 100.0, db: null, differenz: null, ok: true });
  });
});

describe('fuehreMigrationAus', () => {
  it('schreibt im Dry-Run nichts in die DB', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'dry-run' });
    expect(r.modus).toBe('dry-run');
    expect(r.projekte.gelesen).toBe(3);
    expect(await listProjekte(getPool(), { jahr: 2026 })).toHaveLength(0);
    expect(r.zaehler.gesetztAuf).toBeNull();
    expect(r.zaehler.hinweis).toContain('rechnung-max');
  });

  it('importiert im Apply-Modus und belegt die Summen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'apply' });
    expect(r.projekte.neu).toBe(3);
    expect(r.auftraggeber.neu).toBe(3);
    expect(r.auftraggeber.ohneAdresse).toBe(3);
    expect(r.konten.angelegt).toBeGreaterThan(0);
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.budgetChf.db).toBeCloseTo(r.summen.budgetChf.csv, 2);
    expect(r.summen.abgerechnet.ok).toBe(true);
    expect(await listProjekte(getPool(), { jahr: 2026 })).toHaveLength(3);
  });

  it('setzt den Zaehler nur mit explizitem Wert', async () => {
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'apply', rechnungMax: 33214 });
    expect(r.zaehler.gesetztAuf).toBe(33214);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('formatiert einen lesbaren Markdown-Report', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'dry-run' });
    const md = formatReport(r);
    expect(md).toContain('# Migrations-Report');
    expect(md).toContain('Projekte');
    expect(md).toContain('ohne Adresse');
  });
});

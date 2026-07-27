import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';
import { formatReport } from '../src/migration/report';

// Fixture mit genau den Faellen, die frueher stillschweigend durchgingen:
// 3001.26 — unlesbare Betraege (Budget CHF/Budget Tage/Aufw. Budget CHF/offen_prov.),
//           unbekanntes Konto 31001, nicht erkanntes MWSt "netto"
// 3002.25 — Spalte Jahr=2026 gegen Nummer .25, zweite Ansprechperson zur Nr. 701
const warnFixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_warnungen.csv');

const sortiert = (ws: string[]) => [...ws].sort();

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('Warnungen im Import', () => {
  it('meldet Betraege, die nicht als Zahl lesbar sind, mit Feld und Rohwert', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    const w = r.warnungen;
    expect(w).toContainEqual(expect.stringContaining(`Budget CHF "24'600.00 CHF"`));
    expect(w).toContainEqual(expect.stringContaining('Budget Tage "ca. 5"'));
    expect(w).toContainEqual(expect.stringContaining('Aufw. Budget CHF "rund 3000"'));
    expect(w).toContainEqual(expect.stringContaining(`offen_prov. "1'000.00 CHF"`));
    // Der Abgleich meldet trotzdem "ok" — genau deshalb braucht es die Warnung.
    expect(r.summen.budgetChf.ok).toBe(true);
  });

  it('meldet ein nicht erkanntes MWSt-Kennzeichen statt still exkl. anzunehmen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    expect(r.warnungen).toContainEqual(expect.stringContaining('MWSt "netto"'));
    // "inkl." bleibt erkannt und warnt nicht.
    expect(r.warnungen.filter((x) => x.includes('MWSt'))).toHaveLength(1);
  });

  it('meldet eine von der Projekt_Nr. abweichende Spalte Jahr', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    expect(r.warnungen).toContainEqual(expect.stringContaining('Spalte Jahr=2026 weicht von der Nummer ab — 2025 verwendet'));
  });

  // Mehrere Ansprechpersonen sind ein Datenbefund, kein Handlungsbedarf: die
  // projektbezogene Ansprechperson bleibt am Projekt, es geht nichts verloren.
  // Darum steht der Eintrag unter Datenbefunde und nicht ueber den Kontierungs-
  // Warnungen, die tatsaechlich jemanden brauchen.
  it('meldet mehrere Ansprechpersonen zur selben Auftraggeber-Nummer als Datenbefund', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    const w = r.datenbefunde.find((x) => x.includes('Ansprechperson'));
    expect(w).toBeDefined();
    expect(w).toContain('701');
    expect(w).toContain('Anna Muster');
    expect(w).toContain('Beat Beispiel');
    expect(r.warnungen.join(' ')).not.toContain('Ansprechperson');
  });

  it('stellt handlungsbeduerftige Warnungen vor die Datenbefunde', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    const md = formatReport(r);
    expect(md).toContain(`## Warnungen (${r.warnungen.length})`);
    expect(md).toContain(`## Datenbefunde (${r.datenbefunde.length})`);
    expect(md.indexOf('## Warnungen')).toBeLessThan(md.indexOf('## Datenbefunde'));
    // Die Kontierungs-Warnung steht vor dem ersten Datenbefund.
    expect(md.indexOf('nicht im Kontenplan')).toBeLessThan(md.indexOf('## Datenbefunde'));
    expect(r.warnungen.every((w) => !r.datenbefunde.includes(w))).toBe(true);
  });

  it('erzeugt im Dry-Run denselben Warnungs- und Befundsatz wie der Apply-Lauf', async () => {
    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'dry-run' });
    const apply = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'apply' });
    expect(sortiert(dry.warnungen)).toEqual(sortiert(apply.warnungen));
    expect(sortiert(dry.datenbefunde)).toEqual(sortiert(apply.datenbefunde));
    expect(dry.warnungen.length).toBeGreaterThanOrEqual(7);
    expect(dry.datenbefunde.length).toBeGreaterThanOrEqual(1);
  });

  it('sagt im Dry-Run, wogegen die Kontenpruefung laeuft', async () => {
    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: warnFixture, modus: 'dry-run' });
    expect(dry.hinweise.join(' ')).toContain('KONTENPLAN');
    expect(formatReport(dry)).toContain('KONTENPLAN');
  });
});

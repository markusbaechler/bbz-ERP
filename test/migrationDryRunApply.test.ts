import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';

// Diese Fixture enthaelt bewusst Luecken (im Gegensatz zu projekte_mini.csv, die als
// Vertragsgrundlage der Tasks 5/6 unveraendert bleibt):
// - 1002.26 hat keinen Projekt_Name -> wird uebersprungen
// - 1003.26 haengt an Auftraggeber_Nr. 503, die in keiner Zeile einen Namen hat -> wird
//   uebersprungen, weil der zugehoerige Auftraggeber selbst nicht importierbar ist
// - 1004.26 hat einen Komma-Dezimalwert ("1234,56") ohne Punkt, um zu pruefen, dass die
//   Dry-Run-Vorschau dieselbe Zahlenauswertung (fmZahl) nutzt wie der Apply-Import.
const luecken = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mit_luecken.csv');

// Drei Projekt_Nr., die nicht dem Format <Stammnummer>.<JJ> entsprechen — die erste
// gleich in der ersten Zeile, damit auch die Jahr-Ableitung des Reports geprueft wird.
const krumm = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_krumme_nummer.csv');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('Dry-Run und Apply auf einer Datei mit uebersprungenen Projekten', () => {
  it('liefern dieselben drei Summen und denselben uebersprungen-Wert', async () => {
    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: luecken, modus: 'dry-run' });
    const apply = await fuehreMigrationAus(getPool(), { projekteCsv: luecken, modus: 'apply' });

    // Die Zaehlung selbst: 2 von 4 Projekten werden uebersprungen, in beiden Modi gleich.
    expect(dry.projekte.gelesen).toBe(4);
    expect(apply.projekte.gelesen).toBe(4);
    expect(dry.projekte.uebersprungen).toBe(2);
    expect(apply.projekte.uebersprungen).toBe(2);

    // Die CSV-Summen (nicht die DB-Summen!) muessen zwischen Dry-Run und Apply identisch
    // sein, weil beide aus derselben Datei dieselben zwei Projekte einschliessen sollen.
    expect(dry.summen.budgetChf.csv).toBeCloseTo(apply.summen.budgetChf.csv, 2);
    expect(dry.summen.offenProv.csv).toBeCloseTo(apply.summen.offenProv.csv, 2);
    expect(dry.summen.abgerechnet.csv).toBeCloseTo(apply.summen.abgerechnet.csv, 2);

    // Sollwerte: nur 1001.26 (1000/200/300) und 1004.26 (1234.56/0/0) zaehlen.
    expect(apply.summen.budgetChf.csv).toBeCloseTo(2234.56, 2);
    expect(apply.summen.offenProv.csv).toBeCloseTo(200, 2);
    expect(apply.summen.abgerechnet.csv).toBeCloseTo(300, 2);

    // Auch die Auftraggeber-Zaehlung ist gleich: 501/502/504 importierbar, 503 nicht
    // (kein Name in irgendeiner Zeile).
    expect(dry.auftraggeber.gelesen).toBe(3);
    expect(apply.auftraggeber.gelesen).toBe(3);
  });
});

describe('Projekt_Nr. ohne das Format <Stammnummer>.<JJ>', () => {
  it('wird in beiden Modi uebersprungen statt den Lauf abzubrechen', async () => {
    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: krumm, modus: 'dry-run' });
    const apply = await fuehreMigrationAus(getPool(), { projekteCsv: krumm, modus: 'apply' });

    expect(dry.projekte.gelesen).toBe(4);
    expect(apply.projekte.gelesen).toBe(4);
    expect(dry.projekte.uebersprungen).toBe(3);   // 123456.26, 1285.2, 1285.26a
    expect(apply.projekte.uebersprungen).toBe(3);
    expect(apply.projekte.neu).toBe(1);           // nur 2001.26

    // Der Skip-Grund ist derselbe Text in beiden Modi.
    const format = (ws: string[]) => ws.filter((w) => w.includes('Format')).sort();
    expect(format(dry.warnungen)).toHaveLength(3);
    expect(format(dry.warnungen)).toEqual(format(apply.warnungen));

    // Nur die uebernommenen Betraege zaehlen — die drei krummen Zeilen nicht.
    expect(apply.summen.budgetChf.csv).toBeCloseTo(1000, 2);
    expect(dry.summen.budgetChf.csv).toBeCloseTo(1000, 2);
  });
});

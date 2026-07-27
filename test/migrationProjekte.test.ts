import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { importStammdaten } from '../src/migration/stammdaten';
import { importAuftraggeber } from '../src/migration/auftraggeber';
import { importProjekte } from '../src/migration/projekte';
import { listProjekte, projektSummen } from '../src/repos/projektRepo';
import { findKontoByNummer } from '../src/repos/kontoRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');
const gruppen = () => gruppiereProjekte(csvRecords(readFileSync(fixture, 'utf8')).records);

let idNachNummer: Map<string, string>;
beforeAll(async () => {
  await resetDb(getPool());
  await importStammdaten(getPool());
  idNachNummer = (await importAuftraggeber(getPool(), gruppen())).idNachNummer;
});
afterAll(async () => { await closePool(); });

describe('importProjekte', () => {
  it('importiert alle Projekte der Fixture', async () => {
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.gelesen).toBe(3);
    expect(r.neu).toBe(3);
    expect(r.uebersprungen).toBe(0);
    const p = await listProjekte(getPool(), { jahr: 2026 });
    expect(p.map((x) => x.nummer).sort()).toEqual(['1285.26', '4991.26', '6231.26']);
  });

  it('uebernimmt Felder und Kontierung', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '1285.26')!;
    expect(p.stammnummer).toBe(1285);
    expect(p.name).toBe('Connect KB (ehem.) WOB');
    expect(p.kuerzel).toBe('WOB');
    expect(p.bereich).toBe('IGK');            // erste Zeile des mehrzeiligen Felds
    expect(p.budgetChf).toBe(24600);
    expect(p.budgetTage).toBe(2.5);
    expect(p.ertragskontoId).toBe((await findKontoByNummer(getPool(), '3010'))!.id);
  });

  it('laesst unbekannte Kontonummern offen und warnt', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '4991.26')!;
    expect(p.ertragskontoId).toBeNull();      // 31001 ist nicht im Kontenplan (Befund B4)
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.warnungen.some((w) => w.includes('31001'))).toBe(true);
    expect(r.aktualisiert).toBe(3);
    expect(r.neu).toBe(0);
  });

  it('verwirft eine numerische Fehleingabe im Bereich', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '4991.26')!;
    expect(p.bereich).toBeNull();             // Rohwert war "3204"
  });

  it('summiert die CSV-Werte und schreibt sie in die DB', async () => {
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.csvSummen.budgetChf).toBeCloseTo(35850, 2);       // 24600 + 11250 + 0
    expect(r.csvSummen.offenProv).toBeCloseTo(24600, 2);
    expect(r.csvSummen.abgerechnet).toBeCloseTo(18955, 2);     // 11250 + 7705
    const s = await projektSummen(getPool(), 2026);
    expect(s.anzahl).toBe(3);
    expect(s.budgetChf).toBeCloseTo(r.csvSummen.budgetChf, 2);
    expect(s.abgerechnet).toBeCloseTo(r.csvSummen.abgerechnet, 2);
  });

  // Die Toleranz des Summenabgleichs haengt an der Zahl der Betraege, die beim
  // Schreiben als numeric(12,2) ueberhaupt etwas verlieren — nicht an der Zahl der
  // Projekte. Der reale Export hat nur zweistellige Nachkommas, dort ist der Wert 0.
  it('zaehlt, wie viele Betraege beim Schreiben gerundet werden', async () => {
    const ohne = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(ohne.csvGerundet).toEqual({ budgetChf: 0, offenProv: 0, abgerechnet: 0 });

    const g = gruppen();
    g.push({ projekt: {
      'Projekt_Nr.': '9996.26', 'Projekt_Name': 'Drei Nachkommastellen', 'Auftraggeber_Nr.': '1285',
      'Budget CHF': '100.005', 'offen_prov.': '50.00', 'abgerechnet': '0.001',
    }, kinder: [] });
    const mit = await importProjekte(getPool(), g, idNachNummer);
    expect(mit.csvGerundet).toEqual({ budgetChf: 1, offenProv: 0, abgerechnet: 1 });
  });

  it('ueberspringt Projekte ohne bekannten Auftraggeber', async () => {
    const g = gruppen();
    g.push({ projekt: { 'Projekt_Nr.': '9997.26', 'Projekt_Name': 'Waise', 'Auftraggeber_Nr.': '77777' }, kinder: [] });
    const r = await importProjekte(getPool(), g, idNachNummer);
    expect(r.uebersprungen).toBe(1);
    expect(r.warnungen.some((w) => w.includes('9997.26'))).toBe(true);
  });
});

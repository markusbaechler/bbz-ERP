import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';
import { formatReport } from '../src/migration/report';
import { listProjekte } from '../src/repos/projektRepo';

const fixture = (n: string) => join(dirname(fileURLToPath(import.meta.url)), `fixtures/${n}`);
const doppelt = fixture('projekte_doppelte_nummer.csv');
const alleUebersprungen = fixture('projekte_alle_uebersprungen.csv');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

// Zwei Zeilen mit derselben Projekt_Nr. ergeben zwei Gruppen, aber wegen des
// Upserts auf (stammnummer, jahr) nur einen Datensatz. Frueher stand der
// Schluessel zweimal in der Liste, das join unnest(...) traf dieselbe Zeile
// zweimal und verdoppelte die DB-Summe genau wie die CSV-Summe — der Abgleich
// meldete "ok", obwohl eine Zeile verlorenging.
describe('doppelte Projekt_Nr. im Export', () => {
  it('zaehlt den Datensatz im Abgleich nur einmal und meldet die Abweichung', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: doppelt, modus: 'apply' });

    expect(await listProjekte(getPool(), { jahr: 2026 })).toHaveLength(2);
    // CSV zaehlt beide Zeilen (100 + 100 + 500), die Datenbank kennt nur zwei Projekte (100 + 500).
    expect(r.summen.budgetChf.csv).toBeCloseTo(700, 2);
    expect(r.summen.budgetChf.db).toBeCloseTo(600, 2);
    expect(r.summen.budgetChf.ok).toBe(false);
    expect(r.summen.offenProv.ok).toBe(false);
    expect(r.summen.abgerechnet.ok).toBe(false);
    expect(formatReport(r)).toContain('ABWEICHUNG');
  });

  it('meldet die doppelte Nummer als Warnung — in beiden Modi', async () => {
    const treffer = (ws: string[]) => ws.filter((w) => w.includes('9101.26') && w.includes('derselben Projekt_Nr.'));
    const apply = await fuehreMigrationAus(getPool(), { projekteCsv: doppelt, modus: 'apply' });
    expect(treffer(apply.warnungen)).toHaveLength(1);
    const dry = await fuehreMigrationAus(getPool(), { projekteCsv: doppelt, modus: 'dry-run' });
    expect(treffer(dry.warnungen)).toHaveLength(1);
    // Eine doppelte Nummer ist handlungsbeduerftig, kein blosser Datenbefund.
    expect(apply.datenbefunde.join(' ')).not.toContain('derselben Projekt_Nr.');
  });
});

// Bleibt nach den Ueberspring-Regeln kein einziges Projekt uebrig, gibt es nichts
// abzugleichen. "0.00 | 0.00 | 0.00 | ok" behauptet dagegen einen erfolgreichen
// Abgleich von nichts.
describe('vollstaendig uebersprungener Lauf', () => {
  it('zeigt kein Abgleichsergebnis statt einer gruenen Null', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: alleUebersprungen, modus: 'apply' });
    expect(r.projekte.gelesen).toBe(3);
    expect(r.projekte.uebersprungen).toBe(3);
    expect(r.projekte.neu).toBe(0);

    for (const s of [r.summen.budgetChf, r.summen.offenProv, r.summen.abgerechnet]) {
      expect(s.db).toBeNull();
      expect(s.differenz).toBeNull();
    }
    const md = formatReport(r);
    expect(md).toContain('| Budget CHF | 0.00 | — | — | ok |');
    expect(md).not.toContain('| 0.00 | 0.00 | 0.00 |');
  });
});

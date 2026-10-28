import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { seedDemo } from '../src/db/seedDemo';
import { demoDateien } from '../src/db/demoDateien';
import { heuteIso } from '../src/domain/crm';
import { listSpesen } from '../src/repos/spesenRepo';
import { sammelrechnungVorschau } from '../src/repos/sammelrechnungRepo';
import { importiereKursdatenBericht } from '../src/integrations/moodle/buchungen';
import { verbucheCamt054 } from '../src/repos/zahlungImportRepo';
import { pruefeDemoDb } from '../tools/demo/neu';

/*
 * Lokale Testumgebung (npm run demo:neu): Die Demo-Daten decken auch die Funktionen ab, die aus FileMaker weiter
 * gebraucht werden (Sammelrechnung je Bank, Spesen, Moodle-Import ueber die Seminarnummer, Bankfile camt.054).
 */
const pool = getPool();
const HEUTE = heuteIso();
const vorTagen = (n: number) => { const d = new Date(`${HEUTE}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

beforeAll(async () => { await resetDb(pool); await seedDemo(pool, () => {}); });
afterAll(async () => { await closePool(); });

describe('Demo-Daten der Testumgebung', () => {
  it('jede Durchfuehrung hat eine Seminarnummer (Schluessel zu Moodle)', async () => {
    const r = (await pool.query('select count(*)::int as n, count(seminarnummer)::int as mit from durchfuehrung')).rows[0];
    expect(r.n).toBeGreaterThan(0);
    expect(r.mit).toBe(r.n);
  });

  it('ein Projekt hat offene Spesen (Fahrt und Auslage) zum Weiterverrechnen', async () => {
    const projektId = (await pool.query('select id from projekt where stammnummer=6301')).rows[0].id;
    const offen = await listSpesen(pool, { projektId, offen: true });
    expect(offen.map((s) => s.art).sort()).toEqual(['auslage', 'km']);
  });

  it('die Sammelrechnung der letzten 60 Tage hat Banken als Empfaenger', async () => {
    const v = await sammelrechnungVorschau(pool, { von: vorTagen(60), bis: HEUTE });
    expect(v.empfaenger.map((e) => e.name)).toEqual(expect.arrayContaining(['Musterbank AG', 'Regionalbank Beispielsee AG']));
  });
});

describe('Beispieldateien der Testumgebung', () => {
  it('der Moodle-Bericht laesst sich importieren; die Bank setzt den Rechnungsempfaenger', async () => {
    const { moodleKursdatenCsv } = await demoDateien(pool);
    const e = await importiereKursdatenBericht(pool, moodleKursdatenCsv, 'ml');
    expect(e.unbekannteSeminarnummern).toEqual([]);
    expect(e.ohneSeminarnummer).toBe(0);
    expect(e.seminare.flatMap((x) => x.fehler)).toEqual([]);
    expect(e.seminare.reduce((s, x) => s + x.neu, 0)).toBe(3);
    const r = (await pool.query(
      `select ag.name from anmeldung a join kontakt k on k.id=a.kontakt_id left join auftraggeber ag on ag.id=a.rechnungsempfaenger_id
       where a.quelle='moodle' order by k.nachname`)).rows.map((x) => x.name);
    expect(r).toEqual(expect.arrayContaining(['Musterbank AG', null]));
  });

  it('die camt.054-Datei begleicht den Rest der ueberfaelligen Rechnung und meldet eine unbekannte Zahlung', async () => {
    const { camt054 } = await demoDateien(pool);
    const e = await verbucheCamt054(pool, camt054, 'ml');
    expect(e.verbucht).toHaveLength(1);
    expect(e.verbucht[0]).toMatchObject({ rechnungStatus: 'bezahlt', offen: 0 });
    expect(e.nichtZugeordnet).toHaveLength(1);
  });
});

describe('Schutz der Demo-Datenbank', () => {
  it('setzt nur eine lokale Datenbank mit "demo" im Namen neu auf', () => {
    expect(() => pruefeDemoDb('postgres://bbz:bbz@localhost:5433/bbz_demo')).not.toThrow();
    expect(() => pruefeDemoDb('postgres://bbz:bbz@127.0.0.1:5433/bbz_demo')).not.toThrow();
    expect(() => pruefeDemoDb('postgres://bbz:bbz@localhost:5433/bbz_test')).toThrow(/demo/);
    expect(() => pruefeDemoDb('postgres://u:p@erp-db.postgres.database.azure.com:5432/bbz_demo')).toThrow(/lokal/);
    expect(() => pruefeDemoDb(undefined)).toThrow(/DATABASE_URL/);
  });
});

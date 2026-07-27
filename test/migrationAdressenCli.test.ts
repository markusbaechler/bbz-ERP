import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';
import { formatReport } from '../src/migration/report';
import { findAuftraggeberByNummer } from '../src/repos/auftraggeberRepo';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const hier = dirname(fileURLToPath(import.meta.url));
const projekte = join(hier, 'fixtures/projekte_mini.csv');
const adressen = join(hier, 'fixtures/adressen_mini.csv');
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://bbz:bbz@localhost:5433/bbz_test' };

// Wie in migrate.test.ts / zaehlerCli.test.ts: der Einstiegspunkt wird wirklich
// gestartet, sonst bleibt ein Windows-Pfadproblem im argv-Vergleich unbemerkt.
function laufe(...args: string[]): { code: number; aus: string } {
  try {
    const aus = execSync(['npx tsx src/migration/run.ts', ...args].join(' '), {
      cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, aus };
  } catch (e: any) {
    return { code: typeof e.status === 'number' ? e.status : 1, aus: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('CLI-Argumente', () => {
  // --projekte war Pflicht. Der Adressexport kommt aber nach dem Projekt-Import;
  // ein Nachtrag muss allein laufen koennen.
  it('verlangt mindestens eines von --projekte / --adressen', () => {
    const r = laufe();
    expect(r.code).toBe(2);
    expect(r.aus).toContain('--projekte');
    expect(r.aus).toContain('--adressen');
  }, 60000);

  it('laeuft mit --adressen allein', () => {
    const r = laufe(`--adressen=${adressen}`);
    expect(r.code).toBe(0);
    expect(r.aus).toContain('Adressen-Nachtrag');
  }, 60000);

  it('meldet eine unlesbare Adressdatei sauber statt mit Stacktrace', () => {
    const r = laufe('--adressen=test/fixtures/gibt_es_nicht.csv');
    expect(r.code).toBe(2);
    expect(r.aus).toContain('gibt_es_nicht.csv');
    expect(r.aus).not.toContain('at ');
  }, 60000);
});

describe('Report', () => {
  it('waechst ohne --adressen keinen leeren Abschnitt', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: projekte, modus: 'apply' });
    expect(r.adressen).toBeNull();
    expect(formatReport(r)).not.toContain('Adressen-Nachtrag');
  });

  it('laesst bei --adressen allein die Projekt-Abschnitte weg statt sie mit Nullen zu fuellen', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: adressen, modus: 'dry-run' });
    const md = formatReport(r);
    expect(r.projekteLauf).toBe(false);
    expect(md).not.toContain('Summenabgleich');
    expect(md).not.toContain('Uebernommene Datensaetze');
    expect(md).toContain('Adressen-Nachtrag');
  });

  it('beantwortet im Adress-Abschnitt gelesen/zugeordnet/geschrieben/weiterhin gesperrt', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: adressen, modus: 'apply' });
    expect(r.adressen).not.toBeNull();
    expect(r.adressen!.eintraege).toBe(5);
    expect(r.adressen!.getroffen).toBe(3);          // projekte_mini kennt 1285, 1260, 20577
    expect(r.adressen!.ohneTreffer).toBe(2);        // 1124 und 88888 stehen nicht in der DB
    expect(r.adressen!.geschrieben).toBe(2);
    expect(r.adressen!.nochOhneAdresse).toEqual([{ nummer: '20577', name: 'bbz st.gallen ag' }]);

    const md = formatReport(r);
    expect(md).toContain('20577');
    expect(md).toContain('bbz st.gallen ag');
  });

  it('sortiert den weiterhin gesperrten Auftraggeber unter Warnungen, die CH-Annahme unter Datenbefunde', async () => {
    const r = await fuehreMigrationAus(getPool(), { adressenCsv: adressen, modus: 'dry-run' });
    expect(r.warnungen.some((w) => w.includes('20577'))).toBe(true);
    expect(r.datenbefunde.some((d) => d.includes('1260') && d.includes('angenommen'))).toBe(true);
    expect(r.warnungen.some((w) => w.includes('angenommen'))).toBe(false);
  });

  it('nimmt beide Dateien in einem Lauf — erst Projekte, dann Adressen', async () => {
    await resetDb(getPool());
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: projekte, adressenCsv: adressen, modus: 'apply' });
    expect(r.projekte.neu).toBe(3);
    expect(r.adressen!.geschrieben).toBe(2);
    const ag = await findAuftraggeberByNummer(getPool(), '1285');
    expect(ag?.adresseUnvollstaendig).toBe(false);
  });
});

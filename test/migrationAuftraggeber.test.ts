import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { importAuftraggeber } from '../src/migration/auftraggeber';
import { findAuftraggeberByNummer } from '../src/repos/auftraggeberRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');
const gruppen = () => gruppiereProjekte(csvRecords(readFileSync(fixture, 'utf8')).records);

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('importAuftraggeber', () => {
  it('legt je Nummer genau einen Auftraggeber an', async () => {
    const r = await importAuftraggeber(getPool(), gruppen());
    expect(r.gelesen).toBe(3);
    expect(r.neu).toBe(3);
    expect(r.ohneAdresse).toBe(3);
    expect(r.idNachNummer.size).toBe(3);
    expect((await findAuftraggeberByNummer(getPool(), '1285'))?.name).toBe('Connect KB (ehem.) WOB');
  });

  it('zerlegt mehrzeilige Namen in Name und Zusatz', async () => {
    const a = await findAuftraggeberByNummer(getPool(), '1260');
    expect(a?.name).toBe('Universität St. Gallen');
    expect(a?.zusatz).toBe('Institut für Banken und Finanzen');
    expect(a?.adresseUnvollstaendig).toBe(true);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await importAuftraggeber(getPool(), gruppen());
    expect(r.neu).toBe(0);
    expect(r.aktualisiert).toBe(3);
  });

  it('warnt bei abweichendem Namen zur gleichen Nummer und ueberspringt Zeilen ohne Nummer', async () => {
    const g = gruppen();
    g.push({ projekt: { 'Projekt_Nr.': '9999.26', Auftraggeber: 'Connect KB anders', 'Auftraggeber_Nr.': '1285' }, kinder: [] });
    g.push({ projekt: { 'Projekt_Nr.': '9998.26', Auftraggeber: 'Ohne Nummer', 'Auftraggeber_Nr.': '' }, kinder: [] });
    const r = await importAuftraggeber(getPool(), g);
    expect(r.warnungen.some((w) => w.includes('1285'))).toBe(true);
    expect(r.warnungen.some((w) => w.includes('9998.26'))).toBe(true);
    expect((await findAuftraggeberByNummer(getPool(), '1285'))?.name).toBe('Connect KB (ehem.) WOB');
  });
});

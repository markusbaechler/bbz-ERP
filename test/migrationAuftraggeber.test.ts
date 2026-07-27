import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { importAuftraggeber, sammleAuftraggeber } from '../src/migration/auftraggeber';
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

  // Der abweichende Name ist ein Datenbefund (der erste gewinnt, es geht nichts
  // verloren); die Zeile ohne Auftraggeber-Nr. ist handlungsbeduerftig, weil das
  // Projekt daran uebersprungen wird.
  it('trennt den abweichenden Namen (Datenbefund) von der Zeile ohne Nummer (Warnung)', async () => {
    const g = gruppen();
    g.push({ projekt: { 'Projekt_Nr.': '9999.26', Auftraggeber: 'Connect KB anders', 'Auftraggeber_Nr.': '1285' }, kinder: [] });
    g.push({ projekt: { 'Projekt_Nr.': '9998.26', Auftraggeber: 'Ohne Nummer', 'Auftraggeber_Nr.': '' }, kinder: [] });
    const r = await importAuftraggeber(getPool(), g);
    expect(r.datenbefunde.some((w) => w.includes('1285'))).toBe(true);
    expect(r.warnungen.some((w) => w.includes('1285'))).toBe(false);
    expect(r.warnungen.some((w) => w.includes('9998.26'))).toBe(true);
    expect((await findAuftraggeberByNummer(getPool(), '1285'))?.name).toBe('Connect KB (ehem.) WOB');
  });
});

// Im echten Export steht bei Auftraggeber 20577 sowohl "Alexander  Facchinetti"
// (doppeltes Leerzeichen) als auch "Alexander Facchinetti". Auf dem Rohstring
// verglichen sind das zwei Personen — der erste Eintrag, den ein Operator im
// Report sieht, waere damit schlicht falsch.
describe('sammleAuftraggeber: Ansprechpersonen', () => {
  const mitPersonen = (...personen: string[]) =>
    personen.map((p, i) => ({
      projekt: { 'Projekt_Nr.': `77${i}0.26`, Auftraggeber: 'Firma Z', 'Auftraggeber_Nr.': '7700', Ansprechperson: p },
      kinder: [],
    }));

  it('zaehlt nur nach Wortabstand verschiedene Schreibweisen nicht als zwei Personen', () => {
    const r = sammleAuftraggeber(mitPersonen('Alexander  Facchinetti', 'Alexander Facchinetti'));
    expect(r.datenbefunde.filter((d) => d.includes('Ansprechperson'))).toHaveLength(0);
    expect(r.warnungen.filter((d) => d.includes('Ansprechperson'))).toHaveLength(0);
  });

  it('meldet echte Unterschiede weiter und zeigt je Person eine Schreibweise', () => {
    const r = sammleAuftraggeber(mitPersonen('Alexander  Facchinetti', 'Alexander Facchinetti', 'Susan Rufer'));
    const d = r.datenbefunde.find((x) => x.includes('Ansprechperson'));
    expect(d).toBeDefined();
    expect(d).toContain('2 verschiedene Ansprechpersonen');
    expect(d).toContain('"Alexander  Facchinetti"');   // erste Schreibweise, unveraendert
    expect(d).not.toContain('"Alexander Facchinetti"');
    expect(d).toContain('"Susan Rufer"');
  });
});

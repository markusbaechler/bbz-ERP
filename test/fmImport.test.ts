import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createKonto } from '../src/repos/kontoRepo';
import { parseCsv, zahl, datum } from '../tools/fm-import/csv';
import { importiere, berichtMarkdown, projektnummer, type Mapping, type Quellen } from '../tools/fm-import/import';
import { festschreiben, createRechnung, addPosition } from '../src/repos/rechnungRepo';

const pool = getPool();
const DIR = join(__dirname, 'fixtures/fm-export');
const mapping = JSON.parse(readFileSync(join(__dirname, '../tools/fm-import/mapping.beispiel.json'), 'utf8')) as Mapping;
const quellen: Quellen = Object.fromEntries(Object.entries(mapping).filter(([k]) => !k.startsWith('_'))
  .map(([t, m]: [string, any]) => [t, readFileSync(join(DIR, m.datei), 'utf8')]));

beforeAll(async () => { await resetDb(pool); await createKonto(pool, { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' }); });
afterAll(async () => { await closePool(); });

describe('fm-import: CSV-Lesen', () => {
  it('liest .mer mit Kopfzeile, Anfuehrungszeichen, FileMaker-Zeilenumbruch (\\x0B) und Wiederholfeldern', () => {
    const z = parseCsv('A;B\r\n"x;y";"Zeile 1\x0BZeile 2"\r\n"mit ""Zitat""";w1\x1Dw2\r\n');
    expect(z).toEqual([['A', 'B'], ['x;y', 'Zeile 1\nZeile 2'], ['mit "Zitat"', 'w1']]);
  });
  it('liest Schweizer Zahlen und Datumsformate', () => {
    expect([zahl("24'600.00"), zahl('12000,50'), zahl('CHF 1 081.00'), zahl(''), zahl('abc')]).toEqual([24600, 12000.5, 1081, null, NaN]);
    expect([datum('23.07.2026'), datum('7/23/2026'), datum('2026-07-23'), datum('31.02.2026'), datum('')]).toEqual(['2026-07-23', '2026-07-23', '2026-07-23', 'ungueltig', null]);
    expect(projektnummer('6231.26')).toEqual({ stammnummer: 6231, jahr: 2026 });
    expect(projektnummer('kaputt')).toBeNull();
  });
});

describe('fm-import: Migration', () => {
  it('Probelauf prueft alles und speichert nichts', async () => {
    const b = await importiere(pool, quellen, mapping, { probelauf: true });
    expect(b.zaehler.projekte.neu).toBe(3);
    expect((await pool.query('select count(*)::int as n from projekt')).rows[0].n).toBe(0);
    expect((await pool.query(`select wert from zaehler where name='rechnung_lfd_nr'`)).rows[0].wert).toBe(0);
  });

  it('Import: Zaehler, Fehler je Zeile, Hinweise, Summen fuer den Abgleich', async () => {
    const b = await importiere(pool, quellen, mapping, { probelauf: false });
    expect(b.zaehler.mitarbeitende).toMatchObject({ gelesen: 2, neu: 2 });
    expect(b.zaehler.auftraggeber).toMatchObject({ gelesen: 3, neu: 3, fehler: 0 });
    expect(b.hinweise.join('\n')).toMatch(/20579.*nur als CRM-Organisation/);
    expect(b.hinweise.join('\n')).toMatch(/Konto 9999 fehlt/);
    expect(b.zaehler.projekte).toMatchObject({ gelesen: 5, neu: 3, fehler: 2 });
    expect(b.fehler.filter((f) => f.tabelle === 'projekte').map((f) => f.fehler)).toEqual(['Auftraggeber 20579 nicht vorhanden', 'Projektnummer unlesbar: kaputt']);
    expect(b.zaehler.kontakte).toMatchObject({ gelesen: 4, neu: 2, vorhanden: 1, fehler: 1 });
    expect(b.zaehler.rechnungen).toMatchObject({ gelesen: 4, neu: 3, fehler: 1 });
    expect(b.zaehlerstandRechnung).toBe(33214);
    expect(b.summen.rechnungen).toEqual({ anzahl: 3, bruttoChf: 11572.1, bezahltChf: 2081, offenChf: 9491.1 });
    expect(b.summen.offenJeAuftraggeber.map((o) => [o.nummer, o.offenChf])).toEqual([['20577', 8329.1], ['20578', 1162]]);
    expect(b.summen.projekteJeJahr).toEqual([{ jahr: 2025, anzahl: 1, budgetChf: 20000 }, { jahr: 2026, anzahl: 2, budgetChf: 36600.5 }]);

    const p = (await pool.query(`select status, budget_chf, beschrieb, ertragskonto_id from projekt where nummer='6231.26'`)).rows[0];
    expect(p).toMatchObject({ status: 'laufend', budget_chf: '24600.00', beschrieb: 'Zeile 1\nZeile 2' });
    expect(p.ertragskonto_id).not.toBeNull();
    expect((await pool.query(`select status from projekt where nummer='6231.25'`)).rows[0].status).toBe('abgeschlossen');
    const ag = (await pool.query(`select organisation_id from auftraggeber where nummer='20577'`)).rows[0];
    expect(ag.organisation_id).not.toBeNull();
    const k = (await pool.query(`select k.email, o.name from kontakt k join organisation o on o.id=k.organisation_id where k.nachname='Muster'`)).rows[0];
    expect(k).toEqual({ email: 'erika.muster@beispielkb.test', name: 'Beispiel Kantonalbank' });
    expect(berichtMarkdown(b)).toContain('naechste Rechnung: 33215');
  });

  it('ist idempotent und die naechste ERP-Rechnung schliesst lueckenlos an FileMaker an', async () => {
    const b = await importiere(pool, quellen, mapping, { probelauf: false });
    expect(b.zaehler.projekte.neu).toBe(0);
    expect(b.zaehler.rechnungen).toMatchObject({ neu: 0, vorhanden: 3 });
    const p = (await pool.query(`select id, auftraggeber_id from projekt where nummer='6231.26'`)).rows[0];
    const r = await createRechnung(pool, { projektId: p.id, auftraggeberId: p.auftraggeber_id, datum: '2026-11-01' });
    await addPosition(pool, r.id, { beschreibung: 'Test', menge: 1, einzelpreis: 100, mwstSatz: 0 });
    expect((await festschreiben(pool, r.id, 'ml')).lfdNr).toBe(33215);
  });

  it('Zaehlerstart aus FileMaker (naechster Serienwert) wird respektiert', async () => {
    const b = await importiere(pool, {}, mapping, { probelauf: true, zaehlerStart: 40000 });
    expect(b.zaehlerstandRechnung).toBe(39999);
  });
});

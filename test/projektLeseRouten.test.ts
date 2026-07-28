import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { upsertProjektAusMigration } from '../src/repos/projektRepo';
import { createKonto } from '../src/repos/kontoRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import type { MigrationProjektInput } from '../src/domain/types';

const app = buildApp(getPool());
let auftraggeberId: string; let projektId: string; let kontoId: string;

beforeAll(async () => {
  await resetDb(getPool());
  await setzeRechnungZaehler(getPool(), 33214, 'test');
  auftraggeberId = (await createAuftraggeber(getPool(), {
    nummer: '1069', name: 'Urner Kantonalbank', strasse: 'Postfach', plz: '6460', ort: 'Altdorf',
  })).id;
  kontoId = (await createKonto(getPool(), { nummer: '3101', bezeichnung: 'Grundbildung', typ: 'Ertrag' })).id;

  const basis: MigrationProjektInput = {
    stammnummer: 5934, jahr: 2026, name: 'Lehrgang Bankfachgrundbildung', auftraggeberId,
    kuerzel: 'BFG', bereich: 'Banking', beschrieb: 'Grundbildung ZUNO', ansprechperson: 'Peter Muster',
    ertragskontoId: kontoId, aufwandKontoId: null, budgetChf: 24600, budgetTage: 12,
    aufwandBudgetChf: 3000, fmOffenProv: 10000, fmAbgerechnet: 14600,
    alteProjektNr: '5934.25', projektleitungKuerzel: 'ml', mwstModus: 'exkl',
    erstelltDurch: 'p.meier', geaendertDurch: 'm.lippuner',
  };
  projektId = (await upsertProjektAusMigration(getPool(), basis)).projekt.id;
  await upsertProjektAusMigration(getPool(), { ...basis, stammnummer: 1285, name: 'Connect KB', budgetChf: 1000, fmAbgerechnet: null, fmOffenProv: null });
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('GET /projekt (Liste)', () => {
  it('liefert den Auftraggeber-Namen und die FileMaker-Staende mit', async () => {
    const r = await app.inject({ method: 'GET', url: '/projekt?jahr=2026' });
    expect(r.statusCode).toBe(200);
    const zeilen = r.json();
    expect(zeilen).toHaveLength(2);
    const p = zeilen.find((z: any) => z.nummer === '5934.26');
    expect(p.auftraggeberName).toBe('Urner Kantonalbank');
    expect(p.budgetChf).toBe(24600);
    expect(p.fmAbgerechnet).toBe(14600);
    expect(p.fmOffenProv).toBe(10000);
    expect(p.bereich).toBe('Banking');
  });

  it('sortiert nach Nummer und behaelt null-Staende als null', async () => {
    const zeilen = (await app.inject({ method: 'GET', url: '/projekt' })).json();
    expect(zeilen.map((z: any) => z.nummer)).toEqual(['1285.26', '5934.26']);
    expect(zeilen[0].fmAbgerechnet).toBeNull();
  });
});

describe('GET /projekt/:id (Detail)', () => {
  it('liefert Auftraggeber-Adresse, Kontierung und Freitexte', async () => {
    const d = (await app.inject({ method: 'GET', url: `/projekt/${projektId}` })).json();
    expect(d.nummer).toBe('5934.26');
    expect(d.auftraggeberName).toBe('Urner Kantonalbank');
    expect(d.auftraggeberStrasse).toBe('Postfach');
    expect(d.auftraggeberPlz).toBe('6460');
    expect(d.auftraggeberOrt).toBe('Altdorf');
    expect(d.auftraggeberAdresseUnvollstaendig).toBe(false);
    expect(d.ansprechperson).toBe('Peter Muster');
    expect(d.beschrieb).toBe('Grundbildung ZUNO');
    expect(d.projektleitungKuerzel).toBe('ml');
    expect(d.alteProjektNr).toBe('5934.25');
    expect(d.aufwandBudgetChf).toBe(3000);
    expect(d.ertragskontoNummer).toBe('3101');
    expect(d.ertragskontoBezeichnung).toBe('Grundbildung');
    expect(d.aufwandKontoNummer).toBeNull();
  });

  it('antwortet 404 fuer eine unbekannte Id', async () => {
    const r = await app.inject({ method: 'GET', url: '/projekt/00000000-0000-0000-0000-000000000000' });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /projekt/:id/rechnungen', () => {
  it('liefert leere Liste, wenn das Projekt keine Rechnungen hat', async () => {
    const r = await app.inject({ method: 'GET', url: `/projekt/${projektId}/rechnungen` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it('liefert Nummer, Datum, Status und Bruttototal, neueste zuerst', async () => {
    const alt = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-03-01', mwstModus: 'exkl' });
    await addPosition(getPool(), alt.id, { beschreibung: 'Vorbereitung', menge: 1, einzelpreis: 500, mwstSatz: 8.1 });
    await festschreiben(getPool(), alt.id, 'ml');
    const neu = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-27', mwstModus: 'exkl' });
    await addPosition(getPool(), neu.id, { beschreibung: 'Kurstage', menge: 2, einzelpreis: 1000, mwstSatz: 8.1 });

    const zeilen = (await app.inject({ method: 'GET', url: `/projekt/${projektId}/rechnungen` })).json();
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0].datum).toBe('2026-07-27');
    expect(zeilen[0].status).toBe('offen_prov');
    expect(zeilen[0].nummer).toBeNull();
    expect(zeilen[0].totalBrutto).toBe(2162);
    expect(zeilen[1].status).toBe('abgerechnet');
    expect(zeilen[1].nummer).toBe('5934.26 - 33215 ml');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { buildApp } from '../src/server/app';
import { createKonto } from '../src/repos/kontoRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, listPositionen } from '../src/repos/rechnungRepo';
import { createSpesen, listSpesen, spesenVerrechnen } from '../src/repos/spesenRepo';
import { ValidationError } from '../src/domain/errors';

/* Spesen weiterverrechnen (FileMaker "Spesen Importieren" / pos_fak1_P: Datum, Anzahl_km, Strecke, Betrag je Projekt). */
const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };
let projektId: string; let anderesProjekt: string; let kontoId: string;

beforeAll(async () => {
  await resetDb(pool);
  kontoId = (await createKonto(pool, { nummer: '3000', bezeichnung: 'Unternehmensberatung', typ: 'Ertrag' })).id;
  const ag = (await createAuftraggeber(pool, { name: 'Bank S', strasse: 'S 1', plz: '9000', ort: 'St. Gallen' })).id;
  projektId = (await createProjekt(pool, { stammnummer: 7200, jahr: 2026, name: 'Workshop', auftraggeberId: ag, ertragskontoId: kontoId })).id;
  anderesProjekt = (await createProjekt(pool, { stammnummer: 7201, jahr: 2026, name: 'Anderes', auftraggeberId: ag })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Spesen', () => {
  it('erfasst km-Spesen und Auslagen; Betrag = Menge x Ansatz', async () => {
    const km = await createSpesen(pool, { projektId, datum: '2026-10-05', art: 'km', beschreibung: 'Fahrt St. Gallen–Zürich', menge: 120, ansatzChf: 0.7 }, 'ml');
    expect(km).toMatchObject({ art: 'km', menge: 120, ansatzChf: 0.7, betragChf: 84, verrechenbar: true, rechnungspositionId: null, erfasstDurch: 'ml' });
    await createSpesen(pool, { projektId, datum: '2026-10-06', art: 'auslage', beschreibung: 'Hotel', ansatzChf: 180 }, 'ml');
    await createSpesen(pool, { projektId, datum: '2026-10-06', art: 'auslage', beschreibung: 'Verpflegung intern', ansatzChf: 25, verrechenbar: false }, 'ml');
    expect((await listSpesen(pool, { projektId })).map((s) => s.beschreibung)).toEqual(['Fahrt St. Gallen–Zürich', 'Hotel', 'Verpflegung intern']);
  });

  it('prueft die Eingaben', async () => {
    await expect(createSpesen(pool, { projektId, datum: '05.10.2026', art: 'km', beschreibung: 'x', menge: 1, ansatzChf: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSpesen(pool, { projektId, datum: '2026-10-05', art: 'flug' as any, beschreibung: 'x', ansatzChf: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSpesen(pool, { projektId, datum: '2026-10-05', art: 'km', beschreibung: 'x', menge: 0, ansatzChf: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSpesen(pool, { projektId, datum: '2026-10-05', art: 'auslage', beschreibung: ' ', ansatzChf: 10 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('verrechnet offene, verrechenbare Spesen als Positionen (Ertragskonto des Projekts) und nur einmal', async () => {
    const e = await spesenVerrechnen(pool, projektId, { datum: '2026-10-31', mwstSatz: 8.1 }, 'ml');
    expect(e.rechnung.betreff).toBe('Spesen: Workshop');
    expect(e.positionen.map((p) => [p.beschreibung, p.einheit, p.menge, p.einzelpreis, p.kontoId])).toEqual([
      ['Spesen 05.10.2026: Fahrt St. Gallen–Zürich', 'km', 120, 0.7, kontoId],
      ['Spesen 06.10.2026: Hotel', 'Pauschal', 1, 180, kontoId],
    ]);
    expect((await listSpesen(pool, { projektId, offen: true })).map((s) => s.beschreibung)).toEqual(['Verpflegung intern']);
    await expect(spesenVerrechnen(pool, projektId, { datum: '2026-10-31', mwstSatz: 8.1 })).rejects.toThrow(/Keine verrechenbaren Spesen/);
  });

  it('haengt an einen bestehenden Entwurf desselben Projekts an (z. B. nach zeit-verrechnen)', async () => {
    await createSpesen(pool, { projektId, datum: '2026-11-02', art: 'auslage', beschreibung: 'Raummiete', ansatzChf: 300 });
    const ag = (await pool.query('select auftraggeber_id from projekt where id=$1', [projektId])).rows[0].auftraggeber_id;
    const fremd = await createRechnung(pool, { projektId: anderesProjekt, auftraggeberId: ag, datum: '2026-11-30' });
    await expect(spesenVerrechnen(pool, projektId, { datum: '2026-11-30', mwstSatz: 8.1, rechnungId: fremd.id })).rejects.toThrow(/gehoert nicht zum Projekt/);
    const entwurf = await createRechnung(pool, { projektId, auftraggeberId: ag, datum: '2026-11-30' });
    const e = await spesenVerrechnen(pool, projektId, { datum: '2026-11-30', mwstSatz: 8.1, rechnungId: entwurf.id });
    expect(e.rechnung.id).toBe(entwurf.id);
    expect((await listPositionen(pool, entwurf.id)).map((p) => p.beschreibung)).toEqual(['Spesen 02.11.2026: Raummiete']);
  });

  it('Routen: erfassen, auflisten, loeschen (nur unverrechnet), verrechnen (Admin)', async () => {
    const neu = await app.inject({ method: 'POST', url: `/projekt/${projektId}/spesen`, payload: { datum: '2026-12-01', art: 'km', beschreibung: 'Fahrt', menge: 10, ansatzChf: 0.7 } });
    expect(neu.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/projekt/${projektId}/spesen?offen=true` })).json().map((s: any) => s.beschreibung)).toEqual(['Verpflegung intern', 'Fahrt']);
    const verrechnet = (await listSpesen(pool, { projektId })).find((s) => s.beschreibung === 'Hotel')!;
    expect((await app.inject({ method: 'DELETE', url: `/spesen/${verrechnet.id}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/projekt/${projektId}/spesen-verrechnen`, payload: { datum: '2026-12-31', mwstSatz: 8.1 } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: `/projekt/${projektId}/spesen-verrechnen`, headers: admin, payload: { datum: '2026-12-31', mwstSatz: 8.1 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().positionen).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/spesen/${neu.json().id}` })).statusCode).toBe(409);
  });
});

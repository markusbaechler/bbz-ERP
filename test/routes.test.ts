import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { upsertAuftraggeberAusMigration } from '../src/repos/auftraggeberRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
beforeAll(async () => { await resetDb(getPool()); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('routes', () => {
  it('legt Auftraggeber + Projekt an und liest sie', async () => {
    const a = await app.inject({ method: 'POST', url: '/auftraggeber', headers: admin,
      payload: { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' } });
    expect(a.statusCode).toBe(201);
    const auftraggeberId = a.json().id;

    const p = await app.inject({ method: 'POST', url: '/projekt', headers: admin,
      payload: { stammnummer: 6231, jahr: 2026, name: 'Testprojekt', auftraggeberId } });
    expect(p.statusCode).toBe(201);
    expect(p.json().nummer).toBe('6231.26');

    const list = await app.inject({ method: 'GET', url: '/projekt?jahr=2026' });
    expect(list.json().length).toBe(1);
  });
  it('400 bei unvollständiger Adresse', async () => {
    const res = await app.inject({ method: 'POST', url: '/auftraggeber', headers: admin,
      payload: { name: 'X', strasse: 'Y', plz: '', ort: '' } });
    expect(res.statusCode).toBe(400);
  });
  it('403 ohne Admin-Rolle', async () => {
    const res = await app.inject({ method: 'POST', url: '/auftraggeber',
      payload: { name: 'X', strasse: 'Y', plz: '1', ort: 'Z' } });
    expect(res.statusCode).toBe(403);
  });

  // PUT /auftraggeber/:id ist der einzige Weg, eine aus der Migration stammende
  // Adresse zu ergaenzen und den Auftraggeber damit fakturierbar zu machen.
  it('ergaenzt eine Adresse per PUT und loescht adresseUnvollstaendig', async () => {
    const id = (await upsertAuftraggeberAusMigration(getPool(), { nummer: '50001', name: 'Migriert AG' }))
      .auftraggeber.id;

    const teil = await app.inject({ method: 'PUT', url: `/auftraggeber/${id}`, headers: admin,
      payload: { strasse: 'Bahnhofstrasse 1', email: 'kb@example.ch' } });
    expect(teil.statusCode).toBe(200);
    expect(teil.json().strasse).toBe('Bahnhofstrasse 1');
    expect(teil.json().email).toBe('kb@example.ch');
    expect(teil.json().adresseUnvollstaendig).toBe(true);

    const voll = await app.inject({ method: 'PUT', url: `/auftraggeber/${id}`, headers: admin,
      payload: { plz: '6460', ort: 'Altdorf' } });
    expect(voll.statusCode).toBe(200);
    expect(voll.json().adresseUnvollstaendig).toBe(false);

    const leer = await app.inject({ method: 'PUT', url: `/auftraggeber/${id}`, headers: admin,
      payload: { ort: '' } });
    expect(leer.statusCode).toBe(400);

    const fehlt = await app.inject({ method: 'PUT', url: '/auftraggeber/00000000-0000-0000-0000-000000000000',
      headers: admin, payload: { ort: 'Altdorf' } });
    expect(fehlt.statusCode).toBe(404);

    const ohneRolle = await app.inject({ method: 'PUT', url: `/auftraggeber/${id}`, payload: { ort: 'Altdorf' } });
    expect(ohneRolle.statusCode).toBe(403);
  });
});

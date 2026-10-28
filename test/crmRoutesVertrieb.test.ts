import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { heuteIso } from '../src/domain/crm';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
const ml = { 'x-user': 'ml' };
let base: Awaited<ReturnType<typeof grundbestand>>;
let orgId: string;
beforeAll(async () => {
  await resetDb(pool); base = await grundbestand(pool); await app.ready();
  orgId = (await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'Nidwaldner KB', strasse: 'Stansstaderstrasse 54', plz: '6371', ort: 'Stans' } })).json().id;
});
afterAll(async () => { await app.close(); await closePool(); });

describe('routes: verkaufschance', () => {
  let vcId: string;
  it('POST / GET / PATCH', async () => {
    const r = await app.inject({ method: 'POST', url: '/verkaufschance', payload: { titel: 'Nachwuchsprogramm', organisationId: orgId, wertChf: 24000, erwarteterAbschluss: '2027-01-31', verantwortlichId: base.ml.id } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ phase: 'lead', wahrscheinlichkeit: 10 });
    vcId = r.json().id;
    expect((await app.inject({ method: 'POST', url: '/verkaufschance', payload: { titel: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/verkaufschance', payload: { titel: 'X', organisationId: '00000000-0000-0000-0000-000000000000' } })).statusCode).toBe(400);
    const l = await app.inject({ method: 'GET', url: `/verkaufschance?phase=lead&verantwortlichId=${base.ml.id}&organisationId=${orgId}` });
    expect(l.json()).toEqual([expect.objectContaining({ id: vcId, organisationName: 'Nidwaldner KB' })]);
    expect((await app.inject({ method: 'GET', url: `/verkaufschance/${vcId}` })).json().titel).toBe('Nachwuchsprogramm');
    const p = await app.inject({ method: 'PATCH', url: `/verkaufschance/${vcId}`, payload: { wertChf: 30000 } });
    expect(p.json().wertChf).toBe(30000);
    expect((await app.inject({ method: 'PATCH', url: `/verkaufschance/${vcId}`, payload: { phase: 'gewonnen' } })).statusCode).toBe(400);
  });
  it('POST /:id/phase: Default-Wahrscheinlichkeit, verloren braucht Grund, final (409), Wiedereroeffnung nur Admin', async () => {
    const r = await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, payload: { phase: 'offeriert' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ phase: 'offeriert', wahrscheinlichkeit: 50 });
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, payload: { phase: 'verloren' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, payload: { phase: 'zauberei' } })).statusCode).toBe(400);
    const v = await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, headers: ml, payload: { phase: 'verloren', verlustgrund: 'Konkurrenz' } });
    expect(v.json()).toMatchObject({ phase: 'verloren', wahrscheinlichkeit: 0, abgeschlossenAm: heuteIso(), verlustgrund: 'Konkurrenz' });
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, payload: { phase: 'lead' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, payload: { phase: 'lead', wiedereroeffnen: true } })).statusCode).toBe(403);
    const w = await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/phase`, headers: admin, payload: { phase: 'verhandlung', wiedereroeffnen: true } });
    expect(w.statusCode).toBe(200);
    expect(w.json()).toMatchObject({ phase: 'verhandlung', wahrscheinlichkeit: 75, abgeschlossenAm: null });
    const audit = await pool.query(`select benutzer, aktion from audit_log where entitaet='verkaufschance' and entitaet_id=$1 order by id`, [vcId]);
    expect(audit.rows).toEqual([{ benutzer: 'ml', aktion: 'verkaufschance.verloren' }, { benutzer: 'ml', aktion: 'verkaufschance.wiedereroeffnet' }]);
  });
  it('POST /:id/projekt: 400 ohne Auftraggeber, 201 mit; danach 409', async () => {
    const ohne = await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/projekt`, payload: { stammnummer: 9100, jahr: 2027 } });
    expect(ohne.statusCode).toBe(400);
    expect(ohne.json().error).toMatch(/Auftraggeber/);
    await app.inject({ method: 'POST', url: `/organisation/${orgId}/auftraggeber`, payload: { nummer: '70001' } });
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/projekt`, payload: { jahr: 2027 } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/projekt`, headers: ml, payload: { stammnummer: 9100, jahr: 2027, name: 'NKB Nachwuchs 2027' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().projekt).toMatchObject({ nummer: '9100.27', name: 'NKB Nachwuchs 2027' });
    expect(r.json().verkaufschance).toMatchObject({ phase: 'gewonnen', wahrscheinlichkeit: 100, projektId: r.json().projekt.id });
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${vcId}/projekt`, payload: { stammnummer: 9101, jahr: 2027 } })).statusCode).toBe(409);
    const dup = (await app.inject({ method: 'POST', url: '/verkaufschance', payload: { titel: 'Dublette', organisationId: orgId } })).json();
    expect((await app.inject({ method: 'POST', url: `/verkaufschance/${dup.id}/projekt`, payload: { stammnummer: 9100, jahr: 2027 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/organisation/${orgId}` })).json().projekte.map((p: any) => p.nummer)).toEqual(['9100.27']);
  });
  it('GET /verkaufschance/pipeline', async () => {
    await app.inject({ method: 'POST', url: '/verkaufschance', payload: { titel: 'Forecast', organisationId: orgId, phase: 'verhandlung', wertChf: 10000, erwarteterAbschluss: '2026-12-10' } });
    const r = await app.inject({ method: 'GET', url: '/verkaufschance/pipeline' });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.phasen.map((x: any) => x.phase)).toEqual(['lead', 'qualifiziert', 'offeriert', 'verhandlung', 'gewonnen', 'verloren']);
    expect(p.phasen.find((x: any) => x.phase === 'gewonnen')).toEqual({ phase: 'gewonnen', anzahl: 1, summeChf: 30000, gewichtetChf: 30000 });
    expect(p.offen).toEqual({ anzahl: 2, summeChf: 10000, gewichtetChf: 7500 });
    expect(p.forecast).toEqual([{ monat: '2026-12', anzahl: 1, summeChf: 10000, gewichtetChf: 7500 }]);
    expect(p.ohneTermin).toEqual({ anzahl: 1, summeChf: 0, gewichtetChf: 0 });
  });
});

describe('routes: anfrage', () => {
  it('POST 201/400, GET ?status, uebernehmen (x-user als Bearbeiter), 409 danach, verwerfen', async () => {
    const r = await app.inject({ method: 'POST', url: '/anfrage', payload: { quelle: 'telefon', typ: 'tailormade', vorname: 'Ivo', nachname: 'Odermatt', email: 'ivo@nkb.test', organisationName: 'Nidwaldner KB', newsletter: true, einwilligung: true } });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect((await app.inject({ method: 'POST', url: '/anfrage', payload: { nachname: 'Ohne Kanal' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/anfrage', payload: { email: 'x@y.test', newsletter: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/anfrage?status=neu' })).json().map((a: any) => a.id)).toEqual([id]);
    expect((await app.inject({ method: 'GET', url: `/anfrage/${id}` })).json().email).toBe('ivo@nkb.test');

    const u = await app.inject({ method: 'POST', url: `/anfrage/${id}/uebernehmen`, headers: ml, payload: { organisationId: orgId, verkaufschance: { titel: 'Tailor-made Kreditprozess', wertChf: 15000 } } });
    expect(u.statusCode).toBe(200);
    const e = u.json();
    expect(e.kontaktNeu).toBe(true);
    expect(e.anfrage).toMatchObject({ status: 'uebernommen', bearbeitetDurchId: base.ml.id, kontaktId: e.kontakt.id, verkaufschanceId: e.verkaufschance.id });
    expect(e.kontakt).toMatchObject({ organisationId: orgId, newsletter: true, einwilligungQuelle: `anfrage:${id}` });
    expect(e.verkaufschance).toMatchObject({ verantwortlichId: base.ml.id, organisationId: orgId, kontaktId: e.kontakt.id });
    expect((await app.inject({ method: 'POST', url: `/anfrage/${id}/uebernehmen`, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/anfrage/${id}/verwerfen` })).statusCode).toBe(409);

    const s = (await app.inject({ method: 'POST', url: '/anfrage', payload: { email: 'spam@x.test' } })).json();
    const v = await app.inject({ method: 'POST', url: `/anfrage/${s.id}/verwerfen`, headers: ml, payload: { grund: 'Spam' } });
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({ status: 'verworfen', bearbeitetDurchId: base.ml.id });
    expect((await app.inject({ method: 'POST', url: `/anfrage/00000000-0000-0000-0000-000000000000/verwerfen` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/anfrage?status=uebernommen,verworfen' })).json()).toHaveLength(2);
  });
  it('uebernehmen ohne Organisation fuer Verkaufschance -> 400, nichts angelegt', async () => {
    const a = (await app.inject({ method: 'POST', url: '/anfrage', payload: { nachname: 'Leer', email: 'leer@x.test' } })).json();
    const r = await app.inject({ method: 'POST', url: `/anfrage/${a.id}/uebernehmen`, payload: { verkaufschance: { titel: 'X' } } });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/kontakt?suche=leer@x.test' })).json()).toEqual([]);
  });
});

describe('routes: crm', () => {
  it('GET /crm/wiedervorlagen und /crm/dashboard', async () => {
    const k = (await app.inject({ method: 'GET', url: '/kontakt?suche=odermatt' })).json()[0];
    await pool.query(`insert into aufgabe(titel,kontakt_id,faellig_am,zustaendig_id) values ('Nachfassen',$1,'2026-10-29',$2)`, [k.id, base.ml.id]);
    await pool.query(`insert into aufgabe(titel,organisation_id) values ('Irgendwann',$1)`, [orgId]);
    const w = await app.inject({ method: 'GET', url: `/crm/wiedervorlagen?stichtag=2026-10-28&mitarbeitendeId=${base.ml.id}` });
    expect(w.statusCode).toBe(200);
    expect(w.json()).toMatchObject({ ueberfaellig: [], dieseWoche: [expect.objectContaining({ titel: 'Nachfassen', kontaktName: 'Ivo Odermatt' })], spaeter: [], ohneTermin: [] });
    expect((await app.inject({ method: 'GET', url: '/crm/wiedervorlagen?stichtag=2026-10-28' })).json().ohneTermin).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/crm/wiedervorlagen?stichtag=28.10.2026' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/crm/wiedervorlagen' })).statusCode).toBe(200);

    const d = await app.inject({ method: 'GET', url: '/crm/dashboard?stichtag=2026-10-28' });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({
      stichtag: '2026-10-28', neueAnfragen: { anzahl: 1 }, wiedervorlagen: { dieseWoche: 1, ohneTermin: 1 },
      pipeline: { anzahl: 3, summeChf: 25000, gewichtetChf: 9000 },
    });
    expect(d.json().pflegeabdeckung).toHaveLength(5);
    expect((await app.inject({ method: 'GET', url: '/crm/dashboard' })).json().stichtag).toBe(heuteIso());
  });
});

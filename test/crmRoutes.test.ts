import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };
const ml = { 'x-user': 'ml' };
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

const UNBEKANNT = '00000000-0000-0000-0000-000000000000';

describe('routes: organisation', () => {
  let orgId: string;
  it('POST 201 / 400; GET-Liste mit Kennzahlen und Filtern; PATCH', async () => {
    const r = await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'Appenzeller KB', klassifizierung: 'B', strasse: 'Bankgasse 2', plz: '9050', ort: 'Appenzell' } });
    expect(r.statusCode).toBe(201);
    orgId = r.json().id;
    expect((await app.inject({ method: 'POST', url: '/organisation', payload: { ort: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/organisation' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'X', kategorie: 'boese' } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Koch', organisationId: orgId } });

    const l = await app.inject({ method: 'GET', url: '/organisation?suche=appenz&klassifizierung=B' });
    expect(l.statusCode).toBe(200);
    expect(l.json()).toEqual([expect.objectContaining({ id: orgId, kontakteAnzahl: 1, letzteAktivitaet: null })]);
    expect((await app.inject({ method: 'GET', url: '/organisation?inklArchiviert=vielleicht' })).statusCode).toBe(400);

    const p = await app.inject({ method: 'PATCH', url: `/organisation/${orgId}`, payload: { vip: true } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ vip: true, name: 'Appenzeller KB' });
    expect((await app.inject({ method: 'PATCH', url: `/organisation/${UNBEKANNT}`, payload: { vip: true } })).statusCode).toBe(404);
  });
  it('GET /organisation/:id liefert die 360-Grad-Sicht; 404 auch fuer ungueltige IDs', async () => {
    const r = await app.inject({ method: 'GET', url: `/organisation/${orgId}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: orgId, kontakte: [expect.objectContaining({ nachname: 'Koch' })], aktivitaeten: [], offeneAufgaben: [], verkaufschancen: [], projekte: [], auftraggeber: null, umsatzProJahr: [] });
    expect((await app.inject({ method: 'GET', url: `/organisation/${UNBEKANNT}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/organisation/kein-uuid' })).statusCode).toBe(404);
  });
  it('POST /organisation/:id/auftraggeber: 201, 409 bei Doppelverknuepfung, 400 ohne Adresse', async () => {
    const r = await app.inject({ method: 'POST', url: `/organisation/${orgId}/auftraggeber`, payload: { nummer: '60001' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ nummer: '60001', name: 'Appenzeller KB', plz: '9050' });
    expect((await app.inject({ method: 'POST', url: `/organisation/${orgId}/auftraggeber` })).statusCode).toBe(409);
    const ohne = (await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'Ohne Adresse' } })).json();
    const f = await app.inject({ method: 'POST', url: `/organisation/${ohne.id}/auftraggeber` });
    expect(f.statusCode).toBe(400);
    expect(f.json().error).toMatch(/strasse, plz, ort/);
    expect((await app.inject({ method: 'GET', url: `/organisation/${orgId}` })).json().auftraggeber.nummer).toBe('60001');
  });
});

describe('routes: kontakt', () => {
  let kontaktId: string;
  it('POST 201 / 400 / 409 (E-Mail-Dublette); PATCH; Listenfilter', async () => {
    const r = await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Meier', vorname: 'Lara', email: 'lara.meier@bank.test', interessen: ['zertifizierung'], betreuerId: base.ml.id } });
    expect(r.statusCode).toBe(201);
    kontaktId = r.json().id;
    expect((await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Andere', email: 'LARA.MEIER@bank.test' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/kontakt', payload: { vorname: 'Ohne' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 7 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'X', interessen: ['golf'] } })).statusCode).toBe(400);
    const p = await app.inject({ method: 'PATCH', url: `/kontakt/${kontaktId}`, payload: { newsletter: true, einwilligungQuelle: 'telefonisch' } });
    expect(p.statusCode).toBe(200);
    expect(p.json().einwilligungAm).not.toBeNull();
    expect((await app.inject({ method: 'PATCH', url: `/kontakt/${UNBEKANNT}`, payload: { vorname: 'X' } })).statusCode).toBe(404);

    const ids = async (qs: string) => (await app.inject({ method: 'GET', url: `/kontakt?${qs}` })).json().map((k: any) => k.nachname);
    expect(await ids('interesse=zertifizierung')).toEqual(['Meier']);
    expect(await ids(`betreuerId=${base.ml.id}`)).toEqual(['Meier']);
    expect(await ids('newsletter=true')).toEqual(['Meier']);
    expect(await ids('suche=koch')).toEqual(['Koch']);
    expect((await app.inject({ method: 'GET', url: '/kontakt?interesse=golf' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/kontakt?organisationId=kaputt' })).statusCode).toBe(400);
  });
  it('GET /kontakt/:id liefert die 360-Grad-Sicht', async () => {
    const r = await app.inject({ method: 'GET', url: `/kontakt/${kontaktId}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: kontaktId, organisation: null, aktivitaeten: [], aufgaben: [], anmeldungen: [], lernnachweise: [], zertifizierungen: [], verkaufschancen: [] });
    expect((await app.inject({ method: 'GET', url: `/kontakt/${UNBEKANNT}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/kontakt/export' })).statusCode).toBe(404);
  });
  it('GET /kontakt/export/newsletter liefert CSV (nur mit Einwilligung) und protokolliert den Export', async () => {
    await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Ohne Opt-in', email: 'kein@nl.test' } });
    const org = (await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'Bank "Nord"; AG' } })).json();
    await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Züst', vorname: 'Ueli', anrede: 'Herr', email: 'ueli@nord.test', organisationId: org.id, newsletter: true } });
    const r = await app.inject({ method: 'GET', url: '/kontakt/export/newsletter', headers: ml });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="newsletter-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.body).toBe('﻿email;anrede;vorname;nachname;organisation\r\n'
      + 'lara.meier@bank.test;;Lara;Meier;\r\n'
      + 'ueli@nord.test;Herr;Ueli;Züst;"Bank ""Nord""; AG"\r\n');
    const audit = await pool.query(`select benutzer, details from audit_log where aktion='kontakt.newsletter_export'`);
    expect(audit.rows).toEqual([{ benutzer: 'ml', details: { anzahl: 2 } }]);
  });
});

describe('routes: aktivitaet', () => {
  it('POST leitet Organisation ab und setzt Record-Lead aus x-user; GET filtert; DELETE nur Admin', async () => {
    const org = (await app.inject({ method: 'POST', url: '/organisation', payload: { name: 'Aktivitaetsbank' } })).json();
    const k = (await app.inject({ method: 'POST', url: '/kontakt', payload: { nachname: 'Aktiv', organisationId: org.id } })).json();
    const r = await app.inject({ method: 'POST', url: '/aktivitaet', headers: ml, payload: { typ: 'besuch', betreff: 'Jahresgespraech', kontaktId: k.id, datum: '2026-10-15T09:00:00Z' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ organisationId: org.id, mitarbeitendeId: base.ml.id });
    const ohneUser = await app.inject({ method: 'POST', url: '/aktivitaet', payload: { typ: 'notiz', betreff: 'Notiz', organisationId: org.id, datum: '2026-10-16T09:00:00Z' } });
    expect(ohneUser.json().mitarbeitendeId).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/aktivitaet', payload: { typ: 'notiz', betreff: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/aktivitaet', payload: { typ: 'notiz', betreff: 'X', kontaktId: UNBEKANNT } })).statusCode).toBe(404);

    const l = await app.inject({ method: 'GET', url: `/aktivitaet?organisationId=${org.id}&von=2026-10-16&bis=2026-10-16` });
    expect(l.json().map((a: any) => a.betreff)).toEqual(['Notiz']);
    expect((await app.inject({ method: 'GET', url: `/aktivitaet?mitarbeitendeId=${base.ml.id}` })).json().map((a: any) => a.betreff)).toEqual(['Jahresgespraech']);
    expect((await app.inject({ method: 'GET', url: '/aktivitaet?von=gestern' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/organisation?suche=aktivitaetsbank` })).json()[0].letzteAktivitaet).toBe('2026-10-16T09:00:00.000Z');

    const id = r.json().id;
    expect((await app.inject({ method: 'DELETE', url: `/aktivitaet/${id}` })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/aktivitaet/${id}`, headers: admin })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/aktivitaet/${id}`, headers: admin })).statusCode).toBe(404);
  });
});

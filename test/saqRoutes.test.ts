import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createReferent } from '../src/repos/referentRepo';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
let bankId: string; let experteId: string; let terminId: string;

beforeAll(async () => {
  await resetDb(pool);
  const base = await grundbestand(pool);
  bankId = (await pool.query(`insert into organisation(name) values ('Beispielbank Genossenschaft') returning id`)).rows[0].id;
  experteId = (await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id })).id;
  const ka = await pool.query(`insert into kursangebot(code,titel,bereich) values ('SAQ-WE','SAQ schriftlich','Zertifizierung') returning id`);
  terminId = (await pool.query(
    `insert into durchfuehrung(kursangebot_id,start_datum,end_datum,ort,kapazitaet) values ($1,'2026-03-12','2026-03-12','St. Gallen',1) returning id`,
    [ka.rows[0].id])).rows[0].id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: payload as any, headers });

describe('saq-routes', () => {
  it('Anmeldung -> Runs -> Resultate -> Zertifikat -> Kennzahlen', async () => {
    const anmeldung = await post('/saq/fall', {
      kontakt: { email: 'lea.beispiel@beispielbank.test', anrede: 'Frau', vorname: 'Lea', nachname: 'Beispiel', geburtsdatum: '1993-07-14', funktion: 'Kundenberaterin' },
      organisationId: bankId, profil: 'PK', sprache: 'DE', einwilligungRechnungBank: true,
    });
    expect(anmeldung.statusCode).toBe(201);
    const fallId = anmeldung.json().id;

    const we = await post(`/saq/fall/${fallId}/pruefung`, { art: 'schriftlich', teil: 1, durchfuehrungId: terminId });
    expect(we.statusCode).toBe(201);
    expect(we.json()).toMatchObject({ run: 1, datum: '2026-03-12', ort: 'St. Gallen' });

    const res = await post(`/saq/pruefung/${we.json().id}/resultat`, { resultatProzent: 70 });
    expect(res.statusCode).toBe(200);
    expect(res.json().fall.status).toBe('schriftlich_bestanden');
    expect((await post(`/saq/pruefung/${we.json().id}/resultat`, { resultatProzent: 70 })).statusCode).toBe(409);

    // muendlich ohne Arbeitgeberbestaetigung -> 409
    expect((await post(`/saq/fall/${fallId}/pruefung`, { art: 'muendlich', teil: 1, datum: '2026-05-20' })).statusCode).toBe(409);
    const ag = await post(`/saq/fall/${fallId}/arbeitgeberbestaetigung`, { datum: '2026-04-02' });
    expect(ag.json().arbeitgeberbestaetigungAm).toBe('2026-04-02');
    const oe = await post(`/saq/fall/${fallId}/pruefung`, { art: 'muendlich', teil: 1, datum: '2026-05-20', experte1Id: experteId });
    expect(oe.statusCode).toBe(201);
    const oeRes = await post(`/saq/pruefung/${oe.json().id}/resultat`, { resultatProzent: 66, bestanden: true });
    expect(oeRes.json().warnungen).toHaveLength(1);
    expect(oeRes.json().fall.status).toBe('bestanden');

    const z = await post(`/saq/fall/${fallId}/zertifikat`, { zertifikatNr: 'SAQ-R-1', ausgestelltAm: '2026-06-15' }, admin);
    expect(z.statusCode).toBe(201);
    expect(z.json().zertifizierung).toMatchObject({ profil: 'PK', gueltigBis: '2029-06-15' });

    const detail = (await app.inject({ method: 'GET', url: `/saq/fall/${fallId}` })).json();
    expect(detail.status).toBe('zertifiziert');
    expect(detail.pruefungen).toHaveLength(2);
    expect(detail.kontakt.nachname).toBe('Beispiel');

    const k = (await app.inject({ method: 'GET', url: '/saq/kennzahlen?jahr=2026' })).json();
    expect(k.jeProfil.find((x: any) => x.profil === 'PK').quoteInsgesamt).toEqual({ quote: 100, zaehler: 1, n: 1 });
  });

  it('Kapazitaet des Pruefungstermins: 409, wenn voll', async () => {
    const f = await post('/saq/fall', { kontakt: { email: 'max.voll@beispielbank.test', nachname: 'Voll' }, profil: 'IK' });
    const r = await post(`/saq/fall/${f.json().id}/pruefung`, { art: 'schriftlich', teil: 1, durchfuehrungId: terminId });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/ausgebucht/);
  });

  it('Liste, PATCH und Fehlerfaelle (400/404/409)', async () => {
    const liste = (await app.inject({ method: 'GET', url: `/saq/fall?organisationId=${bankId}&suche=lea` })).json();
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ profil: 'PK', organisationName: 'Beispielbank Genossenschaft', passiv: false });
    expect((await app.inject({ method: 'GET', url: '/saq/fall?profil=XYZ' })).statusCode).toBe(400);
    expect((await post('/saq/fall', { kontakt: { email: 'a@b.test', nachname: 'A' }, profil: 'PK', sprache: 'ES' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/saq/fall/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/saq/fall/kein-uuid' })).statusCode).toBe(400);

    const f = (await post('/saq/fall', { kontakt: { email: 'patch@beispielbank.test', nachname: 'Patch' }, profil: 'KMU' })).json();
    const p = await app.inject({ method: 'PATCH', url: `/saq/fall/${f.id}`, payload: { kennzeichnung: 'VSM', status: 'abgebrochen' } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ kennzeichnung: 'VSM', status: 'abgebrochen' });
    expect((await app.inject({ method: 'PATCH', url: `/saq/fall/${f.id}`, payload: { status: 'angemeldet' } })).statusCode).toBe(409);
    expect((await post(`/saq/fall/${f.id}/pruefung`, { art: 'schriftlich', teil: 1, datum: '2026-02-01' })).statusCode).toBe(409);
  });

  it('PATCH /saq/pruefung/:id bucht einen geplanten Run um', async () => {
    const f = (await post('/saq/fall', { kontakt: { email: 'umbuchung@beispielbank.test', nachname: 'Umbuchung' }, profil: 'PK', umfang: 'schriftlich' })).json();
    const p = (await post(`/saq/fall/${f.id}/pruefung`, { art: 'schriftlich', teil: 1, datum: '2026-02-01' })).json();
    const u = await app.inject({ method: 'PATCH', url: `/saq/pruefung/${p.id}`, payload: { datum: '2026-02-15', ort: 'Lausanne', remote: true } });
    expect(u.statusCode).toBe(200);
    expect(u.json()).toMatchObject({ datum: '2026-02-15', ort: 'Lausanne', remote: true });
    expect((await post(`/saq/fall/${f.id}/pruefung`, { art: 'muendlich', teil: 1, datum: '2026-04-01' })).statusCode).toBe(409);
  });

  it('GET /saq/export/kuba nur fuer Admin, Felder im bbz-saq-Format', async () => {
    expect((await app.inject({ method: 'GET', url: '/saq/export/kuba' })).statusCode).toBe(403);
    const r = await app.inject({ method: 'GET', url: '/saq/export/kuba', headers: admin });
    expect(r.statusCode).toBe(200);
    const lea = r.json().find((z: any) => z.lastName === 'Beispiel');
    expect(lea).toMatchObject({
      firstName: 'Lea', employer: 'Beispielbank Genossenschaft', profil: 'PK', sprache: 'DE', birthDate: '1993-07-14',
      certNumber: 'SAQ-R-1', certStart: '2026-06-15', certEnd: '2029-06-15', weAllPassed: 'yes', oeAllPassed: 'yes',
      'we1.passed': 'yes', 'we1.run1.date': '2026-03-12', 'we1.run1.result': 0.7, 'we1.run1.passed': 'yes', 'we1.run1.location': 'St. Gallen',
      'oe1.run1.passed': 'yes', 'oe1.run1.result': 0.66, 'oe1.run1.expert1': 'Markus Muster', 'oe1.run1.expert2': '', 'we2.run1.passed': '',
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { bildungsbestand } from './bildungFixtures';
import { createReferent } from '../src/repos/referentRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { listAudit } from '../src/repos/auditRepo';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
const std = { 'x-user': 'ph' };
let base: Awaited<ReturnType<typeof bildungsbestand>>;
beforeAll(async () => { await resetDb(pool); base = await bildungsbestand(pool); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

const post = (url: string, payload: unknown, headers: Record<string, string> = std) => app.inject({ method: 'POST', url, payload: payload as any, headers });
const get = (url: string, headers: Record<string, string> = std) => app.inject({ method: 'GET', url, headers });
const patch = (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, payload: payload as any, headers: std });

describe('bildung-routes', () => {
  let angebotId: string; let dId: string; let anmeldungId: string;

  it('Kursangebot: anlegen, listen, lesen, aendern, 409/400', async () => {
    const c = await post('/kursangebot', { code: 'BEF', titel: 'Eigenheimfinanzierung für Profis', bereich: 'Banking', preisChf: 1200, lernstunden: 8, oeffentlich: true, ertragskontoId: base.konto.id });
    expect(c.statusCode).toBe(201);
    angebotId = c.json().id;
    expect(c.json().slug).toBe('eigenheimfinanzierung-fuer-profis');
    expect((await post('/kursangebot', { code: 'BEF', titel: 'X', bereich: 'B' })).statusCode).toBe(409);
    expect((await post('/kursangebot', { code: 'X', bereich: 'B' })).statusCode).toBe(400);
    await post('/kursangebot', { code: 'INT', titel: 'Intern', bereich: 'Leadership' });
    expect((await get('/kursangebot?oeffentlich=true')).json().map((k: any) => k.code)).toEqual(['BEF']);
    expect((await get('/kursangebot?bereich=Leadership&aktiv=true')).json().map((k: any) => k.code)).toEqual(['INT']);
    expect((await get(`/kursangebot/${angebotId}`)).json().code).toBe('BEF');
    expect((await get('/kursangebot/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    expect((await patch(`/kursangebot/${angebotId}`, { untertitel: 'Kompakt' })).json().untertitel).toBe('Kompakt');
  });

  it('Durchfuehrung: anlegen, Liste, Detail mit Belegung, PATCH, Status', async () => {
    const c = await post('/durchfuehrung', { kursangebotId: angebotId, startDatum: '2026-12-01', endDatum: '2026-12-02', kapazitaet: 2, projektId: base.projekt.id });
    expect(c.statusCode).toBe(201);
    dId = c.json().id;
    expect(c.json()).toMatchObject({ code: 'BEF-2026-1', kurstage: [{ datum: '2026-12-01' }, { datum: '2026-12-02' }] });
    expect((await post('/durchfuehrung', { kursangebotId: angebotId, startDatum: '2026-12-02', endDatum: '2026-12-01' })).statusCode).toBe(400);
    expect((await get(`/durchfuehrung?kursangebotId=${angebotId}&status=geplant`)).json()).toHaveLength(1);
    expect((await patch(`/durchfuehrung/${dId}`, { ort: 'St. Gallen' })).json().ort).toBe('St. Gallen');
    const s = await post(`/durchfuehrung/${dId}/status`, { status: 'ausgeschrieben' }, { 'x-user': 'ph' });
    expect(s.statusCode).toBe(200);
    expect(s.json().status).toBe('ausgeschrieben');
    expect((await listAudit(pool, 'durchfuehrung', dId))[0].benutzer).toBe('ph');
    expect((await post(`/durchfuehrung/${dId}/status`, { status: 'durchgefuehrt' })).statusCode).toBe(409);
    expect((await post(`/durchfuehrung/${dId}/status`, { status: 'quatsch' })).statusCode).toBe(400);
    const d = (await get(`/durchfuehrung/${dId}`)).json();
    expect(d.belegung).toEqual({ kapazitaet: 2, aktiv: 0, warteliste: 0, frei: 2 });
    expect((await get('/durchfuehrung/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
  });

  it('Kurstag: hinzufuegen, Referent:in einplanen, loeschen nur Admin', async () => {
    const k = await post(`/durchfuehrung/${dId}/kurstag`, { datum: '2026-12-02', von: '13:00', bis: '17:00' });
    expect(k.statusCode).toBe(201);
    const ref = await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id });
    const e = await post(`/kurstag/${k.json().id}/referent`, { referentId: ref.id, dauerTage: 0.5 });
    expect(e.statusCode).toBe(201);
    expect(e.json()).toMatchObject({ datum: '2026-12-02', kurstagId: k.json().id, dauerTage: 0.5 });
    expect((await post(`/kurstag/${k.json().id}/referent`, { referentId: ref.id, dauerTage: 1 })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/kurstag/${k.json().id}`, headers: std })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/kurstag/${k.json().id}`, headers: admin })).statusCode).toBe(204);
    expect((await get(`/durchfuehrung/${dId}`)).json().einsaetze).toEqual([]);
  });

  it('Anmeldung: anmelden, Warteliste, bestaetigen, stornieren, teilnehmen', async () => {
    const r = await post(`/durchfuehrung/${dId}/anmeldung`, {
      kontakt: { email: 'anna@bank.test', vorname: 'Anna', nachname: 'Amrein; "AA"' }, rechnungsempfaengerId: base.auftraggeber.id, rechnungsreferenz: '=SUMME(A1)',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ warteliste: false, kontaktNeu: true, anmeldung: { status: 'angemeldet', preisChf: 1200 } });
    anmeldungId = r.json().anmeldung.id;
    expect((await post(`/durchfuehrung/${dId}/anmeldung`, { kontakt: { email: 'ANNA@bank.test' } })).statusCode).toBe(409);
    expect((await post(`/durchfuehrung/${dId}/anmeldung`, {})).statusCode).toBe(400);
    const b = await post(`/durchfuehrung/${dId}/anmeldung`, { kontakt: { email: 'bea@bank.test', vorname: 'Bea', nachname: 'Bucher' }, rechnungsempfaengerId: base.auftraggeber.id });
    const w = await post(`/durchfuehrung/${dId}/anmeldung`, { kontakt: { email: 'cem@bank.test', vorname: 'Cem', nachname: 'Wartend' } });
    expect(w.json()).toMatchObject({ warteliste: true, anmeldung: { status: 'warteliste', wartelistenPosition: 1 } });
    expect((await post(`/anmeldung/${w.json().anmeldung.id}/bestaetigen`, {})).statusCode).toBe(409);

    expect((await post(`/anmeldung/${anmeldungId}/bestaetigen`, {})).json().status).toBe('bestaetigt');
    const st = await post(`/anmeldung/${b.json().anmeldung.id}/stornieren`, { grund: 'Krankheit', datum: '2026-11-20' });
    expect(st.statusCode).toBe(200);
    expect(st.json().anmeldung).toMatchObject({ status: 'storniert', stornogebuehrChf: 1200 });
    expect(st.json().nachgerueckt.map((x: any) => x.id)).toEqual([w.json().anmeldung.id]);
    expect((await post(`/anmeldung/${b.json().anmeldung.id}/stornieren`, { grund: 'x' })).statusCode).toBe(409);
    expect((await post(`/anmeldung/${anmeldungId}/teilnahme`, { status: 'abgeschlossen' })).json().status).toBe('abgeschlossen');
    expect((await post(`/anmeldung/${anmeldungId}/teilnahme`, { status: 'storniert' })).statusCode).toBe(400);

    expect((await get(`/anmeldung?durchfuehrungId=${dId}&status=storniert`)).json()).toHaveLength(1);
    expect((await get(`/anmeldung/${anmeldungId}`)).json().status).toBe('abgeschlossen');
    expect((await get('/anmeldung/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    const p = await patch(`/anmeldung/${w.json().anmeldung.id}`, { bemerkung: 'nachgerueckt' });
    expect(p.json().bemerkung).toBe('nachgerueckt');
  });

  it('Teilnehmerliste als JSON und CSV (Semikolon, Quoting, Formelschutz)', async () => {
    const j = await get(`/durchfuehrung/${dId}/teilnehmerliste`);
    expect(j.json().map((t: any) => t.vorname)).toEqual(['Anna', 'Cem']);
    const c = await get(`/durchfuehrung/${dId}/teilnehmerliste?format=csv`);
    expect(c.statusCode).toBe(200);
    expect(c.headers['content-type']).toContain('text/csv');
    expect(c.headers['content-disposition']).toContain('teilnehmerliste-BEF-2026-1.csv');
    const zeilen = c.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(zeilen[0]).toBe('Status;Warteliste;Anrede;Vorname;Nachname;Organisation;Strasse;PLZ;Ort;Funktion;E-Mail;Telefon;Rechnungsempfaenger;Referenz;Bemerkung');
    expect(zeilen).toHaveLength(3);
    expect(zeilen[1]).toContain('abgeschlossen;;;Anna;"Amrein; ""AA""";');
    expect(zeilen[1]).toContain(";'=SUMME(A1);");
  });

  it('Verrechnen nur Admin, 400 mit Anmeldungen ohne Empfaenger', async () => {
    expect((await post(`/durchfuehrung/${dId}/verrechnen`, { datum: '2026-12-05' })).statusCode).toBe(403);
    const fehlt = await post(`/durchfuehrung/${dId}/verrechnen`, { datum: '2026-12-05' }, admin);
    expect(fehlt.statusCode).toBe(400);
    const wartendId = (await get(`/anmeldung?durchfuehrungId=${dId}&status=angemeldet`)).json()[0].id;
    expect(fehlt.json().anmeldungIds).toEqual([wartendId]);
    await patch(`/anmeldung/${wartendId}`, { rechnungsempfaengerId: base.auftraggeber.id });
    const ok = await post(`/durchfuehrung/${dId}/verrechnen`, { datum: '2026-12-05' }, admin);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().rechnungen).toHaveLength(1);
    expect(ok.json().rechnungen[0].positionen).toHaveLength(3);    // 2 Teilnehmende + Annullationskosten
    const nochmal = await post(`/durchfuehrung/${dId}/verrechnen`, { datum: '2026-12-05' }, admin);
    expect(nochmal.statusCode).toBe(200);
    expect(nochmal.json().rechnungen).toEqual([]);
  });

  it('Lernnachweise, Zertifizierung, Rezertifizierung, Faelligkeit', async () => {
    const annaId = (await get(`/anmeldung/${anmeldungId}`)).json().kontaktId;
    expect((await get(`/kontakt/${annaId}/lernnachweise`)).json().map((n: any) => n.quelle)).toEqual(['kurs']);   // aus Abschluss
    expect((await get('/kontakt/00000000-0000-0000-0000-000000000000/lernnachweise')).statusCode).toBe(404);

    const kontaktId = (await createKontakt(pool, { nachname: 'Zertifiziert', email: 'z@bank.test' })).id;
    expect((await get(`/kontakt/${kontaktId}/lernnachweise`)).json()).toEqual([]);
    const ext = await post('/lernnachweis', { kontaktId, datum: '2025-05-01', titel: 'Fachtagung', lernstunden: 4 });
    expect(ext.statusCode).toBe(201);
    expect(ext.json().quelle).toBe('extern');
    await post('/lernnachweis', { kontaktId, datum: '2026-01-15', titel: 'Webinar', lernstunden: 6 });
    expect((await post('/lernnachweis', { kontaktId, datum: '2026-01-15', titel: 'Webinar', lernstunden: -1 })).statusCode).toBe(400);
    expect((await get(`/kontakt/${kontaktId}/lernnachweise?von=2026-01-01`)).json().map((n: any) => n.titel)).toEqual(['Webinar']);

    const z = await post('/zertifizierung', { kontaktId, typ: 'SAQ Kundenberater Bank', ausgestelltAm: '2024-02-01' });
    expect(z.statusCode).toBe(201);
    expect(z.json().gueltigBis).toBe('2027-02-01');
    expect((await post('/zertifizierung', { kontaktId, typ: 'SAQ Kundenberater Bank', ausgestelltAm: '2024-02-01' })).statusCode).toBe(409);
    expect((await get(`/zertifizierung?kontaktId=${kontaktId}`)).json()).toHaveLength(1);
    expect((await get(`/zertifizierung/${z.json().id}`)).json().typ).toBe('SAQ Kundenberater Bank');
    const rz = await get(`/zertifizierung/${z.json().id}/rezertifizierung?heute=2026-10-28`);
    expect(rz.json()).toMatchObject({ lernstundenIst: 10, fehlend: 14, erfuellt: false, tageBisAblauf: 96 });
    const f = await get('/bildung/rezertifizierung/faellig?innertMonaten=6&heute=2026-10-28');
    expect(f.statusCode).toBe(200);
    expect(f.json().map((x: any) => x.zertifizierung.id)).toEqual([z.json().id]);
    expect((await get('/bildung/rezertifizierung/faellig?innertMonaten=2&heute=2026-10-28')).json()).toEqual([]);
    expect((await get('/bildung/rezertifizierung/faellig?innertMonaten=abc')).statusCode).toBe(400);
  });
});

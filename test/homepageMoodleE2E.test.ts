import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { FakeMoodle } from './helpers/fakeMoodle';
import { buildApp } from '../src/server/app';
import { MoodleClient } from '../src/integrations/moodle/client';
import { ProtokollMailAdapter } from '../src/integrations/mail';
import { signiere } from '../src/integrations/webhooks';
import { createKursangebot } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { createOrganisation } from '../src/repos/organisationRepo';

/*
 * Durchstich Homepage -> ERP -> Moodle -> ERP (Spec v2 §6) mit Fake-Moodle und Protokoll-Mail.
 */
const pool = getPool();
const fake = new FakeMoodle();
const mail = new ProtokollMailAdapter();
const hooks: { url: string; ereignis: string }[] = [];
const fetchHook = (async (url: string, init: RequestInit) => { hooks.push({ url, ereignis: (init.headers as any)['x-bbz-ereignis'] }); return new Response('ok'); }) as unknown as typeof fetch;
const app = buildApp(pool, { integration: { moodle: new MoodleClient({ url: 'https://mybbz.test', token: fake.token, fetch: fake.fetch }), mail, fetch: fetchHook, pruefeWebhookZiel: async () => {} } });
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
const ORIGIN = 'https://www.bankenberatungszentrum.ch';
let key: string; let durchfuehrungId: string; let code: string; let anmeldung1: string;

const pub = (method: 'GET' | 'POST', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app.inject({ method, url, payload: payload as any, headers: { 'x-api-key': key, origin: ORIGIN, ...extra } });
const verarbeite = async () => { for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: '/admin/outbox/verarbeiten', headers: admin }); };

beforeAll(async () => {
  await resetDb(pool);
  const base = await grundbestand(pool);
  await app.ready();
  const org = await createOrganisation(pool, { name: 'Schwyzer Kantonalbank (SZKB)', strasse: 'Bahnhofstrasse 3', plz: '6430', ort: 'Schwyz' });
  await app.inject({ method: 'POST', url: `/organisation/${org.id}/auftraggeber`, headers: admin, payload: {} });
  key = (await app.inject({ method: 'POST', url: '/admin/api-clients', headers: admin,
    payload: { name: 'Homepage', scopes: ['public:read', 'public:anmeldung', 'public:anfrage', 'public:formular'], erlaubteOrigins: [ORIGIN] } })).json().schluessel;
  await app.inject({ method: 'POST', url: '/admin/webhooks', headers: admin, payload: { name: 'WordPress', url: 'https://www.example.test/hook', ereignisse: ['*'] } });
  const ka = await createKursangebot(pool, { code: 'BEF', titel: 'Eigenheimfinanzierung', bereich: 'Banking', format: 'blended', lernstunden: 36, preisChf: 2900, oeffentlich: true });
  const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-03-01', endDatum: '2027-03-03', ort: 'Zürich', kapazitaet: 1, moodleKursId: 42 });
  await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
  durchfuehrungId = d.id; code = d.code!;
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Homepage -> ERP -> Moodle', () => {
  it('Katalog nur mit gueltigem Schluessel und erlaubter Origin; CORS-Preflight', async () => {
    const r = await pub('GET', '/public/v1/kurse');
    expect(r.statusCode).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
    const kurs = r.json().find((k: any) => k.code === 'BEF');
    expect(kurs.durchfuehrungen[0]).toMatchObject({ code, freiePlaetze: 1, ort: 'Zürich' });
    expect(JSON.stringify(r.json())).not.toMatch(/@/);                                   // keine Personendaten
    expect((await app.inject({ method: 'GET', url: '/public/v1/kurse' })).statusCode).toBe(401);
    expect((await pub('GET', '/public/v1/kurse', undefined, { origin: 'https://boese.example' })).statusCode).toBe(403);
    const pre = await app.inject({ method: 'OPTIONS', url: '/public/v1/anmeldungen', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toContain('idempotency-key');
  });

  it('Anmeldung ist idempotent; zweite Person kommt auf die Warteliste', async () => {
    const body = { durchfuehrungCode: code, kontakt: { anrede: 'Frau', vorname: 'Erika', nachname: 'Muster', email: 'erika@szkb.test' }, organisation: 'SZKB', datenschutz: true, agb: true };
    const a = await pub('POST', '/public/v1/anmeldungen', body, { 'idempotency-key': 'wp-1' });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ status: 'angemeldet', warteliste: false });
    const b = await pub('POST', '/public/v1/anmeldungen', body, { 'idempotency-key': 'wp-1' });
    expect(b.json()).toEqual(a.json());
    expect(b.headers['idempotent-replayed']).toBe('true');
    anmeldung1 = a.json().referenz;
    const k = await pool.query('select k.organisation_id from anmeldung a join kontakt k on k.id=a.kontakt_id where a.id=$1', [anmeldung1]);
    expect(k.rows[0].organisation_id).not.toBeNull();                                   // "SZKB" -> Alias aus bbz-saq
    const w = await pub('POST', '/public/v1/anmeldungen', { ...body, kontakt: { ...body.kontakt, email: 'max@szkb.test', vorname: 'Max' } }, { 'idempotency-key': 'wp-2' });
    expect(w.json()).toMatchObject({ status: 'warteliste', warteliste: true, wartelistenPosition: 1 });
    expect((await pub('POST', '/public/v1/anmeldungen', { ...body, agb: false })).statusCode).toBe(400);
  });

  it('Bestaetigung -> Outbox -> Moodle-Einschreibung, Bestaetigungs-Mail und Webhooks', async () => {
    expect((await app.inject({ method: 'POST', url: `/anmeldung/${anmeldung1}/bestaetigen`, headers: admin })).statusCode).toBe(200);
    await verarbeite();
    expect(fake.enrolments).toEqual([expect.objectContaining({ courseid: 42, roleid: 5 })]);
    expect(fake.users[0].email).toBe('erika@szkb.test');
    expect(mail.gesendet.map((m) => m.betreff)).toEqual([expect.stringContaining('Anmeldebestätigung: Eigenheimfinanzierung')]);
    expect(hooks.map((h) => h.ereignis)).toEqual(expect.arrayContaining(['anmeldung.eingegangen', 'anmeldung.bestaetigt']));
    const a = (await app.inject({ method: 'GET', url: `/anmeldung/${anmeldung1}`, headers: admin })).json();
    expect(a.moodleStatus).toBe('eingeschrieben');
  });

  it('Kursabschluss aus Moodle -> abgeschlossen + Lernnachweis (Pull)', async () => {
    fake.completed.set(`42:${fake.users[0].id}`, 1_804_000_000);
    const s = await app.inject({ method: 'POST', url: '/integration/moodle/abschluss-sync', headers: admin, payload: {} });
    expect(s.json()).toMatchObject({ geprueft: 1, abgeschlossen: 1 });
    const a = (await app.inject({ method: 'GET', url: `/anmeldung/${anmeldung1}`, headers: admin })).json();
    expect(a.status).toBe('abgeschlossen');
    const ln = await pool.query('select lernstunden from lernnachweis where anmeldung_id=$1', [anmeldung1]);
    expect(Number(ln.rows[0].lernstunden)).toBe(36);
  });

  it('Face-to-Face-Buchungen aus Moodle uebernehmen (CSV, idempotent, Storno ignoriert)', async () => {
    const ka = await createKursangebot(pool, { code: 'VSL', titel: 'Vorsorge Lizenz', bereich: 'Banking', oeffentlich: true });
    const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, startDatum: '2027-04-01', endDatum: '2027-04-02', kapazitaet: 10 });
    await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
    await pool.query('update durchfuehrung set moodle_session_id=8718 where id=$1', [d.id]);
    const csv = 'Vorname;Nachname;E-Mail-Adresse;Status\nAnna;Beispiel;anna@bank.test;Gebucht\nBeat;Beispiel;beat@bank.test;Booked\nCarla;Beispiel;carla@bank.test;Cancelled\n';
    const r = await app.inject({ method: 'POST', url: '/integration/moodle/buchungen', headers: admin, payload: { moodleSessionId: 8718, csv } });
    expect(r.json()).toMatchObject({ neu: 2, bestaetigt: 2, uebersprungen: 1, fehler: [] });
    const nochmals = await app.inject({ method: 'POST', url: '/integration/moodle/buchungen', headers: admin, payload: { moodleSessionId: 8718, csv } });
    expect(nochmals.json()).toMatchObject({ neu: 0, bereitsVorhanden: 2 });
    mail.gesendet.length = 0;
    await verarbeite();
    expect(mail.gesendet).toHaveLength(0);                                               // Moodle bestaetigt selbst
  });

  it('Moodle-Push-Ereignis nur mit gueltiger Signatur ueber den Roh-Body', async () => {
    process.env.MOODLE_EVENT_SECRET = 'moodle-geheim';
    try {
      const body = JSON.stringify({ eventname: '\\core\\event\\course_completed', courseid: 42, relateduserid: 999 });
      const ts = Math.floor(Date.now() / 1000);
      const ok = await app.inject({ method: 'POST', url: '/integration/moodle/events', payload: body,
        headers: { 'content-type': 'application/json', 'x-bbz-timestamp': String(ts), 'x-bbz-signature': signiere('moodle-geheim', ts, body) } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ verarbeitet: 0 });
      const falsch = await app.inject({ method: 'POST', url: '/integration/moodle/events', payload: body,
        headers: { 'content-type': 'application/json', 'x-bbz-timestamp': String(ts), 'x-bbz-signature': 'sha256=00' } });
      expect(falsch.statusCode).toBe(401);
    } finally { delete process.env.MOODLE_EVENT_SECRET; }
  });
});

describe('Formular-Eingang (WPForms/Zapier)', () => {
  it('Kontaktformular -> CRM-Anfrage', async () => {
    const r = await pub('POST', '/public/v1/formulare/kontakt', { Name: 'Hans Beispiel', 'E-Mail': 'hans@bank.test', Nachricht: 'Offerte Tailor-made', Datenschutz: 'Ja', AGB: 'Ja' });
    expect(r.statusCode).toBe(201);
    const a = (await app.inject({ method: 'GET', url: `/anfrage/${r.json().referenz}`, headers: admin })).json();
    expect(a).toMatchObject({ status: 'neu', typ: 'kontakt', nachname: 'Beispiel' });
  });
  it('SAQ-Anmeldung -> SAQ-Vorgang mit Bank, Debitor und Herkunfts-Anfrage', async () => {
    const r = await pub('POST', '/public/v1/formulare/saq-anmeldung', {
      Bank: 'SZKB', Geschlecht: 'W', 'Vor- und Nachname': 'Petra Beispiel', 'Geschäftliche E-Mail': 'petra@szkb.test', 'Anmeldung für': 'Gesamtpaket',
      Profil: 'Individualkunden', Teilprüfungen: 'Erstzertifizierung', Geburtsdatum: '01.02.1990', 'Funktion/Rolle': 'Kundenberaterin',
      Sprache: 'DE', Datenschutz: 'Ja', AGB: 'Ja', 'Einverständnis Rechnung an Bank': 'Ja',
    }, { 'idempotency-key': 'wpforms-953870-77' });
    expect(r.statusCode).toBe(201);
    const fall = (await app.inject({ method: 'GET', url: `/saq/fall/${r.json().referenz}`, headers: admin })).json();
    expect(fall).toMatchObject({ profil: 'IK', status: 'angemeldet', einwilligungRechnungBank: true });
    expect(fall.organisationId).not.toBeNull();
    expect(fall.rechnungsempfaengerId).not.toBeNull();
    const anf = await pool.query('select status, payload from anfrage where id=$1', [fall.anfrageId]);
    expect(anf.rows[0].status).toBe('uebernommen');
    expect(anf.rows[0].payload.formular).toBe('saq-anmeldung');
  });
  it('unvollstaendiges Formular -> 422 mit Fehlerliste; unbekanntes -> 404', async () => {
    const r = await pub('POST', '/public/v1/formulare/saq-anmeldung', { Name: 'X Y', 'E-Mail': 'x@y.ch', Datenschutz: 'Ja', AGB: 'Ja' });
    expect(r.statusCode).toBe(422);
    expect(r.json().fehler).toContain('Bank fehlt');
    expect((await pub('POST', '/public/v1/formulare/gibtsnicht', {})).statusCode).toBe(404);
  });
});

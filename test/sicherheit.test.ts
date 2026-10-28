import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { buildApp } from '../src/server/app';
import { createKursangebot } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { createKontakt, getKontakt } from '../src/repos/kontaktRepo';
import { istPrivateAdresse, pruefeWebhookUrlSyntax, stelleZu } from '../src/integrations/webhooks';
import { enthaeltSteuerzeichen } from '../src/server/publicSchutz';

/* Regressionstests zum Security-Review der oeffentlichen Angriffsflaeche (28.10.2026). */
const pool = getPool();
const app = buildApp(pool, { publicLimits: { schreibenProIp: 1000 } });
const admin = { 'x-user-role': 'admin' };
let key = ''; let code = ''; let codeIntern = '';
const post = (url: string, payload: unknown, extra: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as any, headers: { 'x-api-key': key, ...extra } });
const anmeldung = (email: string, ueber: Record<string, unknown> = {}) => ({ durchfuehrungCode: code,
  kontakt: { vorname: 'Eva', nachname: 'Beispiel', email }, datenschutz: true, agb: true, ...ueber });

beforeAll(async () => {
  await resetDb(pool);
  const base = await grundbestand(pool);
  app.get('/__test/fehler', async () => { throw new Error('select * from geheim; SQLSTATE 22021'); });
  await app.ready();
  key = (await app.inject({ method: 'POST', url: '/admin/api-clients', headers: admin,
    payload: { name: 'Homepage', scopes: ['public:read', 'public:anmeldung', 'public:formular'] } })).json().schluessel;
  const ka = await createKursangebot(pool, { code: 'SEC', titel: 'Sicherheitskurs', bereich: 'Banking', oeffentlich: true });
  const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-09-01', endDatum: '2027-09-01', kapazitaet: 10 });
  await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben'); code = d.code!;
  const intern = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-09-02', endDatum: '2027-09-02', oeffentlich: false });
  await setDurchfuehrungStatus(pool, intern.id, 'ausgeschrieben'); codeIntern = intern.code!;
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Security-Review: oeffentliche API', () => {
  it('Befund 2: keine Auskunft, ob jemand angemeldet ist (Doppelanmeldung neutral)', async () => {
    expect((await post('/public/v1/anmeldungen', anmeldung('opfer@bank.test'))).statusCode).toBe(201);
    const zweit = await post('/public/v1/anmeldungen', anmeldung('opfer@bank.test'));
    expect(zweit.statusCode).toBe(202);
    expect(zweit.json()).toEqual({ status: 'eingegangen' });
  });

  it('Befund 2: Steuerzeichen werden abgewiesen, interne Fehler nie offengelegt', async () => {
    expect(enthaeltSteuerzeichen({ a: ['x\u0000y'] })).toBe(true);
    expect(enthaeltSteuerzeichen({ a: 'Zeile 1\nZeile 2\tTab' })).toBe(false);
    const r = await post('/public/v1/anmeldungen', anmeldung('nul@bank.test', { rechnungsreferenz: 'a\u0000b' }));
    expect(r.statusCode).toBe(400);
    const f = await app.inject({ method: 'GET', url: '/__test/fehler', headers: admin });
    expect(f.statusCode).toBe(500);
    expect(f.json()).toEqual({ error: 'Interner Fehler' });
    expect(f.body).not.toMatch(/SQLSTATE|geheim/);
  });

  it('Befund 3: bestehende Kontakte werden von der Homepage nicht veraendert (nur Bemerkung)', async () => {
    const k = await createKontakt(pool, { nachname: 'Bestand', vorname: 'Berta', email: 'bestand@bank.test' });
    const r = await post('/public/v1/anmeldungen', anmeldung('bestand@bank.test', { kontakt: { vorname: 'Mallory', nachname: 'Bestand', email: 'bestand@bank.test', telefon: '+41 79 666 66 66', funktion: 'CEO' }, organisation: 'Irgendeine Bank' }));
    expect(r.statusCode).toBe(201);
    const nachher = await getKontakt(pool, k.id);
    expect(nachher).toMatchObject({ vorname: 'Berta', telefon: null, funktion: null, organisationId: null });
    const a = await pool.query('select bemerkung from anmeldung where id=$1', [r.json().referenz]);
    expect(a.rows[0].bemerkung).toMatch(/nicht uebernommen.*Vorname: Mallory.*Telefon/s);
  });

  it('Befund 6: nicht-oeffentliche Durchfuehrungen sind nicht von unbekannten zu unterscheiden', async () => {
    const intern = await post('/public/v1/anmeldungen', anmeldung('x1@bank.test', { durchfuehrungCode: codeIntern }));
    const unbekannt = await post('/public/v1/anmeldungen', anmeldung('x2@bank.test', { durchfuehrungCode: 'GIBT-2027-9' }));
    expect([intern.statusCode, unbekannt.statusCode]).toEqual([202, 202]);
    expect(intern.json()).toEqual(unbekannt.json());
    expect(intern.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('Befund 4: Rate-Limit je Absender-IP', async () => {
    const eng = buildApp(pool, { publicLimits: { schreibenProIp: 2 } });
    await eng.ready();
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await eng.inject({ method: 'POST', url: '/public/v1/anmeldungen', payload: {}, headers: { 'x-api-key': key } })).statusCode);
    expect(r).toEqual([400, 400, 429]);
    await eng.close();
  });
});

describe('Security-Review: Webhooks (Befund 7)', () => {
  it('erkennt interne Adressen und lehnt sie als Ziel ab', () => {
    expect(['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(istPrivateAdresse)).toBe(true);
    expect(['8.8.8.8', '193.5.1.1', '2a00:1450::1'].some(istPrivateAdresse)).toBe(false);
    for (const u of ['http://a.ch/h', 'https://localhost/h', 'https://127.0.0.1/h', 'https://[::1]/h', 'https://169.254.169.254/latest']) {
      expect(() => pruefeWebhookUrlSyntax(u)).toThrow();
    }
  });
  it('Admin-Route lehnt interne Ziele ab', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/webhooks', headers: admin, payload: { name: 'x', url: 'https://10.0.0.5/hook', ereignisse: ['*'] } });
    expect(r.statusCode).toBe(400);
  });
  it('folgt keinen Weiterleitungen', async () => {
    const abo = await pool.query(`insert into webhook_abo(name,url,secret,ereignisse) values ('r','https://extern.example/h','s','{*}') returning id`);
    const f = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as unknown as typeof fetch;
    await expect(stelleZu(pool, { id: 1, typ: 'webhook.zustellung', aggregatId: null, payload: { aboId: abo.rows[0].id, ereignis: 'x', daten: {} }, status: 'in_arbeit', versuche: 1, maxVersuche: 8, naechsterVersuchAm: '', letzterFehler: null },
      { fetch: f, pruefeZiel: async () => {} })).rejects.toThrow(/Weiterleitungen/);
  });
});

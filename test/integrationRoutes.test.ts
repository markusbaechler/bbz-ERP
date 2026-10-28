import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { buildApp } from '../src/server/app';
import { FakeMoodle } from './helpers/fakeMoodle';
import { MoodleClient } from '../src/integrations/moodle/client';
import { ProtokollMailAdapter } from '../src/integrations/mail';
import { verifiziereSchluessel } from '../src/repos/apiClientRepo';
import { mitIdempotenz, RateLimiter } from '../src/server/publicSchutz';

const pool = getPool();
const fake = new FakeMoodle();
const app = buildApp(pool, { integration: { moodle: new MoodleClient({ url: 'https://m.test', token: fake.token, fetch: fake.fetch }), mail: new ProtokollMailAdapter() } });
const admin = { 'x-user-role': 'admin' };
beforeAll(async () => { await resetDb(pool); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('Integrations-Administration', () => {
  it('API-Client: Schluessel nur einmal sichtbar, gehasht gespeichert, rotierbar, deaktivierbar', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/api-clients', headers: admin,
      payload: { name: 'Homepage', scopes: ['public:read', 'public:formular'], erlaubteOrigins: ['https://www.bankenberatungszentrum.ch'] } });
    expect(r.statusCode).toBe(201);
    const { client, schluessel } = r.json();
    expect(schluessel).toMatch(/^bbz_[0-9a-f]{8}_/);
    const roh = await pool.query('select key_hash from api_client where id=$1', [client.id]);
    expect(roh.rows[0].key_hash).not.toContain(schluessel);
    expect((await verifiziereSchluessel(pool, schluessel))?.id).toBe(client.id);
    expect(await verifiziereSchluessel(pool, schluessel.slice(0, -1) + 'x')).toBeNull();
    const neu = (await app.inject({ method: 'POST', url: `/admin/api-clients/${client.id}/rotieren`, headers: admin })).json();
    expect(await verifiziereSchluessel(pool, schluessel)).toBeNull();
    expect((await verifiziereSchluessel(pool, neu.schluessel))?.id).toBe(client.id);
    await app.inject({ method: 'PATCH', url: `/admin/api-clients/${client.id}`, headers: admin, payload: { aktiv: false } });
    expect(await verifiziereSchluessel(pool, neu.schluessel)).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/admin/api-clients', headers: admin })).json()[0]).not.toHaveProperty('keyHash');
  });
  it('validiert Scopes und Origins', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/api-clients', headers: admin, payload: { name: 'X', scopes: ['alles'], erlaubteOrigins: ['https://a.ch/pfad'] } });
    expect(r.statusCode).toBe(400);
  });
  it('Webhook-Abo: nur https, bekannte Ereignisse, Secret einmalig', async () => {
    expect((await app.inject({ method: 'POST', url: '/admin/webhooks', headers: admin, payload: { name: 'X', url: 'http://a.ch', ereignisse: ['*'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/admin/webhooks', headers: admin, payload: { name: 'X', url: 'https://a.ch/h', ereignisse: ['erfunden'] } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/admin/webhooks', headers: admin, payload: { name: 'WordPress', url: 'https://www.example.test/wp-json/bbz/v1/hook', ereignisse: ['kurs.aktualisiert'] } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().secret.length).toBeGreaterThan(20);
    expect((await app.inject({ method: 'GET', url: '/admin/webhooks', headers: admin })).json()[0]).not.toHaveProperty('secret');
  });
  it('Outbox-Monitor und manueller Lauf', async () => {
    await app.inject({ method: 'POST', url: '/admin/webhooks/test', headers: admin });
    const v = await app.inject({ method: 'POST', url: '/admin/outbox/verarbeiten', headers: admin });
    expect(v.json().erledigt).toBeGreaterThanOrEqual(1);
    const stat = (await app.inject({ method: 'GET', url: '/admin/outbox/statistik', headers: admin })).json();
    expect(stat.some((s: any) => s.typ === 'webhook' && s.status === 'erledigt')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/admin/outbox' })).statusCode).toBe(403);
  });
  it('Moodle-Status meldet Version und fehlende Web-Service-Funktionen', async () => {
    const s = (await app.inject({ method: 'GET', url: '/integration/moodle/status', headers: admin })).json();
    expect(s).toMatchObject({ konfiguriert: true, erreichbar: true, release: '4.5' });
    expect(s.fehlendeFunktionen).toContain('enrol_manual_enrol_users');
    const ohne = buildApp(pool, { integration: { moodle: null } });
    expect((await ohne.inject({ method: 'GET', url: '/integration/moodle/status', headers: admin })).json()).toMatchObject({ konfiguriert: false });
    await ohne.close();
  });
});

describe('Public-Schutz-Bausteine', () => {
  it('Rate-Limit je Minute', () => {
    let t = 0; const rl = new RateLimiter(2, () => t);
    expect([rl.erlaubt('a').ok, rl.erlaubt('a').ok, rl.erlaubt('a').ok, rl.erlaubt('b').ok]).toEqual([true, true, false, true]);
    t = 60_001; expect(rl.erlaubt('a').ok).toBe(true);
  });
  it('Idempotenz: gleiche Antwort ohne erneute Ausfuehrung, auch parallel', async () => {
    const c = await pool.query(`insert into api_client(name,key_prefix,key_hash) values ('t','bbz_00000000','x') returning id`);
    let n = 0;
    const fn = async () => { n++; await new Promise((r) => setTimeout(r, 30)); return { status: 201, body: { nr: n } }; };
    const [a, b] = await Promise.all([mitIdempotenz(pool, c.rows[0].id, 'k1', fn), mitIdempotenz(pool, c.rows[0].id, 'k1', fn)]);
    expect(n).toBe(1);
    expect(a.body).toEqual(b.body);
    expect([a.wiederholt, b.wiederholt].sort()).toEqual([false, true]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type KeyLike } from 'jose';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createMitarbeitende, getMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import { buildApp } from '../src/server/app';
import { authKonfigAusEnv, istOeffentlich } from '../src/server/authHook';

const pool = getPool();
const TENANT = '00000000-0000-0000-0000-00000000aaaa';
const AUD = 'api://bbz-erp';
const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;
let privat: KeyLike; let fremd: KeyLike;
let app: ReturnType<typeof buildApp>;
let standardId: string;

async function token(claims: Record<string, unknown>, opts: { key?: KeyLike; aud?: string; exp?: string } = {}) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISS)
    .setAudience(opts.aud ?? AUD).setIssuedAt().setExpirationTime(opts.exp ?? '5m').sign(opts.key ?? privat);
}
const get = async (url: string, t?: string) => app.inject({ method: 'GET', url, headers: t ? { authorization: `Bearer ${t}` } : {} });

beforeAll(async () => {
  await resetDb(pool);
  const kp = await generateKeyPair('RS256'); privat = kp.privateKey;
  fremd = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256' };
  app = buildApp(pool, { auth: { modus: 'entra', tenantId: TENANT, audience: AUD, adminRolle: 'bbz.admin', jwks: createLocalJWKSet({ keys: [jwk] }) } });
  await app.ready();
  await createMitarbeitende(pool, { kuerzel: 'ml', nachname: 'Admin', email: 'ml@bbz.test', rolle: 'admin', entraOid: 'oid-admin' });
  standardId = (await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Standard', email: 'ph@bbz.test' })).id;
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Entra-ID-Auth', () => {
  it('401 ohne Token, oeffentliche Pfade bleiben offen', async () => {
    expect((await get('/admin/ping')).statusCode).toBe(401);
    expect((await get('/health')).statusCode).toBe(200);
    expect(istOeffentlich('/public/v1/kurse?x=1')).toBe(true);
    expect(istOeffentlich('/projekt')).toBe(false);
  });
  it('akzeptiert gueltiges Token und mappt Admin ueber oid', async () => {
    expect((await get('/admin/ping', await token({ oid: 'oid-admin' }))).statusCode).toBe(200);
  });
  it('lehnt fremde Signatur, falsche Audience und abgelaufene Tokens ab (401)', async () => {
    expect((await get('/admin/ping', await token({ oid: 'oid-admin' }, { key: fremd }))).statusCode).toBe(401);
    expect((await get('/admin/ping', await token({ oid: 'oid-admin' }, { aud: 'api://andere' }))).statusCode).toBe(401);
    expect((await get('/admin/ping', await token({ oid: 'oid-admin' }, { exp: '-1m' }))).statusCode).toBe(401);
  });
  it('mappt per E-Mail, traegt oid nach und vergibt Admin ueber App-Rolle', async () => {
    expect((await get('/admin/ping', await token({ oid: 'oid-ph', preferred_username: 'PH@bbz.test' }))).statusCode).toBe(403);
    expect((await getMitarbeitende(pool, standardId)).entraOid).toBe('oid-ph');
    expect((await get('/mitarbeitende', await token({ oid: 'oid-ph' }))).statusCode).toBe(200);
    expect((await get('/admin/ping', await token({ oid: 'oid-ph', roles: ['bbz.admin'] }))).statusCode).toBe(200);
  });
  it('403 fuer gueltige Tokens ohne freigeschaltetes Konto', async () => {
    const r = await get('/mitarbeitende', await token({ oid: 'unbekannt', preferred_username: 'x@extern.test' }));
    expect(r.statusCode).toBe(403);
  });
  it('liest die Konfiguration aus der Umgebung', () => {
    expect(authKonfigAusEnv({}).modus).toBe('dev');
    expect(() => authKonfigAusEnv({ NODE_ENV: 'production' })).toThrow(/in Produktion gesperrt/);
    expect(authKonfigAusEnv({ NODE_ENV: 'production', ERLAUBE_DEV_AUTH: 'true' }).modus).toBe('dev');
    expect(() => authKonfigAusEnv({ AUTH_MODE: 'entra' })).toThrow(/ENTRA_TENANT_ID/);
    expect(authKonfigAusEnv({ AUTH_MODE: 'entra', ENTRA_TENANT_ID: 't', ENTRA_AUDIENCE: 'a' })).toMatchObject({ modus: 'entra', adminRolle: 'bbz.admin' });
  });
});

describe('Entra-ID: oid-Bindung (Security-Review Befund 5)', () => {
  it('ein gebundenes Konto kann nicht ueber gleiche E-Mail mit anderer oid uebernommen werden', async () => {
    await createMitarbeitende(pool, { kuerzel: 'gb', nachname: 'Gebunden', email: 'gb@bbz.test', rolle: 'admin', entraOid: 'oid-gb' });
    expect((await get('/admin/ping', await token({ oid: 'oid-fremd', preferred_username: 'gb@bbz.test' }))).statusCode).toBe(403);
    expect((await get('/admin/ping', await token({ oid: 'oid-gb' }))).statusCode).toBe(200);
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import { buildApp, hoerAdresse } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';

const app = buildApp(getPool());
afterAll(async () => { await app.close(); await closePool(); });

describe('auth', () => {
  it('403 auf Admin-Route ohne admin-Rolle', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ping', headers: { 'x-user-role': 'standard' } });
    expect(res.statusCode).toBe(403);
  });
  it('200 mit admin-Rolle', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ping', headers: { 'x-user-role': 'admin' } });
    expect(res.statusCode).toBe(200);
  });
});

// Befund I5: solange die Identitaet ein Header ist, den jeder Client setzen
// kann, darf der Server nicht von sich aus im ganzen Netz zu erreichen sein.
// Weiter aufmachen nur ausdruecklich, ueber HTTP_HOST.
describe('hoerAdresse', () => {
  it('bindet ohne Angabe nur an loopback', () => {
    expect(hoerAdresse({})).toBe('127.0.0.1');
    expect(hoerAdresse({ HTTP_HOST: '' })).toBe('127.0.0.1');
  });
  it('oeffnet erst auf ausdrueckliche Angabe', () => {
    expect(hoerAdresse({ HTTP_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(hoerAdresse({ HTTP_HOST: '10.0.0.5' })).toBe('10.0.0.5');
  });
});

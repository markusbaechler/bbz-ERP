import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';

const app = buildApp(getPool());
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('statische Auslieferung', () => {
  it('liefert die Startseite unter /', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('id="inhalt"');
  });

  it('liefert Stylesheet und Module', async () => {
    expect((await app.inject({ method: 'GET', url: '/stil.css' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/app.js' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ui/zustand.js' })).statusCode).toBe(200);
  });

  it('laesst die API-Routen unberuehrt', async () => {
    const r = await app.inject({ method: 'GET', url: '/zaehler/rechnung' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('untergrenze');
  });

  it('verweigert Pfad-Traversierung', async () => {
    const r = await app.inject({ method: 'GET', url: '/../package.json' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});

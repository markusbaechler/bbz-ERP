import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { buildApp } from '../src/server/app';

const app = buildApp(getPool());
afterAll(async () => { await app.close(); await closePool(); });

describe('statische Auslieferung', () => {
  it('liefert die PWA unter /app/ und leitet / weiter (ohne Anmeldung)', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).headers.location).toBe('/app/');
    const r = await app.inject({ method: 'GET', url: '/app/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
  });
});

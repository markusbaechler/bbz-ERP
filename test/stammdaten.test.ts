import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { buildApp } from '../src/server/app';
import { createMwstSatz } from '../src/repos/mwstSatzRepo';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
beforeAll(async () => { await resetDb(pool); await grundbestand(pool); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('Stammdaten- und Sitzungsrouten', () => {
  it('GET /me liefert Person und wirksame Rolle', async () => {
    const r = (await app.inject({ method: 'GET', url: '/me', headers: admin })).json();
    expect(r).toMatchObject({ kuerzel: 'ml', rolle: 'admin', mitarbeitende: { nachname: 'Muster' } });
  });
  it('Kontenplan und MWSt-Saetze (gueltig am Stichtag) lesen, nur Admin schreibt', async () => {
    expect((await app.inject({ method: 'POST', url: '/konto', payload: { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/konto', headers: admin, payload: { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/konto' })).json().map((k: any) => k.nummer)).toEqual(['3100']);
    await createMwstSatz(pool, { satz: 7.7, bezeichnung: 'Normal (alt)', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' });
    await createMwstSatz(pool, { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01' });
    const heute = (await app.inject({ method: 'GET', url: '/mwst-satz?gueltigAm=2026-10-28' })).json();
    expect(heute.map((s: any) => s.satz)).toEqual([8.1]);
  });
});

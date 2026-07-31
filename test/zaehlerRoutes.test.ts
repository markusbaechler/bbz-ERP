import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { getZaehler } from '../src/repos/zaehlerRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
beforeAll(async () => { await resetDb(getPool()); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('zaehler-routes', () => {
  // Lesend wie die uebrigen GET-Routen (auftraggeber.ts, debitor.ts): ohne Rollenpruefung.
  it('meldet Stand, Untergrenze und die Sperre — ohne Admin-Rolle', async () => {
    const g = await app.inject({ method: 'GET', url: '/zaehler/rechnung' });
    expect(g.statusCode).toBe(200);
    expect(g.json()).toMatchObject({ wert: 0, untergrenze: 31491, gesperrt: true, gesetztAm: null, gesetztDurch: null });
  });

  it('setzt den Zaehler nur mit Admin-Rolle', async () => {
    const ohne = await app.inject({ method: 'PUT', url: '/zaehler/rechnung', payload: { wert: 33214 } });
    expect(ohne.statusCode).toBe(403);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);

    const mit = await app.inject({ method: 'PUT', url: '/zaehler/rechnung', headers: admin, payload: { wert: 33214 } });
    expect(mit.statusCode).toBe(200);
    expect(mit.json().wert).toBe(33214);
    expect(mit.json().gesperrt).toBe(false);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('weist ein Zuruecksetzen mit 400 ab', async () => {
    const res = await app.inject({ method: 'PUT', url: '/zaehler/rechnung', headers: admin, payload: { wert: 100 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('33214');
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('weist einen unbrauchbaren Wert mit 400 ab', async () => {
    for (const payload of [{ wert: 'abc' }, { wert: 33215.5 }, {}]) {
      const res = await app.inject({ method: 'PUT', url: '/zaehler/rechnung', headers: admin, payload });
      expect(res.statusCode).toBe(400);
    }
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  // Wer gesetzt hat, muss abrufbar sein. Eine echte Benutzeridentitaet gibt es noch
  // nicht (Auth ist bis Plan 6 der Header-Platzhalter x-user-role) — festgehalten
  // wird darum genau das, was tatsaechlich vorliegt.
  it('weist im Nachweis aus, wer wann gesetzt hat', async () => {
    const g = await app.inject({ method: 'GET', url: '/zaehler/rechnung' });
    expect(g.json().gesetztDurch).toContain('x-user-role=admin');
    expect(g.json().gesetztAm).not.toBeNull();
    expect(new Date(g.json().gesetztAm).getTime()).toBeGreaterThan(0);
  });
});

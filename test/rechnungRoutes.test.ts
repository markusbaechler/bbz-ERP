import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  // Ausgangslage wie nach einem echten Deployment: der Zaehler steht auf dem aus
  // FileMaker abgelesenen Hoechststand. Ohne das blockt die Untergrenze jede
  // Festschreibung (src/config/rechnungszaehler.ts) — geprueft in zaehlerSperre.test.ts.
  await setzeRechnungZaehler(getPool(), 33214);
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('rechnung-routes', () => {
  it('Draft -> Position -> Festschreiben ergibt Nummer und Totale', async () => {
    const c = await app.inject({ method: 'POST', url: '/rechnung', headers: admin,
      payload: { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' } });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;

    const p = await app.inject({ method: 'POST', url: `/rechnung/${id}/position`, headers: admin,
      payload: { beschreibung: '33.5 Std', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' } });
    expect(p.statusCode).toBe(201);

    const f = await app.inject({ method: 'POST', url: `/rechnung/${id}/festschreiben`, headers: admin,
      payload: { erstellerKuerzel: 'ml' } });
    expect(f.statusCode).toBe(200);
    expect(f.json().nummer).toBe('6231.26 - 33215 ml'); // erste Nummer nach dem FileMaker-Stand 33214
    expect(Number(f.json().totalBrutto)).toBe(8329.10);

    const g = await app.inject({ method: 'GET', url: `/rechnung/${id}` });
    expect(g.json().positionen).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let auftraggeberId: string; let rechnungId: string;
beforeAll(async () => {
  await resetDb(getPool());
  // Ausgangslage wie nach einem echten Deployment: der Zaehler steht auf dem aus
  // FileMaker abgelesenen Hoechststand. Ohne das blockt die Untergrenze jede
  // Festschreibung (src/config/rechnungszaehler.ts) — geprueft in zaehlerSperre.test.ts.
  await setzeRechnungZaehler(getPool(), 33214);
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  const projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 1000, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  rechnungId = r.id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('debitor-routes', () => {
  it('Zahlung -> offene Posten -> Saldo', async () => {
    const z = await app.inject({ method: 'POST', url: `/rechnung/${rechnungId}/zahlung`, headers: admin, payload: { datum: '2026-08-01', betrag: 400 } });
    expect(z.statusCode).toBe(201);
    expect(z.json().offen).toBe(600);

    const op = await app.inject({ method: 'GET', url: `/debitoren/offene-posten?auftraggeberId=${auftraggeberId}` });
    expect(op.json()).toHaveLength(1);
    expect(op.json()[0].offen).toBe(600);

    const s = await app.inject({ method: 'GET', url: `/auftraggeber/${auftraggeberId}/saldo` });
    expect(s.json().saldo).toBe(600);
  });
});

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
let rechnungId: string;
beforeAll(async () => {
  await resetDb(getPool());
  // Ausgangslage wie nach einem echten Deployment: der Zaehler steht auf dem aus
  // FileMaker abgelesenen Hoechststand. Ohne das blockt die Untergrenze jede
  // Festschreibung (src/config/rechnungszaehler.ts) — geprueft in zaehlerSperre.test.ts.
  await setzeRechnungZaehler(getPool(), 33214);
  const auftraggeberId = (await createAuftraggeber(getPool(), { name: 'bbz academy', strasse: 'Zürcherstrasse 202', plz: '9014', ort: 'St. Gallen' })).id;
  const projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: '33.5 Std', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
  await festschreiben(getPool(), r.id, 'ml');
  rechnungId = r.id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('GET /rechnung/:id/pdf', () => {
  it('liefert ein PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/rechnung/${rechnungId}/pdf`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

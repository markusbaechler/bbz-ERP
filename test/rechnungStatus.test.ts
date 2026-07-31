import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, setDefVereinbart, stornieren } from '../src/repos/rechnungRepo';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  // Ausgangslage wie nach einem echten Deployment: der Zaehler steht auf dem aus
  // FileMaker abgelesenen Hoechststand. Ohne das blockt die Untergrenze jede
  // Festschreibung (src/config/rechnungszaehler.ts) — geprueft in zaehlerSperre.test.ts.
  await setzeRechnungZaehler(getPool(), 33214);
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('status-übergänge', () => {
  it('offen_prov -> def_vereinbart', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    const d = await setDefVereinbart(getPool(), r.id);
    expect(d.status).toBe('def_vereinbart');
  });
  it('abgerechnet -> storniert behält Nummer', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
    const fg = await festschreiben(getPool(), r.id, 'ml');
    const st = await stornieren(getPool(), r.id);
    expect(st.status).toBe('storniert');
    expect(st.nummer).toBe(fg.nummer); // Nummer bleibt -> keine Lücke
  });
  it('Storno aus Entwurf verboten', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(stornieren(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

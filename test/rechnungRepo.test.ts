import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, getRechnung } from '../src/repos/rechnungRepo';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('rechnungRepo', () => {
  it('erstellt Draft und berechnet Totale aus Positionen (exkl, Rappenrundung)', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', betreff: 'Verrechnung', mwstModus: 'exkl' });
    expect(r.status).toBe('offen_prov');
    expect(r.lfdNr).toBeNull();

    await addPosition(getPool(), r.id, { beschreibung: '33.5 Std. à 230.00', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
    const updated = await getRechnung(getPool(), r.id);
    expect(Number(updated.totalNetto)).toBe(7705);
    expect(Number(updated.totalMwst)).toBe(624.10);
    expect(Number(updated.totalBrutto)).toBe(8329.10);
  });
});

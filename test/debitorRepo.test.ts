import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, getRechnung } from '../src/repos/rechnungRepo';
import { erfasseZahlung, summeBezahlt, offenerBetrag } from '../src/repos/debitorRepo';
import { ValidationError } from '../src/domain/errors';

let auftraggeberId: string; let projektId: string;
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

async function festeRechnung(betrag: number): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: betrag, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  return r.id;
}

describe('offenerBetrag', () => {
  it('rundet Brutto minus Bezahlt', () => {
    expect(offenerBetrag(8329.10, 8329.10)).toBe(0);
    expect(offenerBetrag(100, 40)).toBe(60);
  });
});

describe('erfasseZahlung', () => {
  it('Vollzahlung setzt Status bezahlt, offen 0', async () => {
    const id = await festeRechnung(1000);
    const res = await erfasseZahlung(getPool(), id, { datum: '2026-08-01', betrag: 1000 });
    expect(res.rechnungStatus).toBe('bezahlt');
    expect(res.offen).toBe(0);
    expect((await getRechnung(getPool(), id)).status).toBe('bezahlt');
  });
  it('Teilzahlung bleibt abgerechnet mit Restbetrag', async () => {
    const id = await festeRechnung(1000);
    const res = await erfasseZahlung(getPool(), id, { datum: '2026-08-01', betrag: 400 });
    expect(res.rechnungStatus).toBe('abgerechnet');
    expect(res.offen).toBe(600);
    expect(await summeBezahlt(getPool(), id)).toBe(400);
  });
  it('lehnt Zahlung auf Entwurf ab', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(erfasseZahlung(getPool(), r.id, { datum: '2026-08-01', betrag: 10 })).rejects.toBeInstanceOf(ValidationError);
  });
});

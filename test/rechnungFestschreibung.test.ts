import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function draftMitPosition(): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
  return r.id;
}

describe('festschreiben', () => {
  it('vergibt lückenlose lfdNr und baut nummer', async () => {
    const a = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    const b = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    expect(a.lfdNr).toBe(1);
    expect(b.lfdNr).toBe(2);
    expect(a.status).toBe('abgerechnet');
    expect(a.nummer).toBe('6231.26 - 1 ml');
    expect(b.nummer).toBe('6231.26 - 2 ml');
  });
  it('verweigert Festschreibung ohne Positionen', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(festschreiben(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
  });
  it('verweigert Positionsänderung nach Festschreibung', async () => {
    const id = await draftMitPosition();
    await festschreiben(getPool(), id);
    await expect(addPosition(getPool(), id, { beschreibung: 'Y', menge: 1, einzelpreis: 1, mwstSatz: 8.1 }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

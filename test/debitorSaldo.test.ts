import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { erfasseZahlung, offenePosten, kontokorrentSaldo } from '../src/repos/debitorRepo';

let auftraggeberId: string; let projektId: string;
beforeAll(async () => {
  await resetDb(getPool());
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

describe('offene Posten + Saldo', () => {
  it('summiert offene Beträge je Auftraggeber', async () => {
    const a = await festeRechnung(1000); // offen 1000
    const b = await festeRechnung(500);
    await erfasseZahlung(getPool(), b, { datum: '2026-08-01', betrag: 200 }); // offen 300
    const c = await festeRechnung(400);
    await erfasseZahlung(getPool(), c, { datum: '2026-08-01', betrag: 400 }); // bezahlt -> nicht offen

    const op = await offenePosten(getPool(), { auftraggeberId });
    const ids = op.map((p) => p.rechnungId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(c);
    expect(await kontokorrentSaldo(getPool(), auftraggeberId)).toBe(1300); // 1000 + 300
  });
});

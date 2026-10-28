import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { camt054 } from './helpers/camt';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, getRechnung, stornieren } from '../src/repos/rechnungRepo';
import { verbucheCamt054 } from '../src/repos/zahlungImportRepo';
import { listZahlungen } from '../src/repos/debitorRepo';
import { qrReferenzRoh } from '../src/domain/qrReferenz';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let auftraggeberId: string; let projektId: string;

beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

async function festeRechnung(betrag: number): Promise<{ id: string; qrr: string }> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-10-01', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: betrag, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  const fest = await getRechnung(getPool(), r.id);
  return { id: r.id, qrr: qrReferenzRoh(fest.lfdNr!) };
}

describe('camt.054-Import (loest den VESR-Bankfile-Import ab)', () => {
  it('verbucht QR-Zahlungen ueber die Referenz und meldet nicht zuordenbare Zahlungen', async () => {
    const a = await festeRechnung(1000); const b = await festeRechnung(500);
    const e = await verbucheCamt054(getPool(), camt054([
      { betrag: 1000, datum: '2026-11-02', txRef: 'TX-A', qrr: a.qrr },
      { betrag: 200, datum: '2026-11-02', txRef: 'TX-B', qrr: b.qrr },
      { betrag: 99, datum: '2026-11-02', txRef: 'TX-C', mitteilung: 'ohne Referenz' },
      { betrag: 50, datum: '2026-11-02', txRef: 'TX-D', qrr: qrReferenzRoh(999999) },
    ]), 'ml');
    expect(e.verbucht.map((v) => [v.rechnungId, v.betrag, v.rechnungStatus])).toEqual([[a.id, 1000, 'bezahlt'], [b.id, 200, 'abgerechnet']]);
    expect(e.nichtZugeordnet.map((n) => [n.betrag, n.grund])).toEqual([[99, 'keine QR-Referenz'], [50, 'keine Rechnung zur Referenz']]);
    expect((await getRechnung(getPool(), a.id)).status).toBe('bezahlt');
    expect((await listZahlungen(getPool(), b.id))[0]).toMatchObject({ datum: '2026-11-02', betrag: 200, erfasstDurch: 'ml' });
  });

  it('ist idempotent: dieselbe Datei nochmals verbucht nichts doppelt', async () => {
    const r = await festeRechnung(300);
    const datei = camt054([{ betrag: 300, datum: '2026-11-03', txRef: 'TX-IDEM', qrr: r.qrr }]);
    expect((await verbucheCamt054(getPool(), datei, 'ml')).verbucht).toHaveLength(1);
    const zweit = await verbucheCamt054(getPool(), datei, 'ml');
    expect(zweit.verbucht).toHaveLength(0);
    expect(zweit.bereitsVerbucht).toBe(1);
    expect(await listZahlungen(getPool(), r.id)).toHaveLength(1);
  });

  it('nimmt keine Fremdwaehrung und keine Zahlung auf stornierte Rechnungen an, verbucht den Rest trotzdem', async () => {
    const ok = await festeRechnung(100);
    const storno = await festeRechnung(70);
    await stornieren(getPool(), storno.id, 'Test', 'ml');
    const e = await verbucheCamt054(getPool(), camt054([
      { betrag: 100, datum: '2026-11-04', txRef: 'TX-EUR', qrr: ok.qrr, waehrung: 'EUR' },
      { betrag: 70, datum: '2026-11-04', txRef: 'TX-STORNO', qrr: storno.qrr },
      { betrag: 100, datum: '2026-11-04', txRef: 'TX-OK', qrr: ok.qrr },
    ]), 'ml');
    expect(e.nichtZugeordnet.map((n) => n.grund)).toEqual(['Waehrung EUR', 'Zahlung nur auf festgeschriebene Rechnung (Status storniert)']);
    expect(e.verbucht.map((v) => v.rechnungId)).toEqual([ok.id]);
    expect(await listZahlungen(getPool(), storno.id)).toHaveLength(0);
  });

  it('Route POST /debitoren/camt054 nur fuer Admin, 400 bei fremder Datei', async () => {
    const r = await festeRechnung(80);
    const datei = camt054([{ betrag: 80, datum: '2026-11-05', txRef: 'TX-ROUTE', qrr: r.qrr }]);
    expect((await app.inject({ method: 'POST', url: '/debitoren/camt054', payload: { xml: datei } })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/debitoren/camt054', headers: admin, payload: { xml: datei } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verbucht).toHaveLength(1);
    const fremd = await app.inject({ method: 'POST', url: '/debitoren/camt054', headers: admin, payload: { xml: '<Document><X/></Document>' } });
    expect(fremd.statusCode).toBe(400);
  });
});

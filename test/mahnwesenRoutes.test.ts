import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { heute, addTage } from '../src/domain/mahnwesen';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
let alt: string; let neu: string;
// Daten relativ zu heute, damit der Test nicht von der Systemuhr abhaengt.
const altDatum = addTage(heute(), -100);
const faellig = addTage(altDatum, 30);
const stichtag = addTage(faellig, 1);

async function rechnung(projektId: string, auftraggeberId: string, datum: string): Promise<string> {
  const r = await createRechnung(pool, { projektId, auftraggeberId, datum });
  await addPosition(pool, r.id, { beschreibung: 'Pruefungsgebuehr', menge: 1, einzelpreis: 2025, mwstSatz: 0 });
  await festschreiben(pool, r.id, 'ml');
  return r.id;
}

beforeAll(async () => {
  await resetDb(pool);
  const ag = await createAuftraggeber(pool, { name: 'Musterbank AG', strasse: 'Bankweg 1', plz: '9000', ort: 'St. Gallen' });
  const p = await createProjekt(pool, { stammnummer: 7002, jahr: 2026, name: 'SAQ 2026', auftraggeberId: ag.id });
  alt = await rechnung(p.id, ag.id, altDatum);                 // seit 70 Tagen faellig
  neu = await rechnung(p.id, ag.id, addTage(heute(), -5));    // heute noch nicht faellig
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('mahnwesen-routes', () => {
  it('GET /debitoren/mahnvorschlag (Stichtag Default heute, 400 bei ungueltigem Datum)', async () => {
    const r = await app.inject({ method: 'GET', url: `/debitoren/mahnvorschlag?stichtag=${stichtag}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([expect.objectContaining({ rechnungId: alt, faelligAm: faellig, offen: 2025, letzteStufe: null, naechsteStufe: 1, gebuehr: 0, inkasso: false })]);
    const h = await app.inject({ method: 'GET', url: '/debitoren/mahnvorschlag' });
    expect(h.json().map((x: any) => x.rechnungId)).toEqual([alt]);
    expect((await app.inject({ method: 'GET', url: '/debitoren/mahnvorschlag?stichtag=10.02.2026' })).statusCode).toBe(400);
  });

  it('POST /debitoren/mahnlauf nur Admin, idempotent; GET /rechnung/:id/mahnungen', async () => {
    const body = { stichtag };
    expect((await app.inject({ method: 'POST', url: '/debitoren/mahnlauf', payload: body })).statusCode).toBe(403);
    const l = await app.inject({ method: 'POST', url: '/debitoren/mahnlauf', headers: admin, payload: body });
    expect(l.statusCode).toBe(200);
    expect(l.json().mahnungen).toEqual([expect.objectContaining({ rechnungId: alt, stufe: 1, datum: stichtag, fristBis: addTage(stichtag, 10), erstelltDurch: 'ml' })]);
    expect((await app.inject({ method: 'POST', url: '/debitoren/mahnlauf', headers: admin, payload: body })).json().mahnungen).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/debitoren/mahnlauf', headers: admin, payload: { stichtag: 'gestern' } })).statusCode).toBe(400);

    const m = await app.inject({ method: 'GET', url: `/rechnung/${alt}/mahnungen` });
    expect(m.json().map((x: any) => [x.stufe, x.bezeichnung])).toEqual([[1, 'Zahlungserinnerung']]);
    expect((await app.inject({ method: 'GET', url: `/rechnung/${neu}/mahnungen` })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/rechnung/00000000-0000-0000-0000-000000000000/mahnungen' })).statusCode).toBe(404);
  });
});

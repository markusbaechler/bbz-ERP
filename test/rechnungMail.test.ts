import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { buildApp } from '../src/server/app';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, getRechnung } from '../src/repos/rechnungRepo';
import { listOutbox } from '../src/repos/outboxRepo';
import { GraphMailAdapter, ProtokollMailAdapter } from '../src/integrations/mail';
import { standardHandler, verarbeiteOutbox } from '../src/integrations/worker';

/* Rechnung per E-Mail mit dem QR-Rechnungs-PDF als Anhang (FileMaker "Rechnung Mail"); Versand ueber die Outbox. */
const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };
let mitMail: string; let ohneMail: string; let projektId: string;

async function rechnung(auftraggeberId: string, fest = true): Promise<string> {
  const r = await createRechnung(pool, { projektId, auftraggeberId, datum: '2026-10-28', mwstModus: 'exkl' });
  await addPosition(pool, r.id, { beschreibung: 'Beratung', menge: 1, einzelpreis: 1000, mwstSatz: 8.1 });
  if (fest) await festschreiben(pool, r.id, 'ml');
  return r.id;
}

beforeAll(async () => {
  await resetDb(pool);
  mitMail = (await createAuftraggeber(pool, { name: 'Bank Mail', strasse: 'S 1', plz: '9000', ort: 'St. Gallen', email: 'kreditoren@bank.test' })).id;
  ohneMail = (await createAuftraggeber(pool, { name: 'Bank ohne Mail', strasse: 'S 2', plz: '9000', ort: 'St. Gallen' })).id;
  projektId = (await createProjekt(pool, { stammnummer: 7100, jahr: 2026, name: 'P', auftraggeberId: mitMail })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Rechnung per E-Mail', () => {
  it('stellt die Mail in die Outbox (nur IDs) und versendet sie mit dem PDF als Anhang', async () => {
    const id = await rechnung(mitMail);
    const r = await app.inject({ method: 'POST', url: `/rechnung/${id}/mail`, headers: admin, payload: {} });
    expect(r.statusCode).toBe(202);
    expect(r.json().an).toBe('kreditoren@bank.test');
    const eintrag = (await listOutbox(pool, { typ: 'mail' })).find((e) => e.aggregatId === id)!;
    // Outbox ohne Adresse: die des Debitors wird erst beim Versand gelesen (nur IDs in der Outbox)
    expect(eintrag.payload).toEqual({ vorlage: 'rechnung', an: null, daten: { rechnungId: id } });

    const mail = new ProtokollMailAdapter();
    await verarbeiteOutbox(pool, standardHandler(pool, { moodle: null, mail }));
    const nummer = (await getRechnung(pool, id)).nummer!;
    const m = mail.gesendet.find((x) => x.betreff.includes(nummer))!;
    expect(m.an).toBe('kreditoren@bank.test');
    expect(m.betreff).toBe(`Rechnung ${nummer}`);
    expect(m.text).toMatch(/CHF 1.081\.00/);   // Tausendertrennzeichen je nach ICU ' oder ’
    expect(m.anhaenge).toHaveLength(1);
    expect(m.anhaenge![0].name).toBe(`Rechnung_${nummer.replace(/[^\w.-]+/g, '_')}.pdf`);
    expect(m.anhaenge![0].inhalt.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('nimmt eine abweichende Adresse an', async () => {
    const id = await rechnung(mitMail);
    const r = await app.inject({ method: 'POST', url: `/rechnung/${id}/mail`, headers: admin, payload: { an: 'buchhaltung@bank.test' } });
    expect(r.json().an).toBe('buchhaltung@bank.test');
  });

  it('400 fuer Entwuerfe, ohne E-Mail-Adresse oder mit ungueltiger Adresse; 403 ohne Admin', async () => {
    const entwurf = await rechnung(mitMail, false);
    expect((await app.inject({ method: 'POST', url: `/rechnung/${entwurf}/mail`, headers: admin, payload: {} })).statusCode).toBe(400);
    const ohne = await rechnung(ohneMail);
    expect((await app.inject({ method: 'POST', url: `/rechnung/${ohne}/mail`, headers: admin, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/rechnung/${ohne}/mail`, headers: admin, payload: { an: 'keine-adresse' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/rechnung/${ohne}/mail`, payload: { an: 'x@bank.test' } })).statusCode).toBe(403);
  });

  it('Graph-Adapter sendet Anhaenge als fileAttachment (Base64)', async () => {
    let body: any;
    const f = (async (url: string, init: RequestInit) => {
      if (url.includes('/oauth2/')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      body = JSON.parse(String(init.body));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const g = new GraphMailAdapter({ tenantId: 't', clientId: 'c', clientSecret: 's', absender: 'info@bbz.test', fetch: f });
    await g.sende({ an: 'x@bank.test', betreff: 'B', text: 'T', anhaenge: [{ name: 'R.pdf', typ: 'application/pdf', inhalt: Buffer.from('%PDF-1') }] });
    expect(body.message.attachments).toEqual([{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'R.pdf', contentType: 'application/pdf', contentBytes: Buffer.from('%PDF-1').toString('base64') }]);
  });
});

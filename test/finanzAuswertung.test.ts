import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createKonto } from '../src/repos/kontoRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, stornieren } from '../src/repos/rechnungRepo';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import { createReferent } from '../src/repos/referentRepo';
import { createEinsatz } from '../src/repos/einsatzRepo';
import { kontenAuswertung } from '../src/repos/finanzAuswertungRepo';

/*
 * Ersetzt die FileMaker-Auswertungen "ER-Konti", "ER-nach Kunde" und "Aufw.-Konti" (Projekte) sowie den Druck aus
 * pos_fak_konti: Ertrag je Ertragskonto und je Auftraggeber, Aufwand (Honorare) je Aufwandkonto in einem Zeitraum.
 */
const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };
let a: string; let b: string;

async function rechnung(auftraggeberId: string, projektId: string, datum: string, positionen: { betrag: number; kontoId: string }[], fest = true): Promise<string> {
  const r = await createRechnung(pool, { projektId, auftraggeberId, datum, mwstModus: 'exkl' });
  for (const p of positionen) await addPosition(pool, r.id, { beschreibung: 'X', menge: 1, einzelpreis: p.betrag, mwstSatz: 8.1, kontoId: p.kontoId });
  if (fest) await festschreiben(pool, r.id, 'ml');
  return r.id;
}

beforeAll(async () => {
  await resetDb(pool);
  const k3000 = (await createKonto(pool, { nummer: '3000', bezeichnung: 'Unternehmensberatung', typ: 'Ertrag' })).id;
  const k3100 = (await createKonto(pool, { nummer: '3100', bezeichnung: 'Nachwuchs', typ: 'Ertrag' })).id;
  const k4000 = (await createKonto(pool, { nummer: '4000', bezeichnung: 'Honorare extern', typ: 'Aufwand' })).id;
  a = (await createAuftraggeber(pool, { name: 'Bank A', strasse: 'S 1', plz: '9000', ort: 'St. Gallen' })).id;
  b = (await createAuftraggeber(pool, { name: 'Bank B', strasse: 'S 2', plz: '6000', ort: 'Luzern' })).id;
  const pa = (await createProjekt(pool, { stammnummer: 7001, jahr: 2026, name: 'PA', auftraggeberId: a, aufwandkontoId: k4000 })).id;
  const pb = (await createProjekt(pool, { stammnummer: 7002, jahr: 2026, name: 'PB', auftraggeberId: b })).id;
  await rechnung(a, pa, '2026-03-10', [{ betrag: 1000, kontoId: k3000 }, { betrag: 500, kontoId: k3100 }]);
  await rechnung(b, pb, '2026-04-10', [{ betrag: 200, kontoId: k3000 }]);
  await rechnung(b, pb, '2026-04-11', [{ betrag: 999, kontoId: k3000 }], false);            // Entwurf zaehlt nicht
  await rechnung(a, pa, '2025-12-31', [{ betrag: 777, kontoId: k3000 }]);                   // ausserhalb
  await stornieren(pool, await rechnung(b, pb, '2026-05-01', [{ betrag: 300, kontoId: k3000 }]), 'Test', 'ml');   // + Gutschrift = 0
  await pool.query("update rechnung set datum='2026-06-15' where typ='gutschrift'");   // Storno-Datum fix statt current_date
  const ma = await createMitarbeitende(pool, { kuerzel: 'ml', nachname: 'Muster' });
  const ref = (await createReferent(pool, { typ: 'intern', mitarbeitendeId: ma.id, tagessatzChf: 2000 })).id;
  await createEinsatz(pool, { referentId: ref, projektId: pa, datum: '2026-06-01', honorarChf: 800, status: 'durchgefuehrt' });
  await createEinsatz(pool, { referentId: ref, projektId: pa, datum: '2026-06-02', honorarChf: 500, status: 'abgesagt' });
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Kontenauswertung (Ertrag/Aufwand je Konto)', () => {
  it('summiert den Nettoertrag festgeschriebener Rechnungen je Ertragskonto, Storno netto 0', async () => {
    const r = await kontenAuswertung(pool, { von: '2026-01-01', bis: '2026-12-31' });
    expect(r.ertrag).toEqual([
      { kontoNummer: '3000', bezeichnung: 'Unternehmensberatung', nettoChf: 1200 },
      { kontoNummer: '3100', bezeichnung: 'Nachwuchs', nettoChf: 500 },
    ]);
  });
  it('Storno ueber Perioden: die stornierte Rechnung zaehlt in ihrer Periode, die Gutschrift in der Storno-Periode', async () => {
    const mai = await kontenAuswertung(pool, { von: '2026-05-01', bis: '2026-05-01' });
    expect(mai.ertrag).toEqual([{ kontoNummer: '3000', bezeichnung: 'Unternehmensberatung', nettoChf: 300 }]);
  });
  it('schluesselt den Ertrag je Konto nach Auftraggeber auf (ER nach Kunde)', async () => {
    const r = await kontenAuswertung(pool, { von: '2026-01-01', bis: '2026-12-31' });
    expect(r.ertragJeAuftraggeber.map((x) => [x.kontoNummer, x.auftraggeber, x.nettoChf])).toEqual([
      ['3000', 'Bank A', 1000], ['3000', 'Bank B', 200], ['3100', 'Bank A', 500],
    ]);
  });
  it('summiert Honorare nicht abgesagter Einsaetze je Aufwandkonto des Projekts', async () => {
    const r = await kontenAuswertung(pool, { von: '2026-01-01', bis: '2026-12-31' });
    expect(r.aufwand).toEqual([{ kontoNummer: '4000', bezeichnung: 'Honorare extern', honorarChf: 800 }]);
  });
  it('Route GET /finanzen/konten-auswertung (Admin), 400 ohne gueltigen Zeitraum', async () => {
    const ok = await app.inject({ method: 'GET', url: '/finanzen/konten-auswertung?von=2026-01-01&bis=2026-12-31', headers: admin });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ertrag).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/finanzen/konten-auswertung?von=2026-12-31&bis=2026-01-01', headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/finanzen/konten-auswertung?von=2026-01-01&bis=2026-12-31' })).statusCode).toBe(403);
  });
});

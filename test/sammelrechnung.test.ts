import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { buildApp } from '../src/server/app';
import { bildungsbestand, angebot, ausgeschrieben } from './bildungFixtures';
import { createOrganisation } from '../src/repos/organisationRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { meldeAn, bestaetigeAnmeldung, getAnmeldung } from '../src/repos/anmeldungRepo';
import { sammelrechnungVorschau, verrechneSammelrechnung } from '../src/repos/sammelrechnungRepo';

/*
 * Sammelrechnung je Bank (FileMaker "Rechnung Halbjahresrechnung"): alle offenen Anmeldungen der Kurse, die im
 * Zeitraum beginnen, je Rechnungsempfaenger (und Projekt) auf eine Rechnung. Empfaenger = gesetzter Rechnungsempfaenger,
 * sonst der Debitor der Organisation der Person. Firmenkurse (Pauschale an den Auftraggeber) sind ausgenommen.
 */
const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin' };
let bankA: string; let bankB: string; let orgA: string;
const ids: Record<string, string> = {};

async function bestaetigt(durchfuehrungId: string, name: string, extra: { organisationId?: string; rechnungsempfaengerId?: string } = {}) {
  const r = await meldeAn(pool, durchfuehrungId, {
    kontakt: { email: `${name.toLowerCase()}@sammel.test`, vorname: name, nachname: 'Test', organisationId: extra.organisationId ?? null },
    rechnungsempfaengerId: extra.rechnungsempfaengerId ?? null,
  });
  await bestaetigeAnmeldung(pool, r.anmeldung.id);
  ids[name] = r.anmeldung.id;
}

beforeAll(async () => {
  await resetDb(pool);
  const base = await bildungsbestand(pool);
  orgA = (await createOrganisation(pool, { name: 'Bank A' })).id;
  bankA = (await createAuftraggeber(pool, { nummer: '40001', name: 'Bank A', strasse: 'S 1', plz: '9000', ort: 'St. Gallen' })).id;
  await pool.query('update auftraggeber set organisation_id=$2 where id=$1', [bankA, orgA]);
  bankB = (await createAuftraggeber(pool, { nummer: '40002', name: 'Bank B', strasse: 'S 2', plz: '6000', ort: 'Luzern' })).id;
  const ka = await angebot(pool, { preisChf: 1000, mwstSatz: 8.1, ertragskontoId: base.konto.id });
  const p = base.projekt.id;
  const d1 = (await ausgeschrieben(pool, ka.id, { projektId: p, startDatum: '2026-03-10', endDatum: '2026-03-10' })).id;
  const d2 = (await ausgeschrieben(pool, ka.id, { projektId: p, startDatum: '2026-05-20', endDatum: '2026-05-20' })).id;
  const d3 = (await ausgeschrieben(pool, ka.id, { projektId: p, startDatum: '2026-09-01', endDatum: '2026-09-01' })).id;
  const d4 = (await ausgeschrieben(pool, ka.id, { projektId: p, startDatum: '2026-04-01', endDatum: '2026-04-01', auftraggeberId: bankA })).id;
  await bestaetigt(d1, 'Anna', { organisationId: orgA });
  await bestaetigt(d1, 'Beat', { rechnungsempfaengerId: bankB });
  await bestaetigt(d2, 'Cem', { organisationId: orgA });
  await bestaetigt(d2, 'Dora');                                              // ohne Empfaenger
  await bestaetigt(d2, 'Emil', { organisationId: orgA });
  await pool.query("update anmeldung set status='storniert', stornogebuehr_chf=200 where id=$1", [ids.Emil]);
  await bestaetigt(d3, 'Fritz', { organisationId: orgA });                 // ausserhalb des Zeitraums
  await bestaetigt(d4, 'Gina', { organisationId: orgA });                  // Firmenkurs
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

const H1 = { von: '2026-01-01', bis: '2026-06-30' };

describe('Sammelrechnung je Bank', () => {
  it('Vorschau: Anmeldungen und Betrag je Empfaenger, Anmeldungen ohne Empfaenger separat', async () => {
    const v = await sammelrechnungVorschau(pool, H1);
    expect(v.empfaenger.map((e) => [e.name, e.anmeldungen, e.betragChf])).toEqual([['Bank A', 3, 2200], ['Bank B', 1, 1000]]);
    expect(v.ohneEmpfaenger.map((o) => o.name)).toEqual(['Dora Test']);
  });

  it('erstellt je Empfaenger eine Rechnung ueber alle Kurse des Zeitraums', async () => {
    const e = await verrechneSammelrechnung(pool, { ...H1, datum: '2026-07-01' }, 'ml');
    expect(e.rechnungen.map((r) => [r.auftraggeberId, r.status, r.positionen.length])).toEqual([[bankA, 'offen_prov', 3], [bankB, 'offen_prov', 1]]);
    const a = e.rechnungen[0];
    expect(a.betreff).toBe('Sammelrechnung Kurse 01.01.2026 – 30.06.2026');
    expect(a.positionen.map((p) => p.beschreibung)).toEqual([
      expect.stringMatching(/^Kurs .* – Anna Test$/),
      expect.stringMatching(/^Kurs .* – Cem Test$/),
      expect.stringMatching(/^Annullationskosten Kurs .* – Emil Test$/),
    ]);
    expect(a.positionen.map((p) => p.einzelpreis)).toEqual([1000, 1000, 200]);
    expect(e.ohneEmpfaenger.map((o) => o.name)).toEqual(['Dora Test']);
    expect((await getAnmeldung(pool, ids.Anna)).rechnungId).toBe(a.id);
    expect((await getAnmeldung(pool, ids.Fritz)).rechnungId).toBeNull();
    expect((await getAnmeldung(pool, ids.Gina)).rechnungId).toBeNull();
  });

  it('verrechnet nichts doppelt', async () => {
    const e = await verrechneSammelrechnung(pool, { ...H1, datum: '2026-07-01' }, 'ml');
    expect(e.rechnungen).toHaveLength(0);
  });

  it('kann auf einen Empfaenger eingeschraenkt werden', async () => {
    const v = await sammelrechnungVorschau(pool, { von: '2026-01-01', bis: '2026-12-31' });
    expect(v.empfaenger.map((x) => x.name)).toEqual(['Bank A']);   // nur noch Fritz (September)
    const e = await verrechneSammelrechnung(pool, { von: '2026-01-01', bis: '2026-12-31', datum: '2026-12-31', auftraggeberId: bankB }, 'ml');
    expect(e.rechnungen).toHaveLength(0);
  });

  it('Routen nur fuer Admin, 400 bei ungueltigem Zeitraum', async () => {
    expect((await app.inject({ method: 'GET', url: '/verrechnung/sammelrechnung?von=2026-01-01&bis=2026-12-31' })).statusCode).toBe(403);
    const v = await app.inject({ method: 'GET', url: '/verrechnung/sammelrechnung?von=2026-01-01&bis=2026-12-31', headers: admin });
    expect(v.statusCode).toBe(200);
    expect(v.json().empfaenger).toHaveLength(1);
    const falsch = await app.inject({ method: 'POST', url: '/verrechnung/sammelrechnung', headers: admin, payload: { von: '2026-12-31', bis: '2026-01-01', datum: '2026-12-31' } });
    expect(falsch.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/verrechnung/sammelrechnung', headers: admin, payload: { von: '2026-01-01', bis: '2026-12-31', datum: '2026-12-31' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().rechnungen).toHaveLength(1);
  });
});

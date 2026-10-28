import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { bildungsbestand, angebot, ausgeschrieben } from './bildungFixtures';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { meldeAn, bestaetigeAnmeldung, storniereAnmeldung, getAnmeldung, setzeTeilnahme } from '../src/repos/anmeldungRepo';
import { verrechneDurchfuehrung, OhneRechnungsempfaengerError } from '../src/repos/bildungVerrechnungRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof bildungsbestand>>;
let zuger: { id: string };
beforeAll(async () => {
  await resetDb(pool);
  base = await bildungsbestand(pool);
  zuger = await createAuftraggeber(pool, { name: 'Zuger Kantonalbank', strasse: 'Bahnhofstrasse 1', plz: '6300', ort: 'Zug' });
});
afterAll(async () => { await closePool(); });

const anzahlRechnungen = async () => Number((await pool.query('select count(*) from rechnung')).rows[0].count);

describe('verrechnen (Anmeldungen -> Rechnungen)', () => {
  it('je Rechnungsempfaenger eine Rechnung, Position je Teilnehmer:in bzw. Annullationskosten', async () => {
    const a = await angebot(pool, { code: 'BEF', titel: 'Eigenheimfinanzierung', preisChf: 1200, mwstSatz: 0, ertragskontoId: base.konto.id });
    const d = await ausgeschrieben(pool, a.id, { projektId: base.projekt.id, kapazitaet: 4 });   // Beginn 2026-12-01
    const urner = base.auftraggeber.id;
    const an = async (vorname: string, nachname: string, empf: string | null, extra: Record<string, unknown> = {}) =>
      (await meldeAn(pool, d.id, { kontakt: { email: `${vorname}@v.test`, vorname, nachname }, rechnungsempfaengerId: empf, ...extra })).anmeldung;
    const anna = await an('Anna', 'Amrein', urner, { rechnungsreferenz: 'KST 4711' });
    const bruno = await an('Bruno', 'Zehnder', urner);
    const carla = await an('Carla', 'Camenzind', zuger.id);
    const dario = await an('Dario', 'Dettling', zuger.id);
    const emil = await an('Emil', 'Egli', urner);                // Warteliste, ohne Platz
    await bestaetigeAnmeldung(pool, anna.id);
    await setzeTeilnahme(pool, anna.id, 'teilgenommen');
    await storniereAnmeldung(pool, dario.id, { grund: 'Krankheit', datum: '2026-11-20' });   // 100 % -> Emil rueckt nach
    await storniereAnmeldung(pool, emil.id, { grund: 'kein Bedarf', datum: '2026-10-01' });  // gebuehrenfrei
    const ohneEmpfaengerAberGratis = await an('Fritz', 'Frei', null);
    await storniereAnmeldung(pool, ohneEmpfaengerAberGratis.id, { grund: 'x', datum: '2026-10-01' });

    const res = await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05' }, 'ml');
    expect(res.rechnungen).toHaveLength(2);
    const [r1, r2] = res.rechnungen;
    expect(r1).toMatchObject({ auftraggeberId: urner, projektId: base.projekt.id, datum: '2026-12-05', status: 'offen_prov', totalNetto: 2400 });
    expect(r1.betreff).toBe(`Kurs Eigenheimfinanzierung ${d.code}`);
    expect(r1.positionen.map((p) => p.beschreibung)).toEqual([
      `Kurs Eigenheimfinanzierung ${d.code} – Anna Amrein (Ref. KST 4711)`,
      `Kurs Eigenheimfinanzierung ${d.code} – Bruno Zehnder`,
    ]);
    expect(r1.positionen[0]).toMatchObject({ menge: 1, einheit: 'Pauschal', einzelpreis: 1200, mwstSatz: 0, kontoId: base.konto.id });
    expect(r2).toMatchObject({ auftraggeberId: zuger.id, totalNetto: 2400 });
    expect(r2.positionen.map((p) => p.beschreibung)).toEqual([
      `Kurs Eigenheimfinanzierung ${d.code} – Carla Camenzind`,
      `Annullationskosten Kurs Eigenheimfinanzierung ${d.code} – Dario Dettling`,
    ]);
    expect(res.verrechneteAnmeldungen.sort()).toEqual([anna.id, bruno.id, carla.id, dario.id].sort());
    expect((await getAnmeldung(pool, anna.id)).rechnungId).toBe(r1.id);
    expect((await getAnmeldung(pool, dario.id)).rechnungId).toBe(r2.id);
    expect((await getAnmeldung(pool, emil.id)).rechnungId).toBeNull();
    expect((await listAudit(pool, 'durchfuehrung', d.id)).at(-1)).toMatchObject({ benutzer: 'ml', aktion: 'verrechnung' });

    // erneuter Lauf: bereits verrechnete werden uebersprungen
    const vorher = await anzahlRechnungen();
    expect(await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-06' })).toEqual({ rechnungen: [], verrechneteAnmeldungen: [] });
    expect(await anzahlRechnungen()).toBe(vorher);
    // Nachmeldung wird im naechsten Lauf separat verrechnet
    const nach = await an('Gina', 'Gisler', zuger.id);
    const res2 = await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-07' });
    expect(res2.rechnungen.map((r) => r.positionen.length)).toEqual([1]);
    expect(res2.verrechneteAnmeldungen).toEqual([nach.id]);
  });
  it('400 mit Liste der Anmeldungen ohne Rechnungsempfaenger, nichts wird angelegt', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { projektId: base.projekt.id });
    await meldeAn(pool, d.id, { kontakt: { email: 'mit@v.test', nachname: 'Mit' }, rechnungsempfaengerId: zuger.id });
    const ohne = (await meldeAn(pool, d.id, { kontakt: { email: 'ohne@v.test', vorname: 'Otto', nachname: 'Ohne' } })).anmeldung;
    const vorher = await anzahlRechnungen();
    const err = await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05' }).catch((e) => e);
    expect(err).toBeInstanceOf(OhneRechnungsempfaengerError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.anmeldungIds).toEqual([ohne.id]);
    expect(err.message).toContain('Otto Ohne');
    expect(await anzahlRechnungen()).toBe(vorher);
  });
  it('ist atomar: Fehler in der zweiten Rechnung verwirft auch die erste', async () => {
    const d = await ausgeschrieben(pool, (await angebot(pool)).id, { projektId: base.projekt.id });
    const a1 = (await meldeAn(pool, d.id, { kontakt: { email: 'ok@v.test', nachname: 'Aaa' }, rechnungsempfaengerId: base.auftraggeber.id })).anmeldung;
    await meldeAn(pool, d.id, { kontakt: { email: 'boom@v.test', nachname: 'Boom' }, rechnungsempfaengerId: zuger.id });
    await pool.query(`create function test_boom() returns trigger language plpgsql as $$
      begin if new.beschreibung like '%Boom%' then raise exception 'Testfehler'; end if; return new; end $$`);
    await pool.query('create trigger test_boom before insert on rechnungsposition for each row execute function test_boom()');
    try {
      const vorher = await anzahlRechnungen();
      await expect(verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05' })).rejects.toThrow('Testfehler');
      expect(await anzahlRechnungen()).toBe(vorher);
      expect((await getAnmeldung(pool, a1.id)).rechnungId).toBeNull();
    } finally {
      await pool.query('drop trigger test_boom on rechnungsposition; drop function test_boom()');
    }
  });
  it('Pauschale (Firmenkurs): eine Position an den Auftraggeber der Durchfuehrung, deckt alle Anmeldungen', async () => {
    const a = await angebot(pool, { titel: 'Tailor-made Kreditprozess', mwstSatz: 8.1, ertragskontoId: base.konto.id });
    const d = await ausgeschrieben(pool, a.id, { projektId: base.projekt.id, oeffentlich: false, auftraggeberId: zuger.id });
    const t1 = (await meldeAn(pool, d.id, { kontakt: { email: 'p1@v.test', nachname: 'Pa' } })).anmeldung;
    const t2 = (await meldeAn(pool, d.id, { kontakt: { email: 'p2@v.test', nachname: 'Pb' } })).anmeldung;
    const res = await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05', pauschalChf: 9000 });
    expect(res.rechnungen).toHaveLength(1);
    expect(res.rechnungen[0]).toMatchObject({ auftraggeberId: zuger.id, totalNetto: 9000, totalMwst: 729, totalBrutto: 9729 });
    expect(res.rechnungen[0].positionen).toEqual([expect.objectContaining({
      beschreibung: `Pauschale Kurs Tailor-made Kreditprozess ${d.code}`, menge: 1, einheit: 'Pauschal', einzelpreis: 9000, mwstSatz: 8.1, kontoId: base.konto.id,
    })]);
    expect(res.verrechneteAnmeldungen.sort()).toEqual([t1.id, t2.id].sort());
    await expect(verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-06', pauschalChf: 9000 })).rejects.toBeInstanceOf(ConflictError);
    expect((await verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-06' })).rechnungen).toEqual([]);
  });
  it('validiert Projekt, Auftraggeber, Datum und Pauschale', async () => {
    const a = await angebot(pool);
    const ohneProjekt = await ausgeschrieben(pool, a.id);
    await expect(verrechneDurchfuehrung(pool, ohneProjekt.id, { datum: '2026-12-05' })).rejects.toBeInstanceOf(ValidationError);
    const d = await ausgeschrieben(pool, a.id, { projektId: base.projekt.id });
    await expect(verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05', pauschalChf: 500 })).rejects.toBeInstanceOf(ValidationError);
    await expect(verrechneDurchfuehrung(pool, d.id, { datum: '5.12.2026' })).rejects.toBeInstanceOf(ValidationError);
    await expect(verrechneDurchfuehrung(pool, d.id, { datum: '2026-12-05', pauschalChf: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(verrechneDurchfuehrung(pool, '00000000-0000-0000-0000-000000000000', { datum: '2026-12-05' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import {
  createSaqFall, getSaqFall, listSaqFaelle, updateSaqFall, setzeArbeitgeberbestaetigung, planePruefung, updatePruefung,
  erfasseResultat, stelleZertifikatAus, saqKennzahlen, kubaExport,
} from '../src/repos/saqRepo';
import { createReferent } from '../src/repos/referentRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { listOutbox } from '../src/repos/outboxRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
let bankId: string; let experte1: string; let experte2: string;

async function pruefungstermin(kapazitaet: number, datum: string, ort = 'Zuerich'): Promise<string> {
  const ka = await pool.query(
    `insert into kursangebot(code,titel,bereich) values ('SAQ-PRUEF','SAQ-Pruefung','Zertifizierung')
     on conflict (code) do update set titel=excluded.titel returning id`);
  const d = await pool.query(
    `insert into durchfuehrung(kursangebot_id,start_datum,end_datum,ort,kapazitaet) values ($1,$2,$2,$3,$4) returning id`,
    [ka.rows[0].id, datum, ort, kapazitaet]);
  return d.rows[0].id;
}

const neuerFall = (email: string, extra: Record<string, unknown> = {}) => createSaqFall(pool, {
  kontakt: { email, anrede: 'Frau', vorname: 'Test', nachname: `Person-${email.split('@')[0]}`, geburtsdatum: '1990-01-01', funktion: 'Kundenberaterin' },
  organisationId: bankId, profil: 'PK', ...extra,
});

beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  bankId = (await pool.query(`insert into organisation(name) values ('Testbank AG') returning id`)).rows[0].id;
  experte1 = (await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id })).id;
  const k = await createKontakt(pool, { vorname: 'Erika', nachname: 'Expertin', email: 'expertin@extern.test' });
  experte2 = (await createReferent(pool, { typ: 'extern', kontaktId: k.id })).id;
});
afterAll(async () => { await closePool(); });

describe('saqRepo: Anmeldung (createSaqFall)', () => {
  it('legt Kontakt per E-Mail an, normalisiert Codes und publiziert saq.angemeldet', async () => {
    const f = await createSaqFall(pool, {
      kontakt: { email: 'Anna.Muster@testbank.test', anrede: 'Frau', vorname: 'Anna', nachname: 'Muster', geburtsdatum: '1991-02-03', funktion: 'Kundenberaterin Privatkunden' },
      organisationId: bankId, rechnungsempfaengerId: base.auftraggeber.id, profil: 'affluent', sprache: 'fr',
      einwilligungRechnungBank: true, digitaleHilfsmittel: true,
    });
    expect(f.profil).toBe('AFFL');
    expect(f.sprache).toBe('FR');
    expect(f.status).toBe('angemeldet');
    expect(f.rolle).toBe('Kundenberaterin Privatkunden');
    expect(f.einwilligungRechnungBank).toBe(true);
    const detail = await getSaqFall(pool, f.id);
    expect(detail.kontakt.email).toBe('anna.muster@testbank.test');
    expect(detail.organisationName).toBe('Testbank AG');
    const events = (await listOutbox(pool, { typ: 'webhook' })).filter((e) => e.payload.ereignis === 'saq.angemeldet');
    expect(events.map((e) => e.payload.daten.fallId)).toContain(f.id);
  });
  it('verwendet bestehende Kontakte wieder und ergaenzt das Geburtsdatum', async () => {
    const k = await createKontakt(pool, { nachname: 'Bestand', email: 'bestand@testbank.test' });
    const f = await createSaqFall(pool, { kontakt: { email: 'BESTAND@testbank.test', nachname: 'Anders', geburtsdatum: '1985-05-05' }, profil: 'IK' });
    expect(f.kontaktId).toBe(k.id);
    const d = await getSaqFall(pool, f.id);
    expect(d.kontakt.nachname).toBe('Bestand');
    expect((await pool.query('select geburtsdatum from kontakt where id=$1', [k.id])).rows[0].geburtsdatum).toBe('1985-05-05');
    expect((await createSaqFall(pool, { kontaktId: k.id, profil: 'KMU' })).kontaktId).toBe(k.id);
  });
  it('validiert Whitelists und Pflichtangaben', async () => {
    await expect(createSaqFall(pool, { kontakt: { email: 'x@y.test', nachname: 'X' }, profil: 'XY' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSaqFall(pool, { profil: 'PK' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSaqFall(pool, { kontakt: { nachname: 'Ohne' } as any, profil: 'PK' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSaqFall(pool, { kontakt: { email: 'x@y.test', nachname: 'X' }, profil: 'PK', variante: 'passerelle' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSaqFall(pool, { kontakt: { email: 'x@y.test', nachname: 'X' }, profil: 'PK', umfang: 'alles' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSaqFall(pool, { kontaktId: '00000000-0000-0000-0000-000000000000', profil: 'PK' })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('rollt den neuen Kontakt zurueck, wenn der Fall nicht angelegt werden kann', async () => {
    await expect(createSaqFall(pool, {
      kontakt: { email: 'rollback@testbank.test', nachname: 'Rollback' }, profil: 'PK', rechnungsempfaengerId: '00000000-0000-0000-0000-000000000000',
    })).rejects.toMatchObject({ code: '23503' });
    expect((await pool.query(`select 1 from kontakt where email='rollback@testbank.test'`)).rowCount).toBe(0);
  });
});

describe('saqRepo: Pruefungsablauf PK (Runs, Status, Zulassung, Zertifikat)', () => {
  it('fuehrt einen Fall von der Anmeldung bis zum Zertifikat', async () => {
    const f = await neuerFall('ablauf@testbank.test');
    const we1 = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-02-10', ort: 'Zuerich' });
    expect(we1.run).toBe(1);
    expect((await getSaqFall(pool, f.id)).status).toBe('in_pruefung');

    const r1 = await erfasseResultat(pool, we1.id, { resultatProzent: 65, score: 39 });
    expect(r1.pruefung.bestanden).toBe(false);
    expect(r1.fall.status).toBe('in_pruefung');
    await expect(erfasseResultat(pool, we1.id, { resultatProzent: 80 })).rejects.toBeInstanceOf(ConflictError);

    const we1r2 = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-03-10', remote: true });
    expect(we1r2.run).toBe(2);
    await expect(planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-03-20' })).rejects.toBeInstanceOf(ConflictError);
    expect((await erfasseResultat(pool, we1r2.id, { bestanden: true })).fall.status).toBe('schriftlich_bestanden');

    // muendlich erst mit Arbeitgeberbestaetigung
    await expect(planePruefung(pool, f.id, { art: 'muendlich', teil: 1, datum: '2026-05-05' })).rejects.toBeInstanceOf(ConflictError);
    expect((await getSaqFall(pool, f.id)).muendlichZulassung).toEqual({ zugelassen: false, gruende: ['Arbeitgeberbestaetigung fehlt'] });
    await setzeArbeitgeberbestaetigung(pool, f.id, '2026-04-01');
    await expect(planePruefung(pool, f.id, { art: 'muendlich', teil: 1, datum: '2026-05-05', experte1Id: experte1, experte2Id: experte1 }))
      .rejects.toBeInstanceOf(ValidationError);
    const oe1 = await planePruefung(pool, f.id, { art: 'muendlich', teil: 1, datum: '2026-05-05', ort: 'St. Gallen', experte1Id: experte1, experte2Id: experte2 });
    expect(oe1.experte2Id).toBe(experte2);

    await expect(stelleZertifikatAus(pool, f.id, { zertifikatNr: 'SAQ-T-1', ausgestelltAm: '2026-06-01' })).rejects.toBeInstanceOf(ConflictError);
    expect((await erfasseResultat(pool, oe1.id, { resultatProzent: 70 })).fall.status).toBe('bestanden');

    await expect(stelleZertifikatAus(pool, f.id, { zertifikatNr: '  ', ausgestelltAm: '2026-06-01' })).rejects.toBeInstanceOf(ValidationError);
    const z = await stelleZertifikatAus(pool, f.id, { zertifikatNr: 'SAQ-T-1', ausgestelltAm: '2026-06-01' }, 'ml');
    expect(z.fall.status).toBe('zertifiziert');
    expect(z.zertifizierung).toMatchObject({ typ: 'SAQ Kundenberater Bank', profil: 'PK', sprache: 'DE', zertifikatNr: 'SAQ-T-1', ausgestelltAm: '2026-06-01', gueltigBis: '2029-06-01' });
    await expect(stelleZertifikatAus(pool, f.id, { zertifikatNr: 'SAQ-T-2', ausgestelltAm: '2026-06-02' })).rejects.toBeInstanceOf(ConflictError);

    const d = await getSaqFall(pool, f.id);
    expect(d.zertifizierung?.id).toBe(z.zertifizierung.id);
    expect(d.pruefungen.map((p) => `${p.art}${p.teil}/${p.run}:${p.bestanden}`)).toEqual(['schriftlich1/1:false', 'schriftlich1/2:true', 'muendlich1/1:true']);
    expect(d.teile.map((t) => t.status)).toEqual(['bestanden', 'bestanden']);
    const audit = (await listAudit(pool, 'saq_fall', f.id)).map((a) => a.aktion);
    expect(audit).toContain('saq.zertifikat');
    expect(audit).toContain('saq.status');
  });
  it('nicht bestandener RUN3 schliesst den Fall als nicht_bestanden', async () => {
    const f = await neuerFall('dreimal@testbank.test');
    for (const datum of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      const p = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum });
      await erfasseResultat(pool, p.id, { resultatProzent: 50 });
    }
    expect((await getSaqFall(pool, f.id)).status).toBe('nicht_bestanden');
    await expect(planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-04-10' })).rejects.toBeInstanceOf(ConflictError);
  });
  it('akzeptiert widerspruechliche Resultate mit Warnung', async () => {
    const f = await neuerFall('widerspruch@testbank.test');
    const p = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-02-10' });
    const r = await erfasseResultat(pool, p.id, { resultatProzent: 60, bestanden: true });
    expect(r.pruefung.bestanden).toBe(true);
    expect(r.warnungen).toHaveLength(1);
    expect(r.fall.status).toBe('schriftlich_bestanden');
  });
});

describe('saqRepo: Pruefungstermine (Kapazitaet, Umbuchung)', () => {
  it('uebernimmt Datum/Ort der Durchfuehrung und meldet 409, wenn der Termin voll ist', async () => {
    const termin = await pruefungstermin(1, '2026-11-20', 'Lausanne');
    const a = await neuerFall('termin-a@testbank.test');
    const b = await neuerFall('termin-b@testbank.test');
    const p = await planePruefung(pool, a.id, { art: 'schriftlich', teil: 1, durchfuehrungId: termin });
    expect(p).toMatchObject({ datum: '2026-11-20', ort: 'Lausanne', durchfuehrungId: termin });
    await expect(planePruefung(pool, b.id, { art: 'schriftlich', teil: 1, durchfuehrungId: termin })).rejects.toBeInstanceOf(ConflictError);
    // Umbuchung auf einen freien Termin, Experten nur muendlich
    const frei = await pruefungstermin(5, '2026-12-04');
    const um = await updatePruefung(pool, p.id, { durchfuehrungId: frei, datum: '2026-12-04' });
    expect(um.durchfuehrungId).toBe(frei);
    expect((await planePruefung(pool, b.id, { art: 'schriftlich', teil: 1, durchfuehrungId: termin })).durchfuehrungId).toBe(termin);
    await expect(updatePruefung(pool, p.id, { experte1Id: experte1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePruefung(pool, p.id, { durchfuehrungId: termin })).rejects.toBeInstanceOf(ConflictError);
  });
  it('Teile je Profil: AFFL braucht WE1+WE2, WE3 ist nicht vorgesehen', async () => {
    const f = await neuerFall('affl@testbank.test', { profil: 'AFFL' });
    await expect(planePruefung(pool, f.id, { art: 'schriftlich', teil: 3, datum: '2026-02-10' })).rejects.toBeInstanceOf(ValidationError);
    const w1 = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-02-10' });
    const w2 = await planePruefung(pool, f.id, { art: 'schriftlich', teil: 2, datum: '2026-02-10' });
    expect((await erfasseResultat(pool, w1.id, { resultatProzent: 80 })).fall.status).toBe('in_pruefung');
    expect((await erfasseResultat(pool, w2.id, { resultatProzent: 75 })).fall.status).toBe('schriftlich_bestanden');
  });
});

describe('saqRepo: Passerelle, Statuswechsel, Liste', () => {
  it('erkennt die Passerelle (bestandenes Vorgaengerprofil derselben Person)', async () => {
    const pk = await neuerFall('passerelle@testbank.test', { umfang: 'muendlich', arbeitgeberbestaetigungAm: '2026-01-05' });
    const ik = await createSaqFall(pool, { kontaktId: pk.kontaktId, profil: 'IK', variante: 'passerelle' });
    let d = await getSaqFall(pool, ik.id);
    expect(d.passerelleMoeglich).toBe(false);
    expect(d.hinweise.join(' ')).toMatch(/Passerelle/);
    const oe = await planePruefung(pool, pk.id, { art: 'muendlich', teil: 1, datum: '2026-02-10' });
    expect((await erfasseResultat(pool, oe.id, { resultatProzent: 90 })).fall.status).toBe('bestanden');
    d = await getSaqFall(pool, ik.id);
    expect(d.passerelleMoeglich).toBe(true);
    expect(d.hinweise).toEqual([]);
    expect(d.pflichtteile.schriftlich).toEqual([1]);
  });
  it('PATCH: Stammfelder, manueller Abbruch mit Audit, danach keine Pruefung mehr', async () => {
    const f = await neuerFall('patch@testbank.test');
    const p = await updateSaqFall(pool, f.id, { kennzeichnung: 'VSS', bemerkung: 'Rueckfrage HR', sprache: 'it' }, 'ml');
    expect(p).toMatchObject({ kennzeichnung: 'VSS', bemerkung: 'Rueckfrage HR', sprache: 'IT' });
    await expect(updateSaqFall(pool, f.id, { status: 'bestanden' })).rejects.toBeInstanceOf(ConflictError);
    expect((await updateSaqFall(pool, f.id, { status: 'abgebrochen' }, 'ml')).status).toBe('abgebrochen');
    expect((await listAudit(pool, 'saq_fall', f.id)).find((a) => a.aktion === 'saq.status')?.details).toEqual({ von: 'angemeldet', nach: 'abgebrochen' });
    await expect(planePruefung(pool, f.id, { art: 'schriftlich', teil: 1, datum: '2026-02-10' })).rejects.toBeInstanceOf(ConflictError);
  });
  it('PATCH Profil/Umfang nur, wenn die bestehenden Runs dazu passen', async () => {
    const f = await neuerFall('wechsel@testbank.test', { profil: 'KMU' });
    await planePruefung(pool, f.id, { art: 'schriftlich', teil: 3, datum: '2026-02-10' });
    await expect(updateSaqFall(pool, f.id, { profil: 'PK' })).rejects.toBeInstanceOf(ConflictError);
    expect((await updateSaqFall(pool, f.id, { profil: 'CCoB' })).profil).toBe('CCoB');
  });
  it('filtert nach Status, Profil, Bank und Suche und markiert passive Vorgaenge', async () => {
    const alt = await neuerFall('passiv@testbank.test', { profil: 'CWMA' });
    const p = await planePruefung(pool, alt.id, { art: 'schriftlich', teil: 1, datum: '2025-01-10' });
    await erfasseResultat(pool, p.id, { resultatProzent: 40 });
    const liste = await listSaqFaelle(pool, { profil: 'cwma', stichtag: '2026-10-28' });
    expect(liste.map((x) => x.id)).toEqual([alt.id]);
    expect(liste[0]).toMatchObject({ passiv: true, letztePruefung: '2025-01-10', organisationName: 'Testbank AG' });
    expect((await listSaqFaelle(pool, { passiv: true, stichtag: '2026-10-28' })).map((x) => x.id)).toEqual([alt.id]);
    await planePruefung(pool, alt.id, { art: 'schriftlich', teil: 1, datum: '2026-11-30' });
    expect((await listSaqFaelle(pool, { profil: 'CWMA', stichtag: '2026-10-28' }))[0].passiv).toBe(false);

    expect((await listSaqFaelle(pool, { suche: 'ANNA' })).map((x) => x.kontakt.vorname)).toEqual(['Anna']);
    expect((await listSaqFaelle(pool, { status: 'zertifiziert' })).every((x) => x.status === 'zertifiziert')).toBe(true);
    expect((await listSaqFaelle(pool, { organisationId: bankId })).length).toBeGreaterThan(5);
    await expect(listSaqFaelle(pool, { status: 'kaputt' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('saqRepo: Kennzahlen und KUBA-Export', () => {
  it('rechnet Kennzahlen je Jahr mit Nennern', async () => {
    const k = await saqKennzahlen(pool, 2026);
    expect(k.total.vorgaenge).toBeGreaterThanOrEqual(5);
    const pk = k.jeProfil.find((z) => z.profil === 'PK')!;
    expect(pk.abgeschlossen).toBe(3);          // zertifiziert + nicht_bestanden + bestanden (Passerelle-Vorgaenger)
    expect(pk.bestanden).toBe(2);
    expect(pk.quoteInsgesamt).toEqual({ quote: 66.7, zaehler: 2, n: 3 });
    expect(pk.erstversuchMuendlich).toEqual({ quote: 100, zaehler: 2, n: 2 });
    const cwma = (await saqKennzahlen(pool, 2025)).jeProfil.find((z) => z.profil === 'CWMA')!;
    expect(cwma.vorgaenge).toBe(1);
  });
  it('exportiert Vorgaenge im bbz-saq-Feldformat', async () => {
    const zeilen = await kubaExport(pool);
    const z = zeilen.find((x) => x.lastName === 'Person-ablauf')!;
    expect(z).toMatchObject({
      firstName: 'Test', role: 'Kundenberaterin', employer: 'Testbank AG', profil: 'PK', sprache: 'DE', birthDate: '1990-01-01',
      certNumber: 'SAQ-T-1', certStart: '2026-06-01', certEnd: '2029-06-01', weAllPassed: 'yes', oeAllPassed: 'yes',
      'we1.passed': 'yes', 'we1.run1.passed': 'no', 'we1.run1.result': 0.65, 'we1.run1.score': 39, 'we1.run1.location': 'Zuerich',
      'we1.run2.passed': 'yes', 'we1.run2.location': 'Remote', 'oe1.run1.result': 0.7, 'oe1.run1.expert1': 'Markus Muster',
      'oe1.run1.expert2': 'Erika Expertin', 'oe2.passed': '',
    });
  });
});

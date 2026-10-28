import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { ladeOrganisation360, ladeKontakt360, ladeWiedervorlagen, ladeCrmDashboard } from '../src/repos/crmAuswertungRepo';
import { createOrganisation, verknuepfeAuftraggeber, updateOrganisation } from '../src/repos/organisationRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { createAktivitaet } from '../src/repos/aktivitaetRepo';
import { createVerkaufschance } from '../src/repos/verkaufschanceRepo';
import { createAnfrage } from '../src/repos/anfrageRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import { NotFoundError } from '../src/domain/errors';

const pool = getPool();
const stichtag = '2026-10-28'; // Mittwoch
let base: Awaited<ReturnType<typeof grundbestand>>;
let org: { id: string }; let kontakt: { id: string }; let andereOrg: { id: string };
let ph: { id: string };

async function aufgabe(f: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(f);
  const r = await pool.query(`insert into aufgabe(${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(f));
  return r.rows[0].id;
}
async function rechnung(projektId: string, auftraggeberId: string, datum: string, status: string, netto: number) {
  await pool.query(`insert into rechnung(projekt_id,auftraggeber_id,datum,status,total_netto) values ($1,$2,$3,$4,$5)`, [projektId, auftraggeberId, datum, status, netto]);
}

beforeAll(async () => {
  await resetDb(pool); base = await grundbestand(pool);
  ph = await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Huber' });
  org = await createOrganisation(pool, { name: 'St.Galler KB', klassifizierung: 'A', strasse: 'St. Leonhardstrasse 25', plz: '9001', ort: 'St. Gallen' });
  andereOrg = await createOrganisation(pool, { name: 'Andere Bank', klassifizierung: 'A' });
  kontakt = await createKontakt(pool, { nachname: 'Frei', vorname: 'Nina', organisationId: org.id, email: 'nina.frei@sgkb.test' });
});
afterAll(async () => { await closePool(); });

describe('Organisation 360°', () => {
  it('buendelt Kontakte, letzte 20 Aktivitaeten, offene Aufgaben, Chancen, Projekte, Auftraggeber und Umsatz je Jahr', async () => {
    await createKontakt(pool, { nachname: 'Andres', organisationId: org.id });
    for (let i = 1; i <= 22; i++) {
      await createAktivitaet(pool, { typ: 'telefon', betreff: `Call ${i}`, kontaktId: kontakt.id, datum: `2026-09-${String(i).padStart(2, '0')}T08:00:00Z` });
    }
    const vc = await createVerkaufschance(pool, { titel: 'Zertifizierungslehrgang', organisationId: org.id, wertChf: 50000 });
    await aufgabe({ titel: 'Offerte nachfassen', verkaufschance_id: vc.id, faellig_am: '2026-10-30' });
    await aufgabe({ titel: 'Kontakt anrufen', kontakt_id: kontakt.id, faellig_am: '2026-10-20' });
    await aufgabe({ titel: 'Erledigt', organisation_id: org.id, status: 'erledigt' });
    await aufgabe({ titel: 'Fremd', organisation_id: andereOrg.id });

    const ag = await verknuepfeAuftraggeber(pool, org.id, { nummer: '50001' });
    const p25 = await createProjekt(pool, { stammnummer: 8100, jahr: 2025, name: 'SGKB 2025', auftraggeberId: ag.id });
    const p26 = await createProjekt(pool, { stammnummer: 8100, jahr: 2026, name: 'SGKB 2026', auftraggeberId: ag.id });
    await rechnung(p25.id, ag.id, '2025-06-30', 'abgerechnet', 10000);
    await rechnung(p25.id, ag.id, '2025-12-31', 'bezahlt', 2500.5);
    await rechnung(p26.id, ag.id, '2026-03-31', 'bezahlt', 7000);
    await rechnung(p26.id, ag.id, '2026-04-30', 'storniert', 9999);
    await rechnung(p26.id, ag.id, '2026-05-31', 'offen_prov', 8888);
    await rechnung(base.projekt.id, base.auftraggeber.id, '2026-01-31', 'bezahlt', 1234); // anderer Debitor

    const s = await ladeOrganisation360(pool, org.id);
    expect(s).toMatchObject({ id: org.id, name: 'St.Galler KB', klassifizierung: 'A' });
    expect(s.kontakte.map((k) => k.nachname)).toEqual(['Andres', 'Frei']);
    expect(s.aktivitaeten).toHaveLength(20);
    expect(s.aktivitaeten[0].betreff).toBe('Call 22');
    expect(s.offeneAufgaben.map((a) => a.titel)).toEqual(['Kontakt anrufen', 'Offerte nachfassen']);
    expect(s.offeneAufgaben[0]).toMatchObject({ kontaktName: 'Nina Frei', organisationName: 'St.Galler KB' });
    expect(s.offeneAufgaben[1]).toMatchObject({ verkaufschanceTitel: 'Zertifizierungslehrgang', organisationName: 'St.Galler KB' });
    expect(s.verkaufschancen.map((v) => v.titel)).toEqual(['Zertifizierungslehrgang']);
    expect(s.projekte.map((p) => p.nummer)).toEqual(['8100.26', '8100.25']);
    expect(s.projekte[0]).toMatchObject({ name: 'SGKB 2026', jahr: 2026, status: 'laufend' });
    expect(s.auftraggeber?.id).toBe(ag.id);
    expect(s.umsatzProJahr).toEqual([{ jahr: 2026, nettoChf: 7000 }, { jahr: 2025, nettoChf: 12500.5 }]);
  });
  it('ohne Auftraggeber: leere Projekte/Umsatz; 404 fuer Unbekannte', async () => {
    const s = await ladeOrganisation360(pool, andereOrg.id);
    expect(s).toMatchObject({ auftraggeber: null, projekte: [], umsatzProJahr: [], kontakte: [] });
    expect(s.offeneAufgaben.map((a) => a.titel)).toEqual(['Fremd']);
    await expect(ladeOrganisation360(pool, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Kontakt 360°', () => {
  it('inkl. Organisation, Aktivitaeten, Aufgaben, Chancen, Anmeldungen, Lernnachweise, Zertifizierungen', async () => {
    const ka = await pool.query(`insert into kursangebot(code,titel,bereich,lernstunden) values ('BEF','Eigenheimfinanzierung','Banking',8) returning id`);
    const d = await pool.query(
      `insert into durchfuehrung(kursangebot_id,code,start_datum,end_datum) values ($1,'BEF-2026-1','2026-11-10','2026-11-11') returning id`, [ka.rows[0].id]);
    const an = await pool.query(`insert into anmeldung(durchfuehrung_id,kontakt_id,status,preis_chf) values ($1,$2,'bestaetigt',1450) returning id`, [d.rows[0].id, kontakt.id]);
    await pool.query(`insert into lernnachweis(kontakt_id,anmeldung_id,datum,titel,lernstunden) values ($1,$2,'2026-05-02','BEF Vorkurs',8)`, [kontakt.id, an.rows[0].id]);
    await pool.query(`insert into lernnachweis(kontakt_id,datum,titel,lernstunden,quelle) values ($1,'2026-07-01','Extern',4,'extern')`, [kontakt.id]);
    await pool.query(`insert into zertifizierung(kontakt_id,typ,ausgestellt_am,gueltig_bis) values ($1,'SAQ Kundenberater Bank','2024-01-15','2027-01-14')`, [kontakt.id]);
    await createVerkaufschance(pool, { titel: 'Mit Kontakt', organisationId: org.id, kontaktId: kontakt.id });

    const s = await ladeKontakt360(pool, kontakt.id);
    expect(s).toMatchObject({ id: kontakt.id, nachname: 'Frei', organisation: { id: org.id, name: 'St.Galler KB' } });
    expect(s.aktivitaeten).toHaveLength(22);
    expect(s.aufgaben.map((a) => a.titel)).toEqual(['Kontakt anrufen']);
    expect(s.verkaufschancen.map((v) => v.titel)).toEqual(['Mit Kontakt']);
    expect(s.anmeldungen).toEqual([expect.objectContaining({ id: an.rows[0].id, durchfuehrungCode: 'BEF-2026-1', titel: 'Eigenheimfinanzierung', startDatum: '2026-11-10', endDatum: '2026-11-11', status: 'bestaetigt', preisChf: 1450 })]);
    expect(s.lernnachweise.map((l) => [l.titel, l.lernstunden])).toEqual([['Extern', 4], ['BEF Vorkurs', 8]]);
    expect(s.zertifizierungen).toEqual([expect.objectContaining({ typ: 'SAQ Kundenberater Bank', ausgestelltAm: '2024-01-15', gueltigBis: '2027-01-14', status: 'aktiv' })]);
  });
  it('Privatkontakt ohne Organisation; 404', async () => {
    const k = await createKontakt(pool, { nachname: 'Solo' });
    const s = await ladeKontakt360(pool, k.id);
    expect(s).toMatchObject({ organisation: null, aktivitaeten: [], aufgaben: [], anmeldungen: [], lernnachweise: [], zertifizierungen: [] });
    await expect(ladeKontakt360(pool, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Wiedervorlagen', () => {
  it('nur offene Aufgaben ohne Projekt, nach Faelligkeit gruppiert, optional je Mitarbeitende', async () => {
    await pool.query('delete from aufgabe');
    await aufgabe({ titel: 'Ueberfaellig', organisation_id: org.id, faellig_am: '2026-10-27', zustaendig_id: base.ml.id });
    await aufgabe({ titel: 'Heute', kontakt_id: kontakt.id, faellig_am: '2026-10-28', zustaendig_id: ph.id });
    await aufgabe({ titel: 'Sonntag', organisation_id: org.id, faellig_am: '2026-11-01', zustaendig_id: base.ml.id });
    await aufgabe({ titel: 'Naechste Woche', organisation_id: org.id, faellig_am: '2026-11-02', zustaendig_id: base.ml.id });
    await aufgabe({ titel: 'Ohne Termin', organisation_id: org.id, zustaendig_id: base.ml.id });
    await aufgabe({ titel: 'In Arbeit', organisation_id: org.id, status: 'in_arbeit', faellig_am: '2026-10-01' });
    await aufgabe({ titel: 'Erledigt', organisation_id: org.id, status: 'erledigt', faellig_am: '2026-10-01' });
    await aufgabe({ titel: 'Abgebrochen', organisation_id: org.id, status: 'abgebrochen', faellig_am: '2026-10-01' });
    await aufgabe({ titel: 'Projektaufgabe', projekt_id: base.projekt.id, faellig_am: '2026-10-01' });

    const w = await ladeWiedervorlagen(pool, { stichtag });
    expect(w.ueberfaellig.map((a) => a.titel)).toEqual(['In Arbeit', 'Ueberfaellig']);
    expect(w.dieseWoche.map((a) => a.titel)).toEqual(['Heute', 'Sonntag']);
    expect(w.spaeter.map((a) => a.titel)).toEqual(['Naechste Woche']);
    expect(w.ohneTermin.map((a) => a.titel)).toEqual(['Ohne Termin']);
    expect(w.dieseWoche[0]).toMatchObject({ kontaktName: 'Nina Frei', organisationName: 'St.Galler KB', zustaendigId: ph.id });

    const ml = await ladeWiedervorlagen(pool, { stichtag, mitarbeitendeId: base.ml.id });
    expect(ml.ueberfaellig.map((a) => a.titel)).toEqual(['Ueberfaellig']);
    expect(ml.dieseWoche.map((a) => a.titel)).toEqual(['Sonntag']);
  });
});

describe('CRM-Dashboard', () => {
  it('neue Anfragen, Wiedervorlagen, Pipeline, Aktivitaeten 30 Tage, Pflegeabdeckung', async () => {
    await createAnfrage(pool, { email: 'neu1@x.test' });
    await createAnfrage(pool, { email: 'neu2@x.test' });
    const verworfen = await createAnfrage(pool, { email: 'alt@x.test' });
    await pool.query(`update anfrage set status='verworfen' where id=$1`, [verworfen.id]);

    // Pflege: org (A) hat Aktivitaeten ueber Kontakt (Sept. 2026), andereOrg (A) keine; Klassifizierung C mit Aktivitaet vor > 365 Tagen
    const c = await createOrganisation(pool, { name: 'Alte Pflege', klassifizierung: 'C' });
    await createAktivitaet(pool, { typ: 'besuch', betreff: 'Lang her', organisationId: c.id, datum: '2025-10-28T12:00:00Z' });
    const ohne = await createOrganisation(pool, { name: 'Ohne Klasse' });
    await createAktivitaet(pool, { typ: 'email', betreff: 'Kuerzlich', organisationId: ohne.id, datum: '2026-10-20T12:00:00Z' });
    const archiviert = await createOrganisation(pool, { name: 'Archiviert', klassifizierung: 'C' });
    await updateOrganisation(pool, archiviert.id, { archiviert: true });
    await createAktivitaet(pool, { typ: 'email', betreff: 'Zukunft', organisationId: ohne.id, datum: '2026-11-20T12:00:00Z' });

    const d = await ladeCrmDashboard(pool, { stichtag });
    expect(d.stichtag).toBe(stichtag);
    expect(d.neueAnfragen.anzahl).toBe(2);
    expect(d.neueAnfragen.neueste.map((a) => a.email).sort()).toEqual(['neu1@x.test', 'neu2@x.test']);
    expect(d.wiedervorlagen).toEqual({ ueberfaellig: 2, dieseWoche: 2, spaeter: 1, ohneTermin: 1 });
    expect(d.pipeline).toEqual({ anzahl: 2, summeChf: 50000, gewichtetChf: 5000 });
    expect(d.aktivitaeten30Tage.anzahl).toBe(1);
    expect(d.aktivitaeten30Tage.jeTyp).toEqual({ email: 1 });
    expect(d.pflegeabdeckung).toEqual([
      { klassifizierung: 'A', organisationen: 2, gepflegt: 1, abdeckungProzent: 50 },
      { klassifizierung: 'B', organisationen: 0, gepflegt: 0, abdeckungProzent: null },
      { klassifizierung: 'C', organisationen: 1, gepflegt: 0, abdeckungProzent: 0 },
      { klassifizierung: 'akquisition', organisationen: 0, gepflegt: 0, abdeckungProzent: null },
      { klassifizierung: 'ohne', organisationen: 1, gepflegt: 1, abdeckungProzent: 100 },
    ]);
    const meins = await ladeCrmDashboard(pool, { stichtag, mitarbeitendeId: base.ml.id });
    expect(meins.wiedervorlagen).toEqual({ ueberfaellig: 1, dieseWoche: 1, spaeter: 1, ohneTermin: 1 });
  });
});

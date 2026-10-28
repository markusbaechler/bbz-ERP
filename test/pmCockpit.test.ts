import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { createReferent, updateReferent } from '../src/repos/referentRepo';
import { createEinsatz, setEinsatzStatus } from '../src/repos/einsatzRepo';
import { createProjekt, updateProjekt, setProjektStatus } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { createZeiterfassung, zeitVerrechnen } from '../src/repos/zeiterfassungRepo';
import { createAufgabe, updateAufgabe } from '../src/repos/aufgabeRepo';
import { createPhase } from '../src/repos/phaseRepo';
import { createMeilenstein, setMeilensteinErreicht } from '../src/repos/meilensteinRepo';
import { getCockpit, getPortfolio, getKanban, getGantt, getAuslastung } from '../src/repos/pmAuswertungRepo';
import { NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
const HEUTE = '2026-10-28';
let base: Awaited<ReturnType<typeof grundbestand>>;
let p: string; let referentId: string; let msKonzept: string;

beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  p = base.projekt.id;   // Budget 20000
  const ph = await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Huber', stundensatzIntern: 70, stundensatzVerrechnung: 180 });
  const z = (mitarbeitendeId: string, datum: string, stunden: number, extra: object = {}) =>
    createZeiterfassung(pool, { mitarbeitendeId, projektId: p, datum, stunden, taetigkeit: 'Beratung', ...extra });
  await z(base.ml.id, '2026-09-10', 10);                        // 2200 Leistung, 900 intern
  await z(ph.id, '2026-09-11', 5);                              //  900 Leistung, 350 intern
  await z(base.ml.id, '2026-09-12', 2, { verrechenbar: false }); //    0 Leistung, 180 intern
  const lauf = await zeitVerrechnen(pool, p, { datum: '2026-09-30', bis: '2026-09-30', mwstSatz: 8.1, gruppierung: 'mitarbeitende' });
  await festschreiben(pool, lauf.rechnung.id, 'ml');            // abgerechnet 3100
  await z(base.ml.id, '2026-10-10', 4);                         //  880 unverrechnet, 360 intern
  // Entwurf zaehlt nicht als abgerechnet
  const entwurf = await createRechnung(pool, { projektId: p, auftraggeberId: base.auftraggeber.id, datum: '2026-10-31' });
  await addPosition(pool, entwurf.id, { beschreibung: 'Entwurf', menge: 1, einzelpreis: 1000, mwstSatz: 8.1 });

  const k = await createKontakt(pool, { vorname: 'Eva', nachname: 'Extern', email: 'eva@extern.test' });
  referentId = (await createReferent(pool, { typ: 'extern', kontaktId: k.id, tagessatzChf: 1500, halbtagessatzChf: 800 })).id;
  await createEinsatz(pool, { referentId, projektId: p, datum: '2026-10-20', honorarChf: 1500, status: 'bestaetigt' });
  const abgesagt = await createEinsatz(pool, { referentId, projektId: p, datum: '2026-10-21', dauerTage: 0.5 });
  await setEinsatzStatus(pool, abgesagt.id, 'abgesagt');

  const a1 = await createAufgabe(pool, { titel: 'Erledigt', projektId: p });
  await updateAufgabe(pool, a1.id, { status: 'erledigt' });
  await createAufgabe(pool, { titel: 'Offen', projektId: p });
  const a3 = await createAufgabe(pool, { titel: 'Verworfen', projektId: p });
  await updateAufgabe(pool, a3.id, { status: 'abgebrochen' });

  msKonzept = (await createMeilenstein(pool, p, { titel: 'Konzept abgenommen', faelligAm: '2026-10-08' })).id;
  const ms2 = await createMeilenstein(pool, p, { titel: 'Kickoff', faelligAm: '2026-09-01' });
  await setMeilensteinErreicht(pool, ms2.id, '2026-09-01');
  await createMeilenstein(pool, p, { titel: 'Schluss', faelligAm: '2026-12-15' });
});
afterAll(async () => { await closePool(); });

describe('Cockpit', () => {
  it('rechnet alle Kennzahlen aus Zeit, Rechnungen, Einsaetzen, Aufgaben und Meilensteinen', async () => {
    const c = await getCockpit(pool, p, HEUTE);
    expect(c).toMatchObject({
      projektId: p, budgetChf: 20000,
      abgerechnetChf: 3100,                 // nur abgerechnet/bezahlt, kein Entwurf
      leistungenChf: 3980,                  // 2200 + 900 + 880 (nur verrechenbar)
      unverrechnetChf: 880,
      stundenIst: 21, stundenVerrechenbar: 19,
      internKostenChf: 1790,                // 21 Std zu Kostensatz (ml 90, ph 70)
      honorareChf: 1500,                    // abgesagter Einsatz zaehlt nicht
      deckungsbeitragChf: -190,             // 3100 - 1790 - 1500
      budgetverbrauchProzent: 27.4,         // (3980 + 1500) / 20000
      fortschritt: { total: 2, erledigt: 1, prozent: 50 },
      meilensteine: { total: 3, erreicht: 1, ueberfaellig: 1, maxVerzugTage: 20 },
      ampel: 'rot', ampelGruende: ['Meilenstein "Konzept abgenommen" 20 Tage ueberfaellig (> 14)'],
    });
  });

  it('Ampel folgt Meilenstein und Budget', async () => {
    expect((await getCockpit(pool, p, '2026-10-15')).ampel).toBe('gelb');          // 7 Tage ueberfaellig
    await setMeilensteinErreicht(pool, msKonzept, '2026-10-27');
    expect((await getCockpit(pool, p, HEUTE)).ampel).toBe('gruen');
    await updateProjekt(pool, p, { budgetChf: 6000 });
    const gelb = await getCockpit(pool, p, HEUTE);
    expect([gelb.ampel, gelb.budgetverbrauchProzent]).toEqual(['gelb', 91.3]);
    await updateProjekt(pool, p, { budgetChf: 5000 });
    const rot = await getCockpit(pool, p, HEUTE);
    expect(rot.ampelGruende).toEqual(['Budgetverbrauch 109.6 % (> 100 %)']);
    await updateProjekt(pool, p, { budgetChf: 20000 });
  });

  it('404 fuer unbekanntes Projekt', async () => {
    await expect(getCockpit(pool, '00000000-0000-0000-0000-000000000000', HEUTE)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Portfolio', () => {
  it('liefert die Cockpit-Kurzform je Projekt, filterbar nach Jahr und Status', async () => {
    const leer = await createProjekt(pool, { stammnummer: 5000, jahr: 2026, name: 'Leer', auftraggeberId: base.auftraggeber.id, status: 'akquise' });
    await createProjekt(pool, { stammnummer: 5001, jahr: 2025, name: 'Vorjahr', auftraggeberId: base.auftraggeber.id });
    const alle = await getPortfolio(pool, { jahr: 2026 }, HEUTE);
    expect(alle.map((x) => x.nummer)).toEqual(['5000.26', '6231.26']);
    const e = alle.find((x) => x.projektId === leer.id)!;
    expect(e).toMatchObject({ name: 'Leer', status: 'akquise', abgerechnetChf: 0, leistungenChf: 0, budgetverbrauchProzent: null, ampel: 'gruen' });
    const haupt = alle.find((x) => x.projektId === p)!;
    expect(haupt).toMatchObject({ abgerechnetChf: 3100, unverrechnetChf: 880, honorareChf: 1500, ampel: 'gruen' });
    expect((await getPortfolio(pool, { jahr: 2026, status: 'akquise' }, HEUTE)).map((x) => x.name)).toEqual(['Leer']);
  });
});

describe('Kanban', () => {
  it('liefert die vier Spalten in Reihenfolge, sortiert, ohne abgebrochene', async () => {
    const q = (await createProjekt(pool, { stammnummer: 5100, jahr: 2026, name: 'Board', auftraggeberId: base.auftraggeber.id })).id;
    const a = await createAufgabe(pool, { titel: 'A', projektId: q });
    await createAufgabe(pool, { titel: 'B', projektId: q });
    await createAufgabe(pool, { titel: 'C', projektId: q, sortierung: -1 });
    await updateAufgabe(pool, a.id, { status: 'review' });
    const x = await createAufgabe(pool, { titel: 'X', projektId: q });
    await updateAufgabe(pool, x.id, { status: 'abgebrochen' });
    const k = await getKanban(pool, q);
    expect(k.spalten.map((s) => s.status)).toEqual(['offen', 'in_arbeit', 'review', 'erledigt']);
    expect(k.spalten.map((s) => s.aufgaben.map((t) => t.titel))).toEqual([['C', 'B'], [], ['A'], []]);
    await expect(getKanban(pool, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Gantt', () => {
  it('liefert Phasen, Aufgaben (mit Vorgaenger), Meilensteine und Einsaetze als Zeitachse', async () => {
    const g = (await createProjekt(pool, { stammnummer: 5200, jahr: 2026, name: 'Plan', auftraggeberId: base.auftraggeber.id,
      startDatum: '2026-01-05', endDatum: '2026-12-18' })).id;
    const phase = await createPhase(pool, g, { name: 'Konzept', startDatum: '2026-02-01', endDatum: '2026-03-31' });
    const v = await createAufgabe(pool, { titel: 'Analyse', projektId: g, phaseId: phase.id, startDatum: '2026-02-02', faelligAm: '2026-02-20' });
    const n = await createAufgabe(pool, { titel: 'Entwurf', projektId: g, vorgaengerId: v.id, faelligAm: '2026-03-15' });
    await createAufgabe(pool, { titel: 'Ungeplant', projektId: g });
    const m = await createMeilenstein(pool, g, { titel: 'Abnahme', faelligAm: '2026-03-31', phaseId: phase.id });
    await createEinsatz(pool, { referentId, projektId: g, datum: '2026-03-10', rolle: 'Moderation' });
    const weg = await createEinsatz(pool, { referentId, projektId: g, datum: '2026-03-11' });
    await setEinsatzStatus(pool, weg.id, 'abgesagt');

    const gantt = await getGantt(pool, g, HEUTE);
    expect([gantt.start, gantt.ende]).toEqual(['2026-01-05', '2026-12-18']);
    expect(gantt.items.map((i) => [i.typ, i.titel, i.start, i.ende, i.status])).toEqual([
      ['phase', 'Konzept', '2026-02-01', '2026-03-31', 'geplant'],
      ['aufgabe', 'Analyse', '2026-02-02', '2026-02-20', 'offen'],
      ['einsatz', 'Eva Extern (Moderation)', '2026-03-10', '2026-03-10', 'angefragt'],
      ['aufgabe', 'Entwurf', '2026-03-15', '2026-03-15', 'offen'],
      ['meilenstein', 'Abnahme', '2026-03-31', '2026-03-31', 'ueberfaellig'],
      ['aufgabe', 'Ungeplant', null, null, 'offen'],
    ]);
    expect(gantt.items.find((i) => i.id === n.id)?.vorgaengerId).toBe(v.id);
    expect(gantt.items.find((i) => i.id === m.id)?.phaseId).toBe(phase.id);
    await setProjektStatus(pool, g, 'abgesagt');
    await expect(getGantt(pool, '00000000-0000-0000-0000-000000000000', HEUTE)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Ressourcen-Auslastung', () => {
  it('summiert verplante Tage je Referent:in und Tag (ohne Absagen), nur im Zeitraum', async () => {
    const intern = await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id });
    await createEinsatz(pool, { referentId: intern.id, projektId: p, datum: '2026-11-02', dauerTage: 0.5 });
    await createEinsatz(pool, { referentId: intern.id, projektId: p, datum: '2026-11-02', dauerTage: 0.5 });
    await createEinsatz(pool, { referentId: intern.id, projektId: p, datum: '2026-11-03', dauerTage: 0.5 });
    await createEinsatz(pool, { referentId: intern.id, projektId: p, datum: '2026-12-01' });     // ausserhalb
    const k = await createKontakt(pool, { vorname: 'Ina', nachname: 'Inaktiv', email: 'ina@x.test' });
    const inaktiv = await createReferent(pool, { typ: 'extern', kontaktId: k.id });
    await updateReferent(pool, inaktiv.id, { aktiv: false });

    const a = await getAuslastung(pool, { von: '2026-10-01', bis: '2026-11-30' });
    expect(a).toEqual([
      { referentId, anzeigename: 'Eva Extern', tage: [{ datum: '2026-10-20', verplantTage: 1 }], summeTage: 1 },
      { referentId: intern.id, anzeigename: 'Markus Muster', summeTage: 1.5,
        tage: [{ datum: '2026-11-02', verplantTage: 1 }, { datum: '2026-11-03', verplantTage: 0.5 }] },
    ]);
    expect((await getAuslastung(pool, { von: '2026-11-01', bis: '2026-11-30', referentId })).length).toBe(1);
  });
  it('validiert den Zeitraum', async () => {
    await expect(getAuslastung(pool, { von: '2026-11-01' } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(getAuslastung(pool, { von: '2026-11-30', bis: '2026-11-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(getAuslastung(pool, { von: '2026-01-01', bis: '2027-06-30' })).rejects.toBeInstanceOf(ValidationError);
  });
});

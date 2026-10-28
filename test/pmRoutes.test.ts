import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { buildApp } from '../src/server/app';
import { createKontakt } from '../src/repos/kontaktRepo';
import { createReferent } from '../src/repos/referentRepo';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
const ml = { 'x-user': 'ml' };
const NIX = '00000000-0000-0000-0000-000000000000';
let base: Awaited<ReturnType<typeof grundbestand>>;
let p: string;

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = ml) =>
  app.inject({ method, url, payload, headers });

beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  p = base.projekt.id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('Projekt-Routen', () => {
  it('/projekt/portfolio wird nicht von /projekt/:id verdeckt', async () => {
    const r = await req('GET', '/projekt/portfolio?jahr=2026&heute=2026-10-28');
    expect(r.statusCode).toBe(200);
    expect(r.json()[0]).toMatchObject({ projektId: p, nummer: '6231.26', ampel: 'gruen' });
    expect((await req('GET', '/projekt/portfolio?status=kaputt')).statusCode).toBe(400);
    expect((await req('GET', `/projekt/${p}`)).json().nummer).toBe('6231.26');
    expect((await req('GET', '/projekt/kein-uuid')).statusCode).toBe(400);
    expect((await req('GET', `/projekt/${NIX}`)).statusCode).toBe(404);
  });

  it('PATCH fuer alle Mitarbeitenden; Status nur via Statusendpoint', async () => {
    const r = await req('PATCH', `/projekt/${p}`, { projektleitungId: base.ml.id, budgetStunden: 100, startDatum: '2026-01-01' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ projektleitungId: base.ml.id, budgetStunden: 100, startDatum: '2026-01-01' });
    expect((await req('PATCH', `/projekt/${p}`, { status: 'archiviert' })).statusCode).toBe(400);
    expect((await req('PATCH', `/projekt/${p}`, { endDatum: '2025-01-01' })).statusCode).toBe(400);
    expect((await req('PATCH', `/projekt/${NIX}`, { name: 'x' })).statusCode).toBe(404);
  });

  it('GET /projekt filtert nach Status (Liste) und Projektleitung', async () => {
    expect((await req('GET', `/projekt?status=laufend,akquise&projektleitungId=${base.ml.id}`)).json().length).toBe(1);
    expect((await req('GET', '/projekt?status=akquise')).json().length).toBe(0);
    expect((await req('GET', '/projekt?status=zu')).statusCode).toBe(400);
    expect((await req('GET', '/projekt?jahr=abc')).statusCode).toBe(400);
  });

  it('Statuswechsel: 409 bei unverrechneter Zeit, force nur Admin, 400 bei verbotenem Wechsel', async () => {
    const neu = (await req('POST', '/projekt', { stammnummer: 4100, jahr: 2026, name: 'Status', auftraggeberId: base.auftraggeber.id }, admin)).json().id;
    expect((await req('POST', '/zeiterfassung', { projektId: neu, datum: '2026-10-01', stunden: 1, taetigkeit: 'X' })).statusCode).toBe(201);
    expect((await req('POST', `/projekt/${neu}/status`, { status: 'abgeschlossen' })).statusCode).toBe(409);
    expect((await req('POST', `/projekt/${neu}/status`, { status: 'abgeschlossen', force: true })).statusCode).toBe(403);
    const ok = await req('POST', `/projekt/${neu}/status`, { status: 'abgeschlossen', force: true }, admin);
    expect([ok.statusCode, ok.json().status]).toEqual([200, 'abgeschlossen']);
    expect((await req('POST', `/projekt/${neu}/status`, { status: 'akquise' })).statusCode).toBe(400);
    expect((await req('POST', `/projekt/${neu}/status`, {})).statusCode).toBe(400);
    expect((await req('POST', `/projekt/${NIX}/status`, { status: 'laufend' })).statusCode).toBe(404);
  });

  it('Jahresfortfuehrung: 201, dann 409', async () => {
    const r = await req('POST', `/projekt/${p}/fortsetzen`, { jahr: 2027 });
    expect([r.statusCode, r.json().nummer, r.json().projektleitungId]).toEqual([201, '6231.27', base.ml.id]);
    expect((await req('POST', `/projekt/${p}/fortsetzen`, { jahr: 2027 })).statusCode).toBe(409);
    expect((await req('POST', `/projekt/${p}/fortsetzen`, {})).statusCode).toBe(400);
  });
});

describe('Phasen-, Meilenstein- und Aufgaben-Routen', () => {
  it('Phasen: anlegen/listen/aendern; Loeschen nur Admin', async () => {
    const ph = await req('POST', `/projekt/${p}/phase`, { name: 'Konzept', startDatum: '2026-02-01', endDatum: '2026-03-31' });
    expect(ph.statusCode).toBe(201);
    expect((await req('POST', `/projekt/${p}/phase`, { name: 'X', startDatum: '2026-03-01', endDatum: '2026-02-01' })).statusCode).toBe(400);
    expect((await req('POST', `/projekt/${NIX}/phase`, { name: 'X' })).statusCode).toBe(404);
    expect((await req('PATCH', `/phase/${ph.json().id}`, { status: 'aktiv' })).json().status).toBe('aktiv');
    expect((await req('GET', `/projekt/${p}/phase`)).json().length).toBe(1);
    const weg = (await req('POST', `/projekt/${p}/phase`, { name: 'Weg' })).json().id;
    expect((await req('DELETE', `/phase/${weg}`)).statusCode).toBe(403);
    expect((await req('DELETE', `/phase/${weg}`, undefined, admin)).statusCode).toBe(204);
    expect((await req('DELETE', `/phase/${weg}`, undefined, admin)).statusCode).toBe(404);
  });

  it('Meilensteine: anlegen, erreicht (Default heute), aendern, loeschen nur Admin', async () => {
    const m = await req('POST', `/projekt/${p}/meilenstein`, { titel: 'Kickoff', faelligAm: '2026-02-15' });
    expect(m.statusCode).toBe(201);
    const e = await req('POST', `/meilenstein/${m.json().id}/erreicht`, { datum: '2026-02-16' });
    expect(e.json().erreichtAm).toBe('2026-02-16');
    const ohneDatum = await req('POST', `/meilenstein/${m.json().id}/erreicht`);
    expect(ohneDatum.json().erreichtAm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await req('PATCH', `/meilenstein/${m.json().id}`, { erreichtAm: null })).json().erreichtAm).toBeNull();
    expect((await req('GET', `/projekt/${p}/meilenstein`)).json().length).toBe(1);
    expect((await req('POST', `/projekt/${p}/meilenstein`, { titel: 'ohne Datum' })).statusCode).toBe(400);
    expect((await req('DELETE', `/meilenstein/${m.json().id}`)).statusCode).toBe(403);
  });

  it('Aufgaben: erstellt_durch aus Auth, Regeln 400/409, Filter, Verschieben, Kanban, Loeschen', async () => {
    const a = await req('POST', '/aufgabe', { titel: 'Analyse', projektId: p, zustaendigId: base.ml.id, faelligAm: '2026-10-01' });
    expect([a.statusCode, a.json().erstelltDurch]).toEqual([201, 'ml']);
    const b = await req('POST', '/aufgabe', { titel: 'Umsetzung', projektId: p, vorgaengerId: a.json().id });
    expect((await req('PATCH', `/aufgabe/${a.json().id}`, { vorgaengerId: b.json().id })).statusCode).toBe(400);   // Zyklus
    expect((await req('PATCH', `/aufgabe/${b.json().id}`, { status: 'in_arbeit' })).statusCode).toBe(409);
    expect((await req('POST', `/aufgabe/${b.json().id}/verschieben`, { status: 'review', sortierung: 0 })).statusCode).toBe(409);

    const ue = await req('GET', `/aufgabe?projektId=${p}&ueberfaellig=true&heute=2026-10-28`);
    expect(ue.json().map((x: any) => x.titel)).toEqual(['Analyse']);
    expect((await req('GET', `/aufgabe?zustaendigId=${base.ml.id}&status=offen,in_arbeit`)).json().length).toBe(1);
    expect((await req('GET', '/aufgabe?ueberfaellig=ja')).statusCode).toBe(400);
    expect((await req('GET', '/aufgabe?status=fertig')).statusCode).toBe(400);

    const v = await req('POST', `/aufgabe/${a.json().id}/verschieben`, { status: 'erledigt', sortierung: 0 });
    expect([v.statusCode, v.json().status]).toEqual([200, 'erledigt']);
    expect(v.json().erledigtAm).not.toBeNull();
    expect((await req('POST', `/aufgabe/${b.json().id}/verschieben`, { status: 'in_arbeit', sortierung: 0 })).statusCode).toBe(200);

    const k = (await req('GET', `/projekt/${p}/kanban`)).json();
    expect(k.spalten.map((s: any) => [s.status, s.aufgaben.map((x: any) => x.titel)])).toEqual([
      ['offen', []], ['in_arbeit', ['Umsetzung']], ['review', []], ['erledigt', ['Analyse']],
    ]);
    expect((await req('GET', `/aufgabe/${b.json().id}`)).json().titel).toBe('Umsetzung');
    expect((await req('DELETE', `/aufgabe/${b.json().id}`)).statusCode).toBe(204);
    expect((await req('GET', `/aufgabe/${b.json().id}`)).statusCode).toBe(404);
  });

  it('CRM-Wiedervorlage ohne Projekt', async () => {
    const k = await createKontakt(pool, { nachname: 'Kunde', email: 'kunde@bank.test' });
    const w = await req('POST', '/aufgabe', { titel: 'Rueckruf', kontaktId: k.id, faelligAm: '2026-11-02' });
    expect(w.statusCode).toBe(201);
    expect((await req('GET', `/aufgabe?kontaktId=${k.id}&ohneProjekt=true`)).json().map((x: any) => x.id)).toEqual([w.json().id]);
    expect((await req('POST', '/aufgabe', { titel: 'X', kontaktId: NIX })).statusCode).toBe(400);
  });

  it('Gantt liefert die Zeitachse', async () => {
    const g = await req('GET', `/projekt/${p}/gantt?heute=2026-10-28`);
    expect(g.statusCode).toBe(200);
    expect(new Set(g.json().items.map((i: any) => i.typ))).toEqual(new Set(['phase', 'aufgabe', 'meilenstein']));
    expect((await req('GET', `/projekt/${p}/gantt?heute=gestern`)).statusCode).toBe(400);
  });
});

describe('Zeiterfassung- und Verrechnungs-Routen', () => {
  let z: string;
  it('Mitarbeitende aus Auth (x-user), sonst 400', async () => {
    const r = await req('POST', '/zeiterfassung', { projektId: p, datum: '2026-10-05', stunden: 3, taetigkeit: 'Workshop' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ mitarbeitendeId: base.ml.id, ansatzChf: 220 });
    z = r.json().id;
    expect((await req('POST', '/zeiterfassung', { projektId: p, datum: '2026-10-05', stunden: 1, taetigkeit: 'X' }, {})).statusCode).toBe(400);
    expect((await req('POST', '/zeiterfassung', { projektId: p, datum: '2026-10-05', stunden: 1, taetigkeit: 'X' }, { 'x-user': 'zz' })).statusCode).toBe(400);
    const ph = await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Huber', stundensatzVerrechnung: 180 });
    const fremd = await req('POST', '/zeiterfassung', { mitarbeitendeId: ph.id, projektId: p, datum: '2026-10-06', stunden: 2, taetigkeit: 'Konzept' });
    expect(fremd.json()).toMatchObject({ mitarbeitendeId: ph.id, ansatzChf: 180 });
    expect((await req('PATCH', `/zeiterfassung/${z}`, { stunden: 3.5 })).json().stunden).toBe(3.5);
    expect((await req('GET', `/zeiterfassung?projektId=${p}&verrechnet=false&von=2026-10-01`)).json().length).toBe(2);
    expect((await req('GET', '/zeiterfassung?verrechnet=vielleicht')).statusCode).toBe(400);
  });

  it('zeit-verrechnen nur Admin; danach Eintraege gesperrt; Cockpit zeigt den Stand', async () => {
    const body = { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'taetigkeit' };
    expect((await req('POST', `/projekt/${p}/zeit-verrechnen`, body)).statusCode).toBe(403);
    const r = await req('POST', `/projekt/${p}/zeit-verrechnen`, body, admin);
    expect(r.statusCode).toBe(201);
    expect(r.json().anzahlEintraege).toBe(2);
    expect(r.json().positionen.map((x: any) => x.beschreibung)).toEqual(['Konzept (2 Std)', 'Workshop (3.5 Std)']);
    expect(r.json().rechnung.totalNetto).toBe(2 * 180 + 3.5 * 220);
    expect((await req('PATCH', `/zeiterfassung/${z}`, { stunden: 1 })).statusCode).toBe(409);
    expect((await req('DELETE', `/zeiterfassung/${z}`)).statusCode).toBe(409);
    expect((await req('POST', `/projekt/${p}/zeit-verrechnen`, body, admin)).statusCode).toBe(400);
    expect((await req('POST', `/projekt/${p}/zeit-verrechnen`, { ...body, gruppierung: 'x' }, admin)).statusCode).toBe(400);
    const c = (await req('GET', `/projekt/${p}/cockpit?heute=2026-10-28`)).json();
    expect(c).toMatchObject({ leistungenChf: 1130, unverrechnetChf: 0, abgerechnetChf: 0 });
    expect(Array.isArray(c.ampelGruende)).toBe(true);
    expect((await req('GET', `/projekt/${NIX}/cockpit`)).statusCode).toBe(404);
  });
});

describe('Einsatz- und Ressourcen-Routen', () => {
  let referentId: string;
  beforeAll(async () => {
    const k = await createKontakt(pool, { vorname: 'Eva', nachname: 'Extern', email: 'eva@extern.test' });
    referentId = (await createReferent(pool, { typ: 'extern', kontaktId: k.id, tagessatzChf: 1500 })).id;
  });

  it('POST /einsatz mit Ueberbuchungsschutz; Status; Liste', async () => {
    const e = await req('POST', '/einsatz', { referentId, projektId: p, datum: '2026-11-10' });
    expect([e.statusCode, e.json().honorarChf]).toEqual([201, 1500]);
    expect((await req('POST', '/einsatz', { referentId, projektId: p, datum: '2026-11-10' })).statusCode).toBe(409);
    expect((await req('POST', '/einsatz', { referentId, projektId: p, datum: '2026-11-10', ueberbuchungErlauben: true })).statusCode).toBe(403);
    expect((await req('POST', '/einsatz', { referentId, projektId: p, datum: '2026-11-10', ueberbuchungErlauben: true }, admin)).statusCode).toBe(201);
    expect((await req('POST', '/einsatz', { referentId, projektId: p, datum: '10.11.2026' })).statusCode).toBe(400);
    expect((await req('POST', '/einsatz', { referentId: NIX, projektId: p, datum: '2026-11-11' })).statusCode).toBe(404);
    const s = await req('POST', `/einsatz/${e.json().id}/status`, { status: 'bestaetigt' });
    expect(s.json().status).toBe('bestaetigt');
    expect((await req('POST', `/einsatz/${e.json().id}/status`, { status: 'weg' })).statusCode).toBe(400);
    expect((await req('POST', `/einsatz/${NIX}/status`, { status: 'abgesagt' })).statusCode).toBe(404);
    expect((await req('GET', `/einsatz?projektId=${p}&status=bestaetigt`)).json().length).toBe(1);
    expect((await req('GET', `/einsatz?referentId=${referentId}&von=2026-11-01&bis=2026-11-30`)).json().length).toBe(2);
  });

  it('GET /ressourcen/auslastung', async () => {
    const r = await req('GET', '/ressourcen/auslastung?von=2026-11-01&bis=2026-11-30');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ referentId, anzeigename: 'Eva Extern', tage: [{ datum: '2026-11-10', verplantTage: 2 }], summeTage: 2 }]);
    expect((await req('GET', '/ressourcen/auslastung?von=2026-11-01')).statusCode).toBe(400);
  });
});

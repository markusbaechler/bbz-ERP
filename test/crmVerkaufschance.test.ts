import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import {
  createVerkaufschance, getVerkaufschance, updateVerkaufschance, listVerkaufschancen, setzePhase, eroeffneProjekt, ladePipeline,
} from '../src/repos/verkaufschanceRepo';
import { createOrganisation, verknuepfeAuftraggeber } from '../src/repos/organisationRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ValidationError, ConflictError } from '../src/domain/errors';

const pool = getPool();
const heute = '2026-10-28';
let base: Awaited<ReturnType<typeof grundbestand>>;
let org: { id: string }; let orgOhneDebitor: { id: string };
beforeAll(async () => {
  await resetDb(pool); base = await grundbestand(pool);
  org = await createOrganisation(pool, { name: 'Glarner KB', strasse: 'Hauptstrasse 21', plz: '8750', ort: 'Glarus' });
  await verknuepfeAuftraggeber(pool, org.id, { nummer: '40001' });
  orgOhneDebitor = await createOrganisation(pool, { name: 'Ohne Debitor AG' });
});
afterAll(async () => { await closePool(); });

describe('verkaufschance: anlegen / aendern / liste', () => {
  it('legt als Lead mit Default-Wahrscheinlichkeit an', async () => {
    const v = await createVerkaufschance(pool, { titel: ' Lehrgang Kundenberatung ', organisationId: org.id, wertChf: 48000.456, erwarteterAbschluss: '2026-12-15', verantwortlichId: base.ml.id });
    expect(v).toMatchObject({ titel: 'Lehrgang Kundenberatung', phase: 'lead', wahrscheinlichkeit: 10, wertChf: 48000.46, erwarteterAbschluss: '2026-12-15', projektId: null, abgeschlossenAm: null });
    expect((await createVerkaufschance(pool, { titel: 'X', organisationId: org.id, phase: 'offeriert' })).wahrscheinlichkeit).toBe(50);
    expect((await createVerkaufschance(pool, { titel: 'Y', organisationId: org.id, phase: 'offeriert', wahrscheinlichkeit: 35 })).wahrscheinlichkeit).toBe(35);
  });
  it('validiert', async () => {
    await expect(createVerkaufschance(pool, { titel: '', organisationId: org.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createVerkaufschance(pool, { titel: 'X' } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(createVerkaufschance(pool, { titel: 'X', organisationId: org.id, phase: 'gewonnen' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createVerkaufschance(pool, { titel: 'X', organisationId: org.id, wertChf: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createVerkaufschance(pool, { titel: 'X', organisationId: org.id, wahrscheinlichkeit: 120 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createVerkaufschance(pool, { titel: 'X', organisationId: org.id, erwarteterAbschluss: '2026-13-01' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('PATCH aendert Stammfelder, aber nicht die Phase', async () => {
    const v = await createVerkaufschance(pool, { titel: 'Patch', organisationId: org.id });
    const p = await updateVerkaufschance(pool, v.id, { wertChf: 1200, bereich: 'Beratung', erwarteterAbschluss: null });
    expect(p).toMatchObject({ wertChf: 1200, bereich: 'Beratung', erwarteterAbschluss: null, phase: 'lead' });
    await expect(updateVerkaufschance(pool, v.id, { phase: 'gewonnen' } as any)).rejects.toThrow(/phase/);
  });
  it('listet mit Filtern (Phase als Liste, offen, Verantwortlich, Organisation) inkl. Organisationsname', async () => {
    const l = await listVerkaufschancen(pool, { phase: 'offeriert' });
    expect(l.map((x) => x.titel).sort()).toEqual(['X', 'Y']);
    expect(l[0].organisationName).toBe('Glarner KB');
    expect((await listVerkaufschancen(pool, { phase: 'lead,offeriert' })).length).toBe(4);
    expect((await listVerkaufschancen(pool, { verantwortlichId: base.ml.id })).map((x) => x.titel)).toEqual(['Lehrgang Kundenberatung']);
    expect((await listVerkaufschancen(pool, { organisationId: orgOhneDebitor.id })).length).toBe(0);
    expect((await listVerkaufschancen(pool, { phase: 'offen' })).length).toBe(4);
    await expect(listVerkaufschancen(pool, { phase: 'irgendwas' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('verkaufschance: Phasenwechsel', () => {
  it('setzt Default-Wahrscheinlichkeit; verloren verlangt Grund; schreibt Audit', async () => {
    const v = await createVerkaufschance(pool, { titel: 'Phasen', organisationId: org.id });
    expect((await setzePhase(pool, v.id, { phase: 'verhandlung', heute })).wahrscheinlichkeit).toBe(75);
    await expect(setzePhase(pool, v.id, { phase: 'verloren', heute })).rejects.toBeInstanceOf(ValidationError);
    const verloren = await setzePhase(pool, v.id, { phase: 'verloren', verlustgrund: 'Preis', heute, benutzer: 'ml' });
    expect(verloren).toMatchObject({ phase: 'verloren', wahrscheinlichkeit: 0, verlustgrund: 'Preis', abgeschlossenAm: heute });
    await expect(setzePhase(pool, v.id, { phase: 'lead', heute })).rejects.toBeInstanceOf(ConflictError);
    const wieder = await setzePhase(pool, v.id, { phase: 'qualifiziert', heute, wiedereroeffnen: true, benutzer: 'ml' });
    expect(wieder).toMatchObject({ phase: 'qualifiziert', wahrscheinlichkeit: 25, verlustgrund: null, abgeschlossenAm: null });
    const audit = await listAudit(pool, 'verkaufschance', v.id);
    expect(audit.map((a) => a.aktion)).toEqual(['verkaufschance.verloren', 'verkaufschance.wiedereroeffnet']);
    expect(audit[0]).toMatchObject({ benutzer: 'ml', details: { vonPhase: 'verhandlung', verlustgrund: 'Preis' } });
  });
});

describe('verkaufschance -> projekt', () => {
  it('eroeffnet Projekt beim verknuepften Auftraggeber, setzt gewonnen + Link', async () => {
    const k = await createKontakt(pool, { nachname: 'Entscheider', organisationId: org.id });
    const v = await createVerkaufschance(pool, { titel: 'Tailor-made Fuehrung', organisationId: org.id, kontaktId: k.id, bereich: 'Leadership', phase: 'verhandlung', wertChf: 30000 });
    const r = await eroeffneProjekt(pool, v.id, { stammnummer: 7001, jahr: 2026, heute, benutzer: 'ml' });
    expect(r.projekt).toMatchObject({ nummer: '7001.26', name: 'Tailor-made Fuehrung', bereich: 'Leadership' });
    expect(r.verkaufschance).toMatchObject({ phase: 'gewonnen', wahrscheinlichkeit: 100, projektId: r.projekt.id, abgeschlossenAm: heute });
    const ag = await pool.query('select organisation_id from auftraggeber where id=$1', [r.projekt.auftraggeberId]);
    expect(ag.rows[0].organisation_id).toBe(org.id);
    expect((await listAudit(pool, 'verkaufschance', v.id)).map((a) => a.aktion)).toEqual(['verkaufschance.gewonnen']);
    await expect(eroeffneProjekt(pool, v.id, { stammnummer: 7002, jahr: 2026, heute })).rejects.toBeInstanceOf(ConflictError);
  });
  it('400 ohne verknuepften Auftraggeber, 409 bei verloren, 400 bei fehlender Stammnummer', async () => {
    const ohne = await createVerkaufschance(pool, { titel: 'Ohne', organisationId: orgOhneDebitor.id });
    await expect(eroeffneProjekt(pool, ohne.id, { stammnummer: 7003, jahr: 2026, heute })).rejects.toThrow(/Auftraggeber/);
    await expect(eroeffneProjekt(pool, ohne.id, { stammnummer: 7003, jahr: 2026, heute })).rejects.toBeInstanceOf(ValidationError);
    const v = await createVerkaufschance(pool, { titel: 'Verloren', organisationId: org.id });
    await expect(eroeffneProjekt(pool, v.id, { jahr: 2026, heute } as any)).rejects.toBeInstanceOf(ValidationError);
    await setzePhase(pool, v.id, { phase: 'verloren', verlustgrund: 'kein Budget', heute });
    await expect(eroeffneProjekt(pool, v.id, { stammnummer: 7004, jahr: 2026, heute })).rejects.toBeInstanceOf(ConflictError);
  });
  it('Projektnummer schon vergeben -> Fehler, Verkaufschance unveraendert', async () => {
    const v = await createVerkaufschance(pool, { titel: 'Doppelt', organisationId: org.id });
    await expect(eroeffneProjekt(pool, v.id, { stammnummer: 6231, jahr: 2026, heute })).rejects.toMatchObject({ code: '23505' });
    expect(await getVerkaufschance(pool, v.id)).toMatchObject({ phase: 'lead', projektId: null });
  });
});

describe('verkaufschance: Pipeline', () => {
  it('aggregiert aus der DB (Summe je Phase stimmt mit Liste ueberein)', async () => {
    const p = await ladePipeline(pool);
    const alle = await listVerkaufschancen(pool, {});
    expect(p.phasen.reduce((s, x) => s + x.anzahl, 0)).toBe(alle.length);
    const lead = alle.filter((x) => x.phase === 'lead');
    expect(p.phasen[0]).toMatchObject({ phase: 'lead', anzahl: lead.length, summeChf: lead.reduce((s, x) => s + (x.wertChf ?? 0), 0) });
    expect(p.phasen.find((x) => x.phase === 'gewonnen')).toMatchObject({ anzahl: 1, summeChf: 30000, gewichtetChf: 30000 });
    expect(p.forecast.find((f) => f.monat === '2026-12')).toMatchObject({ anzahl: 1, summeChf: 48000.46, gewichtetChf: 4800.05 });
    expect((await ladePipeline(pool, { verantwortlichId: base.ml.id })).offen).toEqual({ anzahl: 1, summeChf: 48000.46, gewichtetChf: 4800.05 });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createMitarbeitende, findMitarbeitendeByKuerzel } from '../src/repos/mitarbeitendeRepo';
import { createKontakt, findOrCreateKontaktByEmail, updateKontakt } from '../src/repos/kontaktRepo';
import { createReferent } from '../src/repos/referentRepo';
import { createEinsatz, setEinsatzStatus } from '../src/repos/einsatzRepo';
import { istUeberbucht } from '../src/domain/einsatz';
import { ConflictError, ValidationError } from '../src/domain/errors';
import { buildApp } from '../src/server/app';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

describe('mitarbeitende', () => {
  it('normalisiert das Kuerzel und findet es wieder', async () => {
    await createMitarbeitende(pool, { kuerzel: 'PH', nachname: 'Huber' });
    expect((await findMitarbeitendeByKuerzel(pool, 'ph'))?.nachname).toBe('Huber');
  });
  it('lehnt ungueltige Kuerzel ab', async () => {
    await expect(createMitarbeitende(pool, { kuerzel: 'x1', nachname: 'Y' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('kontakt (Basis)', () => {
  it('verhindert Dubletten ueber E-Mail (case-insensitiv)', async () => {
    await createKontakt(pool, { nachname: 'Keller', vorname: 'Tamara', email: 'T.Keller@akb.test' });
    await expect(createKontakt(pool, { nachname: 'Keller', email: 't.keller@akb.test' })).rejects.toBeInstanceOf(ConflictError);
  });
  it('findOrCreate ergaenzt leere Felder, ueberschreibt aber nichts', async () => {
    const a = await findOrCreateKontaktByEmail(pool, { nachname: 'Wuest', email: 'f.wuest@akb.test' });
    expect(a.neu).toBe(true);
    const b = await findOrCreateKontaktByEmail(pool, { nachname: 'Anders', vorname: 'Fabiana', telefon: '+41 62 000 00 00', email: 'F.WUEST@akb.test' });
    expect(b.neu).toBe(false);
    expect(b.kontakt.id).toBe(a.kontakt.id);
    expect(b.kontakt.nachname).toBe('Wuest');
    expect(b.kontakt.vorname).toBe('Fabiana');
  });
  it('stempelt die Newsletter-Einwilligung (nDSG) und loescht sie beim Opt-out', async () => {
    const k = await createKontakt(pool, { nachname: 'Opt', email: 'opt@x.test', newsletter: true, einwilligungQuelle: 'homepage' });
    expect(k.einwilligungAm).not.toBeNull();
    const aus = await updateKontakt(pool, k.id, { newsletter: false });
    expect(aus.einwilligungAm).toBeNull();
  });
});

describe('referent + einsatz', () => {
  it('erkennt Ueberbuchung (max. 1 Tag pro Datum)', () => {
    expect(istUeberbucht(0.5, 0.5)).toBe(false);
    expect(istUeberbucht(0.5, 0.75)).toBe(true);
  });
  it('blockiert Doppelbuchung, erlaubt Halbtage und gibt bei Absage frei', async () => {
    const ref = await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id, tagessatzChf: 2000, halbtagessatzChf: 1100 });
    expect(ref.anzeigename).toBe('Markus Muster');
    const vm = await createEinsatz(pool, { referentId: ref.id, projektId: base.projekt.id, datum: '2026-11-10', dauerTage: 0.5 });
    expect(vm.honorarChf).toBe(1100);
    await createEinsatz(pool, { referentId: ref.id, projektId: base.projekt.id, datum: '2026-11-10', dauerTage: 0.5 });
    await expect(createEinsatz(pool, { referentId: ref.id, projektId: base.projekt.id, datum: '2026-11-10', dauerTage: 0.5 }))
      .rejects.toBeInstanceOf(ConflictError);
    await setEinsatzStatus(pool, vm.id, 'abgesagt');
    const neu = await createEinsatz(pool, { referentId: ref.id, projektId: base.projekt.id, datum: '2026-11-10', dauerTage: 0.5 });
    expect(neu.status).toBe('angefragt');
    await expect(setEinsatzStatus(pool, vm.id, 'bestaetigt')).rejects.toBeInstanceOf(ConflictError);
  });
  it('externe Referent:innen brauchen einen CRM-Kontakt', async () => {
    await expect(createReferent(pool, { typ: 'extern' })).rejects.toBeInstanceOf(ValidationError);
    const k = await createKontakt(pool, { vorname: 'Eva', nachname: 'Extern', email: 'eva@extern.test' });
    expect((await createReferent(pool, { typ: 'extern', kontaktId: k.id, fachgebiete: ['Leadership'] })).anzeigename).toBe('Eva Extern');
  });
});

describe('personal-routes', () => {
  it('POST /mitarbeitende nur Admin, 409 bei doppeltem Kuerzel', async () => {
    const app = buildApp(pool); await app.ready();
    const body = { kuerzel: 'ab', nachname: 'Beispiel' };
    expect((await app.inject({ method: 'POST', url: '/mitarbeitende', payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/mitarbeitende', headers: { 'x-user-role': 'admin' }, payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/mitarbeitende', headers: { 'x-user-role': 'admin' }, payload: body })).statusCode).toBe(409);
    await app.close();
  });
});

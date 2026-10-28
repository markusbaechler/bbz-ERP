import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createAnfrage, getAnfrage, listAnfragen, uebernehmeAnfrage, verwerfeAnfrage } from '../src/repos/anfrageRepo';
import { createKontakt, getKontakt, findKontaktByEmail } from '../src/repos/kontaktRepo';
import { createOrganisation } from '../src/repos/organisationRepo';
import { listAktivitaeten } from '../src/repos/aktivitaetRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ValidationError, ConflictError, NotFoundError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

const zaehle = async (sql: string, args: unknown[] = []) => (await pool.query(`select count(*)::int as n from ${sql}`, args)).rows[0].n as number;

describe('anfrage: Eingang (createAnfrage, auch fuer Homepage)', () => {
  it('legt mit Defaults an und normalisiert', async () => {
    const a = await createAnfrage(pool, { vorname: 'Lea', nachname: ' Graf ', email: 'Lea.Graf@Bank.test', nachricht: 'Bitte Offerte', payload: { formular: 'kontakt' } });
    expect(a).toMatchObject({ quelle: 'homepage', typ: 'kontakt', status: 'neu', nachname: 'Graf', email: 'lea.graf@bank.test', newsletter: false, einwilligung: false, payload: { formular: 'kontakt' }, kontaktId: null, erledigtAm: null });
    expect(Date.parse(a.eingegangenAm)).toBeGreaterThan(0);
  });
  it('verlangt E-Mail oder Telefon, Einwilligung bei Newsletter, gueltige Wertelisten', async () => {
    await expect(createAnfrage(pool, { nachname: 'Niemand' })).rejects.toThrow(/email oder telefon/);
    expect((await createAnfrage(pool, { nachname: 'Tel', telefon: '+41 71 000 00 00', quelle: 'telefon', typ: 'rueckruf' })).typ).toBe('rueckruf');
    await expect(createAnfrage(pool, { email: 'nl@x.test', newsletter: true })).rejects.toThrow(/Einwilligung/);
    await expect(createAnfrage(pool, { email: 'nl@x.test', typ: 'newsletter' })).rejects.toThrow(/Einwilligung/);
    expect((await createAnfrage(pool, { email: 'nl@x.test', typ: 'newsletter', einwilligung: true })).newsletter).toBe(true);
    await expect(createAnfrage(pool, { email: 'x@x.test', typ: 'spam' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAnfrage(pool, { email: 'x@x.test', quelle: 'fax' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAnfrage(pool, { email: 'kaputt' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAnfrage(pool, { email: 'x@x.test', payload: [1, 2] as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAnfrage(pool, { email: 'x@x.test', nachricht: 'x'.repeat(10001) })).rejects.toBeInstanceOf(ValidationError);
  });
  it('listet nach Status (neueste zuerst)', async () => {
    const l = await listAnfragen(pool, { status: 'neu' });
    expect(l.length).toBe(3);
    expect(l[0].eingegangenAm >= l[l.length - 1].eingegangenAm).toBe(true);
    await expect(listAnfragen(pool, { status: 'unsinn' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('anfrage: uebernehmen (eine Transaktion)', () => {
  it('neuer Kontakt + neue Organisation + Verkaufschance + Newsletter-Einwilligung', async () => {
    const a = await createAnfrage(pool, {
      quelle: 'homepage', typ: 'offerte', anrede: 'Frau', vorname: 'Mia', nachname: 'Studer', email: 'mia.studer@lukb.test',
      organisationName: 'Luzerner KB', funktion: 'Leiterin HR', interesse: 'tailormade', nachricht: 'Fuehrungslehrgang fuer 12 Personen',
      newsletter: true, einwilligung: true,
    });
    const r = await uebernehmeAnfrage(pool, a.id, {
      organisationNeu: { klassifizierung: 'A' } as any, verkaufschance: { titel: 'Fuehrungslehrgang LUKB', wertChf: 36000, bereich: 'Leadership' },
      bearbeitetDurchId: base.ml.id, benutzer: 'ml',
    });
    expect(r.kontaktNeu).toBe(true);
    expect(r.organisation).toMatchObject({ name: 'Luzerner KB', klassifizierung: 'A' });
    expect(r.kontakt).toMatchObject({ nachname: 'Studer', vorname: 'Mia', anrede: 'Frau', funktion: 'Leiterin HR', organisationId: r.organisation!.id,
      interessen: ['tailormade'], newsletter: true, einwilligungQuelle: `anfrage:${a.id}`, betreuerId: base.ml.id });
    expect(r.kontakt.einwilligungAm).not.toBeNull();
    expect(r.verkaufschance).toMatchObject({ titel: 'Fuehrungslehrgang LUKB', phase: 'lead', wertChf: 36000, bereich: 'Leadership',
      organisationId: r.organisation!.id, kontaktId: r.kontakt.id, verantwortlichId: base.ml.id, quelle: 'homepage' });
    expect(r.anfrage).toMatchObject({ status: 'uebernommen', kontaktId: r.kontakt.id, verkaufschanceId: r.verkaufschance!.id, bearbeitetDurchId: base.ml.id });
    expect(r.anfrage.erledigtAm).not.toBeNull();
    const akt = await listAktivitaeten(pool, { kontaktId: r.kontakt.id });
    expect(akt).toHaveLength(1);
    expect(akt[0]).toMatchObject({ typ: 'notiz', notizen: 'Fuehrungslehrgang fuer 12 Personen', organisationId: r.organisation!.id, verkaufschanceId: r.verkaufschance!.id, datum: a.eingegangenAm });
    const audit = await listAudit(pool, 'anfrage', a.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ benutzer: 'ml', aktion: 'anfrage.uebernommen', details: { kontaktId: r.kontakt.id, kontaktNeu: true } });
    await expect(uebernehmeAnfrage(pool, a.id, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it('bestehender Kontakt (E-Mail-Dublettenschutz): ergaenzt Organisation, Interesse und Newsletter, ueberschreibt nichts', async () => {
    const org = await createOrganisation(pool, { name: 'Thurgauer KB' });
    const k = await createKontakt(pool, { nachname: 'Brunner', vorname: 'Reto', email: 'reto.brunner@tkb.test', interessen: ['weiterbildung'] });
    const a = await createAnfrage(pool, { nachname: 'Bruner', vorname: 'R.', email: 'RETO.BRUNNER@tkb.test', interesse: 'zertifizierung', newsletter: true, einwilligung: true, quelle: 'email' });
    const r = await uebernehmeAnfrage(pool, a.id, { organisationId: org.id });
    expect(r.kontaktNeu).toBe(false);
    expect(r.kontakt).toMatchObject({ id: k.id, nachname: 'Brunner', vorname: 'Reto', organisationId: org.id, interessen: ['weiterbildung', 'zertifizierung'], newsletter: true, einwilligungQuelle: `anfrage:${a.id}` });
    expect(r.verkaufschance).toBeNull();
    expect(r.anfrage.bearbeitetDurchId).toBeNull();
    expect((await listAktivitaeten(pool, { kontaktId: k.id }))[0].typ).toBe('email');
  });

  it('nur Telefon (ohne E-Mail) -> neuer Kontakt; fehlender Nachname kann mitgegeben werden', async () => {
    const a = await createAnfrage(pool, { telefon: '+41 79 111 22 33', quelle: 'telefon', typ: 'rueckruf', anrede: 'Mx' });
    await expect(uebernehmeAnfrage(pool, a.id, {})).rejects.toThrow(/Nachname/);
    const r = await uebernehmeAnfrage(pool, a.id, { kontakt: { nachname: 'Anrufer' } });
    expect(r.kontakt).toMatchObject({ nachname: 'Anrufer', telefon: '+41 79 111 22 33', email: null, anrede: null, organisationId: null, newsletter: false });
  });

  it('Verkaufschance ohne Organisation -> 400 und nichts angelegt', async () => {
    const a = await createAnfrage(pool, { nachname: 'Ohneorg', email: 'ohneorg@x.test' });
    await expect(uebernehmeAnfrage(pool, a.id, { verkaufschance: { titel: 'X' } })).rejects.toThrow(/Organisation/);
    expect(await findKontaktByEmail(pool, 'ohneorg@x.test')).toBeNull();
    expect((await getAnfrage(pool, a.id)).status).toBe('neu');
  });

  it('Rollback: Fehler nach Anlage von Organisation und Kontakt hinterlaesst keine Daten', async () => {
    const a = await createAnfrage(pool, { nachname: 'Rollback', email: 'rollback@x.test', organisationName: 'Rollback Bank', newsletter: true, einwilligung: true });
    const vorher = await zaehle('organisation');
    await expect(uebernehmeAnfrage(pool, a.id, { organisationNeu: {} as any, verkaufschance: { titel: 'X', wertChf: -5 } })).rejects.toBeInstanceOf(ValidationError);
    expect(await zaehle('organisation')).toBe(vorher);
    expect(await findKontaktByEmail(pool, 'rollback@x.test')).toBeNull();
    expect(await zaehle(`audit_log where entitaet='anfrage' and entitaet_id=$1`, [a.id])).toBe(0);
    expect(await getAnfrage(pool, a.id)).toMatchObject({ status: 'neu', kontaktId: null, erledigtAm: null });
  });

  it('organisationId und organisationNeu zugleich -> 400; unbekannte Organisation -> 404', async () => {
    const a = await createAnfrage(pool, { nachname: 'Beides', email: 'beides@x.test' });
    await expect(uebernehmeAnfrage(pool, a.id, { organisationId: base.ml.id, organisationNeu: { name: 'X' } })).rejects.toBeInstanceOf(ValidationError);
    await expect(uebernehmeAnfrage(pool, a.id, { organisationId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(uebernehmeAnfrage(pool, '00000000-0000-0000-0000-000000000000', {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('anfrage: verwerfen', () => {
  it('setzt verworfen (mit Grund); danach weder verwerfen noch uebernehmen (409)', async () => {
    const a = await createAnfrage(pool, { email: 'spam@x.test', nachricht: 'Werbung' });
    const v = await verwerfeAnfrage(pool, a.id, { grund: 'Spam', bearbeitetDurchId: base.ml.id, benutzer: 'ml' });
    expect(v).toMatchObject({ status: 'verworfen', bearbeitetDurchId: base.ml.id, payload: { verwerfgrund: 'Spam' } });
    expect(v.erledigtAm).not.toBeNull();
    await expect(verwerfeAnfrage(pool, a.id, {})).rejects.toBeInstanceOf(ConflictError);
    await expect(uebernehmeAnfrage(pool, a.id, {})).rejects.toBeInstanceOf(ConflictError);
    expect((await listAudit(pool, 'anfrage', a.id)).map((x) => x.aktion)).toEqual(['anfrage.verworfen']);
    await expect(verwerfeAnfrage(pool, '00000000-0000-0000-0000-000000000000', {})).rejects.toBeInstanceOf(NotFoundError);
  });
  it('kann eine in Bearbeitung befindliche Anfrage uebernehmen', async () => {
    const a = await createAnfrage(pool, { nachname: 'Inbearbeitung', email: 'ib@x.test' });
    await pool.query(`update anfrage set status='in_bearbeitung' where id=$1`, [a.id]);
    expect((await uebernehmeAnfrage(pool, a.id, {})).anfrage.status).toBe('uebernommen');
    expect((await getKontakt(pool, (await getAnfrage(pool, a.id)).kontaktId!)).nachname).toBe('Inbearbeitung');
  });
});

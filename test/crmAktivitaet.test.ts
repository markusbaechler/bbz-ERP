import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createAktivitaet, listAktivitaeten, deleteAktivitaet, getAktivitaet } from '../src/repos/aktivitaetRepo';
import { createOrganisation } from '../src/repos/organisationRepo';
import { createKontakt } from '../src/repos/kontaktRepo';
import { ValidationError, NotFoundError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
let org: { id: string }; let kontakt: { id: string }; let privat: { id: string };
beforeAll(async () => {
  await resetDb(pool); base = await grundbestand(pool);
  org = await createOrganisation(pool, { name: 'Aktivbank' });
  kontakt = await createKontakt(pool, { nachname: 'Aktiv', organisationId: org.id });
  privat = await createKontakt(pool, { nachname: 'Privat' });
});
afterAll(async () => { await closePool(); });

describe('aktivitaet', () => {
  it('leitet die Organisation aus dem Kontakt ab', async () => {
    const a = await createAktivitaet(pool, { typ: 'telefon', betreff: ' Erstgespraech ', kontaktId: kontakt.id, mitarbeitendeId: base.ml.id, datum: '2026-10-01T09:00:00Z' });
    expect(a).toMatchObject({ typ: 'telefon', betreff: 'Erstgespraech', kontaktId: kontakt.id, organisationId: org.id, mitarbeitendeId: base.ml.id, datum: '2026-10-01T09:00:00.000Z' });
  });
  it('Privatkontakt ohne Organisation ist erlaubt; Default-Datum = jetzt', async () => {
    const a = await createAktivitaet(pool, { typ: 'notiz', betreff: 'Privat', kontaktId: privat.id });
    expect(a.organisationId).toBeNull();
    expect(Math.abs(Date.parse(a.datum) - Date.now())).toBeLessThan(60_000);
  });
  it('validiert Typ, Betreff, Bezug und Datum', async () => {
    await expect(createAktivitaet(pool, { typ: 'fax' as any, betreff: 'x', organisationId: org.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAktivitaet(pool, { typ: 'email', betreff: '', organisationId: org.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAktivitaet(pool, { typ: 'email', betreff: 'x' })).rejects.toThrow(/kontaktId oder organisationId/);
    await expect(createAktivitaet(pool, { typ: 'email', betreff: 'x', organisationId: org.id, datum: 'gestern' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAktivitaet(pool, { typ: 'email', betreff: 'x', kontaktId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('filtert (Organisation inkl. Kontakte, Zeitraum, Projekt, Mitarbeitende) und sortiert absteigend', async () => {
    await createAktivitaet(pool, { typ: 'meeting', betreff: 'Org direkt', organisationId: org.id, datum: '2026-10-05T10:00:00Z', projektId: base.projekt.id });
    await createAktivitaet(pool, { typ: 'email', betreff: 'Spaet', organisationId: org.id, datum: '2026-10-31T23:30:00Z' }); // 1.11. 00:30 in Zuerich (MEZ)
    const alle = await listAktivitaeten(pool, { organisationId: org.id });
    expect(alle.map((a) => a.betreff)).toEqual(['Spaet', 'Org direkt', 'Erstgespraech']);
    expect((await listAktivitaeten(pool, { kontaktId: kontakt.id })).map((a) => a.betreff)).toEqual(['Erstgespraech']);
    expect((await listAktivitaeten(pool, { projektId: base.projekt.id })).map((a) => a.betreff)).toEqual(['Org direkt']);
    expect((await listAktivitaeten(pool, { mitarbeitendeId: base.ml.id })).map((a) => a.betreff)).toEqual(['Erstgespraech']);
    expect((await listAktivitaeten(pool, { organisationId: org.id, von: '2026-10-02', bis: '2026-10-31' })).map((a) => a.betreff)).toEqual(['Org direkt']);
    expect((await listAktivitaeten(pool, { organisationId: org.id, von: '2026-11-01' })).map((a) => a.betreff)).toEqual(['Spaet']);
    await expect(listAktivitaeten(pool, { von: '1.1.2026' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('loescht; 404 fuer Unbekannte', async () => {
    const a = await createAktivitaet(pool, { typ: 'notiz', betreff: 'weg', organisationId: org.id });
    await deleteAktivitaet(pool, a.id);
    await expect(getAktivitaet(pool, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAktivitaet(pool, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

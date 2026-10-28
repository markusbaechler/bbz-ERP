import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import {
  createOrganisation, getOrganisation, updateOrganisation, listOrganisationen,
  verknuepfeAuftraggeber, findAuftraggeberFuerOrganisation,
} from '../src/repos/organisationRepo';
import { createKontakt, updateKontakt } from '../src/repos/kontaktRepo';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { ValidationError, NotFoundError, ConflictError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); });
afterAll(async () => { await closePool(); });

describe('organisation: CRUD', () => {
  it('legt an mit Defaults und normalisiert Texte', async () => {
    const o = await createOrganisation(pool, { name: '  Zuger Kantonalbank ', klassifizierung: 'A', email: 'Info@ZugerKB.test', betreuerId: base.ml.id });
    expect(o).toMatchObject({ name: 'Zuger Kantonalbank', kategorie: 'kunde', klassifizierung: 'A', vip: false, land: 'CH', email: 'info@zugerkb.test', archiviert: false });
    expect((await getOrganisation(pool, o.id)).betreuerId).toBe(base.ml.id);
  });
  it('validiert Pflichtfeld und Wertelisten', async () => {
    await expect(createOrganisation(pool, { name: ' ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrganisation(pool, { name: 'X', kategorie: 'feind' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrganisation(pool, { name: 'X', klassifizierung: 'D' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrganisation(pool, { name: 'X', email: 'kein-mail' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrganisation(pool, { name: 42 as any })).rejects.toBeInstanceOf(ValidationError);
  });
  it('PATCH aendert nur uebergebene Felder; 404 fuer Unbekannte', async () => {
    const o = await createOrganisation(pool, { name: 'Bank Alpha', ort: 'Zug', branche: 'Privatbank' });
    const p = await updateOrganisation(pool, o.id, { ort: 'Baar', klassifizierung: null });
    expect(p).toMatchObject({ name: 'Bank Alpha', ort: 'Baar', branche: 'Privatbank', klassifizierung: null });
    await expect(updateOrganisation(pool, o.id, { name: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganisation(pool, '00000000-0000-0000-0000-000000000000', { ort: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('organisation: Liste', () => {
  it('liefert kontakteAnzahl und letzteAktivitaet (direkt oder ueber Kontakte), filtert', async () => {
    const o = await createOrganisation(pool, { name: 'Listenbank', kategorie: 'interessent', klassifizierung: 'B', ort: 'Luzern' });
    const k1 = await createKontakt(pool, { nachname: 'Eins', organisationId: o.id });
    const k2 = await createKontakt(pool, { nachname: 'Zwei', organisationId: o.id });
    await updateKontakt(pool, k2.id, { archiviert: true });
    await pool.query(`insert into aktivitaet(typ,betreff,datum,organisation_id) values ('telefon','A','2026-01-10T10:00:00Z',$1)`, [o.id]);
    await pool.query(`insert into aktivitaet(typ,betreff,datum,kontakt_id) values ('email','B','2026-03-05T08:00:00Z',$1)`, [k1.id]);
    const archiviert = await createOrganisation(pool, { name: 'Listenbank Alt' });
    await updateOrganisation(pool, archiviert.id, { archiviert: true });

    const l = await listOrganisationen(pool, { suche: 'listen' });
    expect(l.map((x) => x.name)).toEqual(['Listenbank']);
    expect(l[0].kontakteAnzahl).toBe(1);
    expect(l[0].letzteAktivitaet).toBe('2026-03-05T08:00:00.000Z');
    expect((await listOrganisationen(pool, { suche: 'listen', inklArchiviert: true })).length).toBe(2);
    expect((await listOrganisationen(pool, { kategorie: 'interessent' })).map((x) => x.name)).toEqual(['Listenbank']);
    expect((await listOrganisationen(pool, { klassifizierung: 'B' })).map((x) => x.name)).toEqual(['Listenbank']);
    expect((await listOrganisationen(pool, { suche: 'luzern' })).map((x) => x.name)).toEqual(['Listenbank']);
    const ohne = await listOrganisationen(pool, { klassifizierung: 'ohne' });
    expect(ohne.every((x) => x.klassifizierung === null)).toBe(true);
    expect(ohne.find((x) => x.name === 'Listenbank')).toBeUndefined();
  });
  it('filtert nach Betreuer', async () => {
    const l = await listOrganisationen(pool, { betreuerId: base.ml.id });
    expect(l.map((x) => x.name)).toEqual(['Zuger Kantonalbank']);
  });
});

describe('organisation -> auftraggeber (Debitor)', () => {
  it('verlangt eine vollstaendige Adresse (QR-Regel) mit klarer Meldung', async () => {
    const o = await createOrganisation(pool, { name: 'Ohne Adresse AG', strasse: 'Weg 1' });
    await expect(verknuepfeAuftraggeber(pool, o.id, {})).rejects.toThrow(/plz, ort/);
    await expect(verknuepfeAuftraggeber(pool, o.id, {})).rejects.toBeInstanceOf(ValidationError);
  });
  it('erzeugt den Auftraggeber aus der Adresse, verknuepft ihn und verhindert Doppelverknuepfung (409)', async () => {
    const o = await createOrganisation(pool, { name: 'Schwyzer KB', strasse: 'Bahnhofstrasse 3', plz: '6430', ort: 'Schwyz', email: 'info@szkb.test', telefon: '058 800 20 20' });
    const a = await verknuepfeAuftraggeber(pool, o.id, { nummer: '30001' });
    expect(a).toMatchObject({ nummer: '30001', name: 'Schwyzer KB', strasse: 'Bahnhofstrasse 3', plz: '6430', ort: 'Schwyz', land: 'CH', email: 'info@szkb.test' });
    expect((await findAuftraggeberFuerOrganisation(pool, o.id))?.id).toBe(a.id);
    await expect(verknuepfeAuftraggeber(pool, o.id, {})).rejects.toBeInstanceOf(ConflictError);
  });
  it('verknuepft einen bestehenden Auftraggeber (nicht doppelt)', async () => {
    const o = await createOrganisation(pool, { name: 'Urner KB (CRM)' });
    const a = await verknuepfeAuftraggeber(pool, o.id, { auftraggeberId: base.auftraggeber.id });
    expect(a.id).toBe(base.auftraggeber.id);
    const o2 = await createOrganisation(pool, { name: 'Andere' });
    await expect(verknuepfeAuftraggeber(pool, o2.id, { auftraggeberId: base.auftraggeber.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(verknuepfeAuftraggeber(pool, o2.id, { auftraggeberId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('raeumt bei Fehlschlag auf (doppelte Auftraggeber-Nummer -> kein Waisen-Debitor)', async () => {
    await createAuftraggeber(pool, { nummer: '30099', name: 'Belegt', strasse: 'S 1', plz: '1000', ort: 'L' });
    const o = await createOrganisation(pool, { name: 'Nummernkonflikt AG', strasse: 'Weg 2', plz: '8000', ort: 'Zuerich' });
    await expect(verknuepfeAuftraggeber(pool, o.id, { nummer: '30099' })).rejects.toMatchObject({ code: '23505' });
    expect(await findAuftraggeberFuerOrganisation(pool, o.id)).toBeNull();
    expect((await pool.query(`select count(*)::int as n from auftraggeber where name='Nummernkonflikt AG'`)).rows[0].n).toBe(0);
  });
  it('404 fuer unbekannte Organisation', async () => {
    await expect(verknuepfeAuftraggeber(pool, '00000000-0000-0000-0000-000000000000', {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

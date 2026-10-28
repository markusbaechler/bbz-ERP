import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { bildungsbestand, angebot } from './bildungFixtures';
import {
  createKursangebot, getKursangebot, listKursangebote, updateKursangebot,
} from '../src/repos/kursangebotRepo';
import {
  createDurchfuehrung, getDurchfuehrung, listDurchfuehrungen, updateDurchfuehrung, setDurchfuehrungStatus,
  addKurstag, deleteKurstag, referentZuweisen,
} from '../src/repos/durchfuehrungRepo';
import { createReferent } from '../src/repos/referentRepo';
import { listOutbox } from '../src/repos/outboxRepo';
import { listAudit } from '../src/repos/auditRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof bildungsbestand>>;
beforeAll(async () => { await resetDb(pool); base = await bildungsbestand(pool); });
afterAll(async () => { await closePool(); });

describe('kursangebot', () => {
  it('legt ein Angebot an, Slug aus dem Titel', async () => {
    const a = await createKursangebot(pool, {
      code: 'BEF', titel: 'Eigenheimfinanzierung für Kundenberater', bereich: 'Banking', format: 'blended',
      lernstunden: 16, preisChf: 1450, ertragskontoId: base.konto.id, saqAnerkannt: true,
    });
    expect(a).toMatchObject({ code: 'BEF', slug: 'eigenheimfinanzierung-fuer-kundenberater', format: 'blended',
      lernstunden: 16, preisChf: 1450, mwstSatz: 0, aktiv: true, oeffentlich: false });
    expect((await getKursangebot(pool, a.id)).titel).toBe('Eigenheimfinanzierung für Kundenberater');
  });
  it('Code eindeutig (409), automatischer Slug wird bei Kollision nummeriert', async () => {
    await expect(createKursangebot(pool, { code: 'BEF', titel: 'X', bereich: 'Banking' })).rejects.toBeInstanceOf(ConflictError);
    const b = await createKursangebot(pool, { code: 'BEF2', titel: 'Eigenheimfinanzierung für Kundenberater', bereich: 'Banking' });
    expect(b.slug).toBe('eigenheimfinanzierung-fuer-kundenberater-2');
    await expect(createKursangebot(pool, { code: 'BEF3', titel: 'Y', bereich: 'Banking', slug: 'eigenheimfinanzierung-fuer-kundenberater' }))
      .rejects.toBeInstanceOf(ConflictError);
  });
  it('validiert Pflichtfelder und Format', async () => {
    await expect(createKursangebot(pool, { code: '', titel: 'X', bereich: 'B' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createKursangebot(pool, { code: 'A B', titel: 'X', bereich: 'B' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createKursangebot(pool, { code: 'ZZ', titel: ' ', bereich: 'B' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createKursangebot(pool, { code: 'ZZ', titel: 'X', bereich: 'B', format: 'fernkurs' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createKursangebot(pool, { code: 'ZZ', titel: 'X', bereich: 'B', preisChf: -1 })).rejects.toBeInstanceOf(ValidationError);
  });
  it('PATCH aendert Felder, Slug bleibt stabil, expliziter Slug wird normalisiert', async () => {
    const a = await createKursangebot(pool, { code: 'LEA', titel: 'Leadership Basis', bereich: 'Leadership' });
    const u = await updateKursangebot(pool, a.id, { titel: 'Leadership Grundlagen', oeffentlich: true, preisChf: 900 });
    expect(u).toMatchObject({ titel: 'Leadership Grundlagen', slug: 'leadership-basis', oeffentlich: true, preisChf: 900 });
    expect((await updateKursangebot(pool, a.id, { slug: 'Führung Basis' })).slug).toBe('fuehrung-basis');
    await expect(updateKursangebot(pool, a.id, { code: 'BEF' })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateKursangebot(pool, '00000000-0000-0000-0000-000000000000', { titel: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('listet mit Filtern', async () => {
    const leadership = await listKursangebote(pool, { bereich: 'Leadership' });
    expect(leadership.map((x) => x.code)).toEqual(['LEA']);
    expect((await listKursangebote(pool, { oeffentlich: true })).map((x) => x.code)).toEqual(['LEA']);
    await updateKursangebot(pool, leadership[0].id, { aktiv: false });
    expect((await listKursangebote(pool, { aktiv: true })).some((x) => x.code === 'LEA')).toBe(false);
  });
});

describe('durchfuehrung', () => {
  it('Code {ANGEBOT}-{JAHR}-{n}, Kurstage je Werktag', async () => {
    const a = await angebot(pool, { code: 'KBI' });
    const d1 = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-06', endDatum: '2026-11-10', ort: 'St. Gallen' });
    expect(d1.code).toBe('KBI-2026-1');
    expect(d1.kurstage.map((k) => k.datum)).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
    expect(d1.belegung).toEqual({ kapazitaet: 16, aktiv: 0, warteliste: 0, frei: 16 });
    expect(d1.kursangebotCode).toBe('KBI');
    const d2 = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-12-01', endDatum: '2026-12-01' });
    expect(d2.code).toBe('KBI-2026-2');
    const d3 = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2027-01-12', endDatum: '2027-01-12' });
    expect(d3.code).toBe('KBI-2027-1');
  });
  it('Nummer beruecksichtigt auch Codes eines umbenannten Angebots mit gleichem Kuerzel', async () => {
    const alt = await angebot(pool, { code: 'REN' });
    await createDurchfuehrung(pool, { kursangebotId: alt.id, startDatum: '2026-11-02', endDatum: '2026-11-02' });
    await updateKursangebot(pool, alt.id, { code: 'REN-ALT' });
    const neu = await angebot(pool, { code: 'REN' });
    expect((await createDurchfuehrung(pool, { kursangebotId: neu.id, startDatum: '2026-11-03', endDatum: '2026-11-03' })).code).toBe('REN-2026-2');
  });
  it('vergibt Codes auch bei parallelen Anlagen eindeutig', async () => {
    const a = await angebot(pool, { code: 'PAR' });
    const ds = await Promise.all([1, 2, 3, 4].map(() =>
      createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-02' })));
    expect(ds.map((d) => d.code).sort()).toEqual(['PAR-2026-1', 'PAR-2026-2', 'PAR-2026-3', 'PAR-2026-4']);
  });
  it('Kurstage aus Liste (mit Zeiten), leere Liste = keine Kurstage', async () => {
    const a = await angebot(pool);
    const d = await createDurchfuehrung(pool, {
      kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-20',
      kurstage: [{ datum: '2026-11-02', von: '08:30', bis: '17:00', thema: 'Einstieg' }, { datum: '2026-11-20', von: '08:30', bis: '12:00' }],
    });
    expect(d.kurstage).toEqual([
      expect.objectContaining({ datum: '2026-11-02', von: '08:30', bis: '17:00', thema: 'Einstieg' }),
      expect.objectContaining({ datum: '2026-11-20', von: '08:30', bis: '12:00' }),
    ]);
    const leer = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-03', kurstage: [] });
    expect(leer.kurstage).toEqual([]);
    await expect(createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-03',
      kurstage: [{ datum: '2026-11-04' }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-03', endDatum: '2026-11-02' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-02',
      kurstage: [{ datum: '2026-11-02', von: '17:00', bis: '08:00' }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createDurchfuehrung(pool, { kursangebotId: '00000000-0000-0000-0000-000000000000', startDatum: '2026-11-02', endDatum: '2026-11-02' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
  it('Statuswechsel: ausgeschrieben verlangt Kurstag, Ereignis kurs.aktualisiert, Audit', async () => {
    const a = await angebot(pool);
    const d = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-02', kurstage: [] });
    await expect(setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben')).rejects.toBeInstanceOf(ConflictError);
    await addKurstag(pool, d.id, { datum: '2026-11-02', von: '09:00', bis: '17:00' });
    const vorher = (await listOutbox(pool, { typ: 'webhook' })).length;
    const s = await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben', 'ml');
    expect(s.status).toBe('ausgeschrieben');
    const hooks = await listOutbox(pool, { typ: 'webhook' });
    expect(hooks.length).toBe(vorher + 1);
    expect(hooks[0].payload).toMatchObject({ ereignis: 'kurs.aktualisiert', daten: { durchfuehrungId: d.id, status: 'ausgeschrieben' } });
    await expect(setDurchfuehrungStatus(pool, d.id, 'durchgefuehrt')).rejects.toBeInstanceOf(ConflictError);
    expect((await listAudit(pool, 'durchfuehrung', d.id))[0]).toMatchObject({ benutzer: 'ml', aktion: 'statuswechsel' });
    // letzter Kurstag einer ausgeschriebenen Durchfuehrung kann nicht geloescht werden
    await expect(deleteKurstag(pool, s.kurstage[0].id)).rejects.toBeInstanceOf(ConflictError);
  });
  it('Liste mit Filtern und Belegung', async () => {
    const a = await angebot(pool, { code: 'LST' });
    await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-02' });
    const d2 = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2027-03-02', endDatum: '2027-03-02' });
    await setDurchfuehrungStatus(pool, d2.id, 'ausgeschrieben');
    const alle = await listDurchfuehrungen(pool, { kursangebotId: a.id });
    expect(alle.map((d) => d.code)).toEqual(['LST-2026-1', 'LST-2027-1']);
    expect(alle[0].belegung.frei).toBe(16);
    expect((await listDurchfuehrungen(pool, { kursangebotId: a.id, von: '2027-01-01' })).map((d) => d.code)).toEqual(['LST-2027-1']);
    expect((await listDurchfuehrungen(pool, { kursangebotId: a.id, bis: '2026-12-31' })).map((d) => d.code)).toEqual(['LST-2026-1']);
    expect((await listDurchfuehrungen(pool, { kursangebotId: a.id, status: 'ausgeschrieben' })).map((d) => d.code)).toEqual(['LST-2027-1']);
  });
  it('PATCH aendert Stammdaten und validiert Zeitraum', async () => {
    const a = await angebot(pool);
    const d = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-03' });
    const u = await updateDurchfuehrung(pool, d.id, { ort: 'Zuerich', kapazitaet: 12, preisChf: 990, anmeldeschluss: '2026-10-20', projektId: base.projekt.id });
    expect(u).toMatchObject({ ort: 'Zuerich', kapazitaet: 12, preisChf: 990, anmeldeschluss: '2026-10-20', projektId: base.projekt.id });
    expect(u.belegung.kapazitaet).toBe(12);
    await expect(updateDurchfuehrung(pool, d.id, { endDatum: '2026-11-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateDurchfuehrung(pool, d.id, { kapazitaet: 0 })).rejects.toBeInstanceOf(ValidationError);
  });
  it('Kurstag hinzufuegen/loeschen', async () => {
    const a = await angebot(pool);
    const d = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-02', endDatum: '2026-11-04', kurstage: [] });
    const k = await addKurstag(pool, d.id, { datum: '2026-11-03', von: '13:30', bis: '17:00', ort: 'Raum 2' });
    expect(k).toMatchObject({ datum: '2026-11-03', von: '13:30', bis: '17:00', ort: 'Raum 2' });
    await expect(addKurstag(pool, d.id, { datum: '2026-11-03', von: '13:30' })).rejects.toBeInstanceOf(ConflictError);
    await expect(addKurstag(pool, d.id, { datum: '2026-11-05' })).rejects.toBeInstanceOf(ValidationError);
    await deleteKurstag(pool, k.id);
    expect((await getDurchfuehrung(pool, d.id)).kurstage).toEqual([]);
    await expect(deleteKurstag(pool, k.id)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('Referent:in am Kurstag -> Einsatz im Projekt der Durchfuehrung, Ueberbuchungsschutz', async () => {
    const a = await angebot(pool);
    const ref = await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id, tagessatzChf: 1800 });
    const ohne = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-16', endDatum: '2026-11-16' });
    await expect(referentZuweisen(pool, ohne.kurstage[0].id, { referentId: ref.id })).rejects.toBeInstanceOf(ValidationError);

    const d = await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2026-11-17', endDatum: '2026-11-18', projektId: base.projekt.id });
    const e = await referentZuweisen(pool, d.kurstage[0].id, { referentId: ref.id, rolle: 'Hauptreferent' });
    expect(e).toMatchObject({ projektId: base.projekt.id, datum: '2026-11-17', kurstagId: d.kurstage[0].id, rolle: 'Hauptreferent', honorarChf: 1800 });
    await expect(referentZuweisen(pool, d.kurstage[0].id, { referentId: ref.id, dauerTage: 0.5 })).rejects.toBeInstanceOf(ConflictError);
    const halb = await referentZuweisen(pool, d.kurstage[1].id, { referentId: ref.id, dauerTage: 0.5 });
    expect(halb.dauerTage).toBe(0.5);
    const detail = await getDurchfuehrung(pool, d.id);
    expect(detail.einsaetze.map((x) => x.datum)).toEqual(['2026-11-17', '2026-11-18']);
    await expect(referentZuweisen(pool, '00000000-0000-0000-0000-000000000000', { referentId: ref.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

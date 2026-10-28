import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { bildungsbestand, angebot, ausgeschrieben } from './bildungFixtures';
import { listOeffentlicheKurse, getOeffentlichenKurs } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';
import { meldeAn, storniereAnmeldung } from '../src/repos/anmeldungRepo';
import { NotFoundError } from '../src/domain/errors';

const pool = getPool();
const heute = '2026-10-28';
let base: Awaited<ReturnType<typeof bildungsbestand>>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDb(pool);
  base = await bildungsbestand(pool);
  const a = await angebot(pool, {
    code: 'BEF', titel: 'Eigenheimfinanzierung', bereich: 'Banking', oeffentlich: true, preisChf: 1450, lernstunden: 16,
    beschreibung: 'Beschreibung', lernziele: 'Ziele', zielgruppe: 'Kundenberater', dauerTage: 2, saqAnerkannt: true, format: 'blended',
  });
  const d1 = await ausgeschrieben(pool, a.id, {
    startDatum: '2026-12-01', endDatum: '2026-12-02', kapazitaet: 3, ort: 'St. Gallen', anmeldeschluss: '2026-11-15',
    projektId: base.projekt.id, leitungId: base.ml.id, moodleKursId: 987654321,
    kurstage: [{ datum: '2026-12-01', von: '08:30', bis: '17:00' }, { datum: '2026-12-02', von: '08:30', bis: '12:00' }],
  });
  ids.d1 = d1.id;
  const x = await meldeAn(pool, d1.id, { kontakt: { email: 'geheim@bank.test', vorname: 'Gerda', nachname: 'Geheimnis' }, rechnungsempfaengerId: base.auftraggeber.id });
  const s = await meldeAn(pool, d1.id, { kontakt: { email: 'storno@bank.test', nachname: 'Storno' } });
  await storniereAnmeldung(pool, s.anmeldung.id, { grund: 'x', datum: '2026-10-01' });
  ids.kontakt = x.anmeldung.kontaktId;

  await createDurchfuehrung(pool, { kursangebotId: a.id, startDatum: '2027-01-12', endDatum: '2027-01-12' });          // geplant
  await ausgeschrieben(pool, a.id, { startDatum: '2027-02-02', endDatum: '2027-02-02', oeffentlich: false, auftraggeberId: base.auftraggeber.id });
  const voll = await ausgeschrieben(pool, a.id, { startDatum: '2027-03-02', endDatum: '2027-03-02', kapazitaet: 1, preisChf: 990 });
  await setDurchfuehrungStatus(pool, voll.id, 'bestaetigt');
  await meldeAn(pool, voll.id, { kontakt: { email: 'voll@bank.test', nachname: 'Voll' } });
  ids.voll = voll.id;
  await ausgeschrieben(pool, a.id, { startDatum: '2026-10-27', endDatum: '2026-10-27' });                              // vorbei
  const abgesagt = await ausgeschrieben(pool, a.id, { startDatum: '2027-04-06', endDatum: '2027-04-06' });
  await setDurchfuehrungStatus(pool, abgesagt.id, 'abgesagt');

  await angebot(pool, { code: 'INAKTIV', bereich: 'Banking', oeffentlich: true, aktiv: false });
  await angebot(pool, { code: 'INTERN', bereich: 'Banking', oeffentlich: false });
  await angebot(pool, { code: 'LEAD', titel: 'Leadership', bereich: 'Leadership', oeffentlich: true });
});
afterAll(async () => { await closePool(); });

describe('oeffentliches Lesemodell', () => {
  it('nur oeffentliche, aktive Angebote mit ausgeschriebenen/bestaetigten, oeffentlichen, kommenden Durchfuehrungen', async () => {
    const kurse = await listOeffentlicheKurse(pool, { heute });
    expect(kurse.map((k) => k.code)).toEqual(['BEF', 'LEAD']);
    const bef = kurse[0];
    expect(bef).toMatchObject({
      slug: 'eigenheimfinanzierung', titel: 'Eigenheimfinanzierung', bereich: 'Banking', format: 'blended', beschreibung: 'Beschreibung',
      lernziele: 'Ziele', zielgruppe: 'Kundenberater', dauerTage: 2, lernstunden: 16, preisChf: 1450, saqAnerkannt: true,
    });
    expect(bef.durchfuehrungen.map((d) => d.id)).toEqual([ids.d1, ids.voll]);
    expect(bef.durchfuehrungen[0]).toEqual({
      id: ids.d1, code: 'BEF-2026-1', startDatum: '2026-12-01', endDatum: '2026-12-02', ort: 'St. Gallen',
      kurstage: [{ datum: '2026-12-01', von: '08:30', bis: '17:00' }, { datum: '2026-12-02', von: '08:30', bis: '12:00' }],
      preisChf: 1450, freiePlaetze: 2, wartelisteMoeglich: true, anmeldeschluss: '2026-11-15',
    });
    expect(bef.durchfuehrungen[1]).toMatchObject({ preisChf: 990, freiePlaetze: 0, wartelisteMoeglich: true });
    expect(kurse[1].durchfuehrungen).toEqual([]);
  });
  it('filtert nach Bereich und liefert einen Kurs per Slug', async () => {
    expect((await listOeffentlicheKurse(pool, { bereich: 'Leadership', heute })).map((k) => k.code)).toEqual(['LEAD']);
    expect((await getOeffentlichenKurs(pool, 'eigenheimfinanzierung', { heute })).durchfuehrungen).toHaveLength(2);
    await expect(getOeffentlichenKurs(pool, 'kurs-2', { heute })).rejects.toBeInstanceOf(NotFoundError);      // INAKTIV/INTERN
    await expect(getOeffentlichenKurs(pool, 'gibt-es-nicht', { heute })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('enthaelt keine Personendaten und keine internen Verweise', async () => {
    const json = JSON.stringify(await listOeffentlicheKurse(pool, { heute }));
    for (const geheim of ['geheim@bank.test', 'Geheimnis', 'Gerda', 'storno@bank.test', ids.kontakt, base.auftraggeber.id,
      base.projekt.id, base.ml.id, base.konto.id, '987654321', 'Urner']) {
      expect(json).not.toContain(geheim);
    }
    const [bef] = await listOeffentlicheKurse(pool, { heute });
    expect(Object.keys(bef).sort()).toEqual(['bereich', 'beschreibung', 'code', 'dauerTage', 'durchfuehrungen', 'format', 'lernstunden',
      'lernziele', 'preisChf', 'saqAnerkannt', 'slug', 'titel', 'untertitel', 'zielgruppe']);
    expect(Object.keys(bef.durchfuehrungen[0]).sort()).toEqual(['anmeldeschluss', 'code', 'endDatum', 'freiePlaetze', 'id', 'kurstage',
      'ort', 'preisChf', 'startDatum', 'wartelisteMoeglich']);
  });
});

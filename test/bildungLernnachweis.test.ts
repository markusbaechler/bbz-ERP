import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createKontakt } from '../src/repos/kontaktRepo';
import {
  createLernnachweis, listLernnachweise, createZertifizierung, getZertifizierung, listZertifizierungen,
  getRezertifizierung, listFaelligeRezertifizierungen,
} from '../src/repos/lernnachweisRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
beforeAll(async () => { await resetDb(pool); });
afterAll(async () => { await closePool(); });

let nr = 0;
const kontakt = async (nachname = 'Muster') => { nr += 1; return createKontakt(pool, { nachname, vorname: 'Vera', email: `ln${nr}@bank.test` }); };

describe('lernnachweis', () => {
  it('erfasst externe Nachweise und listet nach Zeitraum', async () => {
    const k = await kontakt();
    const n = await createLernnachweis(pool, { kontaktId: k.id, datum: '2026-03-10', titel: 'Fachtagung Hypotheken', lernstunden: 6 });
    expect(n).toMatchObject({ quelle: 'extern', kategorie: 'weiterbildung', lernstunden: 6, anmeldungId: null });
    await createLernnachweis(pool, { kontaktId: k.id, datum: '2025-03-10', titel: 'Alt', lernstunden: 2, kategorie: 'compliance' });
    expect((await listLernnachweise(pool, k.id)).map((x) => x.datum)).toEqual(['2025-03-10', '2026-03-10']);
    expect((await listLernnachweise(pool, k.id, { von: '2026-01-01' })).map((x) => x.titel)).toEqual(['Fachtagung Hypotheken']);
  });
  it('validiert', async () => {
    const k = await kontakt();
    await expect(createLernnachweis(pool, { kontaktId: k.id, datum: '2026-13-01', titel: 'x', lernstunden: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLernnachweis(pool, { kontaktId: k.id, datum: '2026-01-01', titel: ' ', lernstunden: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLernnachweis(pool, { kontaktId: k.id, datum: '2026-01-01', titel: 'x', lernstunden: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLernnachweis(pool, { kontaktId: '00000000-0000-0000-0000-000000000000', datum: '2026-01-01', titel: 'x', lernstunden: 1 }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('zertifizierung + rezertifizierung', () => {
  it('Gueltigkeit default 36 Monate, Dublette 409', async () => {
    const k = await kontakt();
    const z = await createZertifizierung(pool, { kontaktId: k.id, typ: 'SAQ Kundenberater Bank', ausgestelltAm: '2024-05-31', zertifikatNr: 'SAQ-123' });
    expect(z).toMatchObject({ gueltigBis: '2027-05-31', status: 'aktiv', zertifikatNr: 'SAQ-123' });
    expect((await getZertifizierung(pool, z.id)).typ).toBe('SAQ Kundenberater Bank');
    await expect(createZertifizierung(pool, { kontaktId: k.id, typ: 'SAQ Kundenberater Bank', ausgestelltAm: '2024-05-31' }))
      .rejects.toBeInstanceOf(ConflictError);
    await expect(createZertifizierung(pool, { kontaktId: k.id, typ: 'X', ausgestelltAm: '2024-05-31', gueltigBis: '2024-05-01' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createZertifizierung(pool, { kontaktId: k.id, typ: '', ausgestelltAm: '2024-05-31' })).rejects.toBeInstanceOf(ValidationError);
    expect((await listZertifizierungen(pool, { kontaktId: k.id })).map((x) => x.id)).toEqual([z.id]);
  });
  it('Rezertifizierung: Lernstunden im Gueltigkeitszeitraum vs. Soll', async () => {
    const k = await kontakt();
    const z = await createZertifizierung(pool, { kontaktId: k.id, typ: 'SAQ Firmenkunden', ausgestelltAm: '2024-01-15' });
    await createLernnachweis(pool, { kontaktId: k.id, datum: '2023-12-01', titel: 'vorher', lernstunden: 40 });
    await createLernnachweis(pool, { kontaktId: k.id, datum: '2025-06-01', titel: 'Kurs A', lernstunden: 16 });
    const r = await getRezertifizierung(pool, z.id, { heute: '2026-10-28' });
    expect(r).toMatchObject({ lernstundenIst: 16, lernstundenSoll: 24, fehlend: 8, erfuellt: false, abgelaufen: false, gueltigBis: '2027-01-15' });
    expect(r.zertifizierung.id).toBe(z.id);
    expect(r.lernnachweise.map((n) => n.titel)).toEqual(['Kurs A']);
    await expect(getRezertifizierung(pool, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
  it('Faelligkeitsliste: ablaufend innert n Monaten mit fehlenden Lernstunden', async () => {
    const heute = '2026-10-28';
    const faellig = await kontakt('Faellig');
    const zF = await createZertifizierung(pool, { kontaktId: faellig.id, typ: 'SAQ', ausgestelltAm: '2023-12-31', gueltigBis: '2026-12-31' });
    await createLernnachweis(pool, { kontaktId: faellig.id, datum: '2025-02-01', titel: 'K', lernstunden: 10 });
    const erfuellt = await kontakt('Erfuellt');
    await createZertifizierung(pool, { kontaktId: erfuellt.id, typ: 'SAQ', ausgestelltAm: '2023-12-31', gueltigBis: '2026-12-31' });
    await createLernnachweis(pool, { kontaktId: erfuellt.id, datum: '2025-02-01', titel: 'K', lernstunden: 30 });
    const spaet = await kontakt('Spaet');
    const zS = await createZertifizierung(pool, { kontaktId: spaet.id, typ: 'SAQ', ausgestelltAm: '2024-09-30', gueltigBis: '2027-09-30' });
    const abgelaufen = await kontakt('Abgelaufen');
    await createZertifizierung(pool, { kontaktId: abgelaufen.id, typ: 'SAQ', ausgestelltAm: '2023-10-27', gueltigBis: '2026-10-27' });
    const entzogen = await kontakt('Entzogen');
    await createZertifizierung(pool, { kontaktId: entzogen.id, typ: 'SAQ', ausgestelltAm: '2023-12-31', gueltigBis: '2026-12-31', status: 'entzogen' });

    const hier = new Set([faellig.id, erfuellt.id, spaet.id, abgelaufen.id, entzogen.id]);
    const sechs = (await listFaelligeRezertifizierungen(pool, { innertMonaten: 6, heute })).filter((f) => hier.has(f.kontakt.id));
    expect(sechs.map((f) => f.kontakt.nachname)).toEqual(['Faellig']);
    expect(sechs[0]).toMatchObject({ zertifizierung: { id: zF.id }, kontakt: { email: faellig.email }, fehlend: 14, lernstundenIst: 10 });
    const zwoelf = (await listFaelligeRezertifizierungen(pool, { innertMonaten: 12, heute })).filter((f) => hier.has(f.kontakt.id));
    expect(zwoelf.map((f) => f.zertifizierung.id)).toEqual([zF.id, zS.id]);
    await expect(listFaelligeRezertifizierungen(pool, { innertMonaten: -1, heute })).rejects.toBeInstanceOf(ValidationError);
  });
});

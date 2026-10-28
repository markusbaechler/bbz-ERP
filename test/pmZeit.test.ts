import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { createKonto } from '../src/repos/kontoRepo';
import { createMitarbeitende } from '../src/repos/mitarbeitendeRepo';
import { createProjekt, getProjektById, setProjektStatus } from '../src/repos/projektRepo';
import { createAufgabe } from '../src/repos/aufgabeRepo';
import { createRechnung, addPosition, festschreiben, getRechnung, listPositionen } from '../src/repos/rechnungRepo';
import { listAudit } from '../src/repos/auditRepo';
import {
  createZeiterfassung, getZeiterfassung, listZeiterfassung, updateZeiterfassung, deleteZeiterfassung, zeitVerrechnen,
} from '../src/repos/zeiterfassungRepo';
import { ConflictError, NotFoundError, ValidationError } from '../src/domain/errors';

const pool = getPool();
let base: Awaited<ReturnType<typeof grundbestand>>;
let phId: string; let kontoId: string;
const neuesProjekt = async (stammnummer: number) =>
  (await createProjekt(pool, { stammnummer, jahr: 2026, name: `P${stammnummer}`, auftraggeberId: base.auftraggeber.id, ertragskontoId: kontoId })).id;
const anzahl = async (tabelle: 'rechnung' | 'rechnungsposition') => Number((await pool.query(`select count(*) n from ${tabelle}`)).rows[0].n);

beforeAll(async () => {
  await resetDb(pool);
  base = await grundbestand(pool);
  phId = (await createMitarbeitende(pool, { kuerzel: 'ph', nachname: 'Huber', stundensatzIntern: 70, stundensatzVerrechnung: 180 })).id;
  kontoId = (await createKonto(pool, { nummer: '3200', bezeichnung: 'Beratungsertrag', typ: 'Ertrag' })).id;
});
afterAll(async () => { await closePool(); });

describe('Zeiterfassung', () => {
  it('Ansatz-Default = Verrechnungssatz der Person, explizit uebersteuerbar', async () => {
    const z = await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-01', stunden: 2.5, taetigkeit: 'Konzept' });
    expect(z).toMatchObject({ ansatzChf: 220, verrechenbar: true, verrechnet: false, rechnungspositionId: null, stunden: 2.5 });
    const s = await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-02', stunden: 1, taetigkeit: 'Reise', ansatzChf: 120, verrechenbar: false });
    expect(s).toMatchObject({ ansatzChf: 120, verrechenbar: false });
  });

  it('validiert Pflichtfelder, Stunden, Aufgabe im Projekt und Bezuege', async () => {
    const ok = { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-01', stunden: 1, taetigkeit: 'X' };
    await expect(createZeiterfassung(pool, { ...ok, stunden: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, stunden: 24.5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, taetigkeit: ' ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, datum: '2026-13-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, mitarbeitendeId: undefined as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, ansatzChf: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createZeiterfassung(pool, { ...ok, mitarbeitendeId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(NotFoundError);
    const fremd = await createAufgabe(pool, { titel: 'fremd', projektId: await neuesProjekt(9001) });
    await expect(createZeiterfassung(pool, { ...ok, aufgabeId: fremd.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it('filtert nach Projekt, Person, Zeitraum und Verrechnungsstand', async () => {
    const p = await neuesProjekt(9002);
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: p, datum: '2026-09-30', stunden: 1, taetigkeit: 'A' });
    await createZeiterfassung(pool, { mitarbeitendeId: phId, projektId: p, datum: '2026-10-05', stunden: 2, taetigkeit: 'B' });
    expect((await listZeiterfassung(pool, { projektId: p })).map((z) => z.datum)).toEqual(['2026-09-30', '2026-10-05']);
    expect((await listZeiterfassung(pool, { projektId: p, mitarbeitendeId: phId })).length).toBe(1);
    expect((await listZeiterfassung(pool, { projektId: p, von: '2026-10-01', bis: '2026-10-31' })).map((z) => z.taetigkeit)).toEqual(['B']);
    expect((await listZeiterfassung(pool, { projektId: p, verrechnet: true })).length).toBe(0);
    expect((await listZeiterfassung(pool, { projektId: p, verrechnet: false })).length).toBe(2);
  });

  it('PATCH/DELETE auf unverrechneten Eintraegen', async () => {
    const z = await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-03', stunden: 1, taetigkeit: 'Tippfehler' });
    const u = await updateZeiterfassung(pool, z.id, { taetigkeit: 'Workshop', stunden: 1.75 });
    expect(u).toMatchObject({ taetigkeit: 'Workshop', stunden: 1.75, ansatzChf: 220 });
    await expect(updateZeiterfassung(pool, z.id, { stunden: -1 })).rejects.toBeInstanceOf(ValidationError);
    await deleteZeiterfassung(pool, z.id);
    await expect(getZeiterfassung(pool, z.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteZeiterfassung(pool, z.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Zeit -> Rechnung', () => {
  let p: string;
  beforeAll(async () => {
    p = await neuesProjekt(9100);
    const e = (mitarbeitendeId: string, datum: string, stunden: number, taetigkeit: string, extra: object = {}) =>
      createZeiterfassung(pool, { mitarbeitendeId, projektId: p, datum, stunden, taetigkeit, ...extra });
    await e(base.ml.id, '2026-10-01', 4, 'Workshop');
    await e(base.ml.id, '2026-10-02', 8.5, 'Konzept');
    await e(phId, '2026-10-02', 2.5, 'Konzept');
    await e(base.ml.id, '2026-10-03', 3, 'Interne Sitzung', { verrechenbar: false });
    await e(base.ml.id, '2026-11-02', 1, 'Nach Stichtag');
  });

  it('erzeugt Entwurf + Positionen je Mitarbeitende (bis Stichtag) und verknuepft die Eintraege', async () => {
    const res = await zeitVerrechnen(pool, p, { datum: '2026-10-31', bis: '2026-10-31', mwstSatz: 8.1, gruppierung: 'mitarbeitende' }, { benutzer: 'ml' });
    expect(res.anzahlEintraege).toBe(3);
    expect(res.rechnung).toMatchObject({ projektId: p, auftraggeberId: base.auftraggeber.id, status: 'offen_prov', datum: '2026-10-31',
      totalNetto: 3200, totalMwst: 259.2, totalBrutto: 3459.2 });
    expect(res.positionen.map((x) => [x.beschreibung, x.menge, x.einheit, x.einzelpreis, x.betragNetto, x.kontoId, x.mwstSatz])).toEqual([
      ['Aufwand ml (12.5 Std)', 12.5, 'Std', 220, 2750, kontoId, 8.1],
      ['Aufwand ph (2.5 Std)', 2.5, 'Std', 180, 450, kontoId, 8.1],
    ]);
    const alle = await listZeiterfassung(pool, { projektId: p });
    const verrechnet = alle.filter((z) => z.verrechnet);
    expect(verrechnet.map((z) => z.taetigkeit).sort()).toEqual(['Konzept', 'Konzept', 'Workshop']);
    expect(new Set(verrechnet.map((z) => z.rechnungspositionId)).size).toBe(2);
    // nicht verrechenbar und nach Stichtag bleiben offen
    expect(alle.filter((z) => !z.verrechnet).map((z) => z.taetigkeit).sort()).toEqual(['Interne Sitzung', 'Nach Stichtag']);
    const log = await listAudit(pool, 'projekt', p);
    expect(log.at(-1)).toMatchObject({ benutzer: 'ml', aktion: 'zeit_verrechnet' });
    expect(log.at(-1)!.details).toMatchObject({ rechnungId: res.rechnung.id, anzahlEintraege: 3, stunden: 15 });
  });

  it('verrechnete Eintraege sind gesperrt (409)', async () => {
    const z = (await listZeiterfassung(pool, { projektId: p, verrechnet: true }))[0];
    await expect(updateZeiterfassung(pool, z.id, { stunden: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteZeiterfassung(pool, z.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('400, wenn nichts (mehr) zu verrechnen ist', async () => {
    await expect(zeitVerrechnen(pool, p, { datum: '2026-10-31', bis: '2026-10-31', mwstSatz: 8.1, gruppierung: 'einzeln' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('haengt an einen bestehenden Entwurf desselben Projekts an (Gruppierung Taetigkeit)', async () => {
    const entwurf = await createRechnung(pool, { projektId: p, auftraggeberId: base.auftraggeber.id, datum: '2026-11-30' });
    await addPosition(pool, entwurf.id, { beschreibung: 'Pauschale', menge: 1, einzelpreis: 500, mwstSatz: 8.1 });
    const res = await zeitVerrechnen(pool, p, { datum: '2026-11-30', mwstSatz: 8.1, gruppierung: 'taetigkeit', rechnungId: entwurf.id });
    expect(res.rechnung.id).toBe(entwurf.id);
    expect(res.positionen.map((x) => x.beschreibung)).toEqual(['Nach Stichtag (1 Std)']);
    expect((await listPositionen(pool, entwurf.id)).map((x) => x.position)).toEqual([1, 2]);
    expect(res.rechnung.totalNetto).toBe(720);
  });

  it('lehnt fremde oder festgeschriebene Rechnungen sowie ungueltige Eingaben ab', async () => {
    const q = await neuesProjekt(9101);
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: q, datum: '2026-10-01', stunden: 1, taetigkeit: 'X' });
    const fremd = await createRechnung(pool, { projektId: p, auftraggeberId: base.auftraggeber.id, datum: '2026-10-31' });
    const ok = { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'einzeln' as const };
    await expect(zeitVerrechnen(pool, q, { ...ok, rechnungId: fremd.id })).rejects.toBeInstanceOf(ValidationError);
    const fest = await createRechnung(pool, { projektId: q, auftraggeberId: base.auftraggeber.id, datum: '2026-10-31' });
    await addPosition(pool, fest.id, { beschreibung: 'X', menge: 1, einzelpreis: 1, mwstSatz: 8.1 });
    await festschreiben(pool, fest.id, 'ml');
    await expect(zeitVerrechnen(pool, q, { ...ok, rechnungId: fest.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(zeitVerrechnen(pool, q, { ...ok, gruppierung: 'projekt' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(zeitVerrechnen(pool, q, { ...ok, mwstSatz: 'x' as any })).rejects.toBeInstanceOf(ValidationError);
    await expect(zeitVerrechnen(pool, q, { ...ok, datum: '31.10.2026' })).rejects.toBeInstanceOf(ValidationError);
    await expect(zeitVerrechnen(pool, '00000000-0000-0000-0000-000000000000', ok)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('400 bei Eintrag ohne Ansatz, ohne etwas anzulegen', async () => {
    const q = await neuesProjekt(9102);
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: q, datum: '2026-10-01', stunden: 1, taetigkeit: 'X' });
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: q, datum: '2026-10-02', stunden: 1, taetigkeit: 'Y', ansatzChf: null });
    const vorher = await anzahl('rechnung');
    await expect(zeitVerrechnen(pool, q, { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'einzeln' })).rejects.toBeInstanceOf(ValidationError);
    expect(await anzahl('rechnung')).toBe(vorher);
  });

  it('ist atomar: Fehler mitten im Lauf hinterlaesst weder Rechnung noch Positionen noch Verknuepfungen', async () => {
    const q = await neuesProjekt(9103);
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: q, datum: '2026-10-01', stunden: 2, taetigkeit: 'A' });
    await createZeiterfassung(pool, { mitarbeitendeId: phId, projektId: q, datum: '2026-10-02', stunden: 3, taetigkeit: 'B' });
    const [r0, p0] = [await anzahl('rechnung'), await anzahl('rechnungsposition')];
    // Fehler beim Verknuepfen der Eintraege (nachdem Rechnung + erste Position bereits geschrieben sind)
    await pool.query(`create function pm_test_fehler() returns trigger language plpgsql as $$ begin raise exception 'Testfehler Verknuepfung'; end $$`);
    await pool.query('create trigger pm_test_fehler before update on zeiterfassung for each row execute function pm_test_fehler()');
    try {
      await expect(zeitVerrechnen(pool, q, { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'mitarbeitende' })).rejects.toThrow('Testfehler');
    } finally {
      await pool.query('drop trigger pm_test_fehler on zeiterfassung; drop function pm_test_fehler();');
    }
    expect(await anzahl('rechnung')).toBe(r0);
    expect(await anzahl('rechnungsposition')).toBe(p0);
    expect((await listZeiterfassung(pool, { projektId: q, verrechnet: true })).length).toBe(0);
    // nach Behebung funktioniert der Lauf
    const ok = await zeitVerrechnen(pool, q, { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'mitarbeitende' });
    expect(ok.anzahlEintraege).toBe(2);
    expect((await getRechnung(pool, ok.rechnung.id)).totalNetto).toBe(2 * 220 + 3 * 180);
  });
});

describe('Projektstatus', () => {
  it('Abschluss blockiert bei unverrechneter Zeit (409), force uebersteuert und wird protokolliert', async () => {
    const p = await neuesProjekt(9200);
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: p, datum: '2026-10-01', stunden: 1, taetigkeit: 'X' });
    await createZeiterfassung(pool, { mitarbeitendeId: base.ml.id, projektId: p, datum: '2026-10-01', stunden: 1, taetigkeit: 'intern', verrechenbar: false });
    await expect(setProjektStatus(pool, p, 'abgeschlossen', { benutzer: 'ph' })).rejects.toBeInstanceOf(ConflictError);
    expect((await getProjektById(pool, p)).status).toBe('laufend');
    const zu = await setProjektStatus(pool, p, 'abgeschlossen', { force: true, benutzer: 'ml' });
    expect(zu.status).toBe('abgeschlossen');
    const log = await listAudit(pool, 'projekt', p);
    expect(log.at(-1)).toMatchObject({ benutzer: 'ml', aktion: 'status', details: { von: 'laufend', nach: 'abgeschlossen', forciert: true, unverrechneteEintraege: 1 } });
    // Wiedereroeffnung und Archivierung
    expect((await setProjektStatus(pool, p, 'laufend')).status).toBe('laufend');
    await setProjektStatus(pool, p, 'abgeschlossen', { force: true });
    expect((await setProjektStatus(pool, p, 'archiviert')).status).toBe('archiviert');
    await expect(setProjektStatus(pool, p, 'laufend')).rejects.toBeInstanceOf(ValidationError);
  });

  it('Abschluss ohne offene Zeit, verbotene Wechsel, unbekanntes Projekt', async () => {
    const p = await neuesProjekt(9201);
    expect((await setProjektStatus(pool, p, 'abgeschlossen')).status).toBe('abgeschlossen');
    await expect(setProjektStatus(pool, p, 'akquise')).rejects.toBeInstanceOf(ValidationError);
    await expect(setProjektStatus(pool, p, 'zu' as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(setProjektStatus(pool, '00000000-0000-0000-0000-000000000000', 'abgeschlossen')).rejects.toBeInstanceOf(NotFoundError);
  });
});

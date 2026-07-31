import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { getZaehler, setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { rechnungNrUntergrenze, zaehlerGesperrt } from '../src/config/rechnungszaehler';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function draftMitPosition(): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
  return r.id;
}

describe('Untergrenze des Rechnungszaehlers', () => {
  it('nimmt 31491 als Vorgabe — den hoechsten aus dem Export belegten Stand', () => {
    expect(rechnungNrUntergrenze()).toBe(31491);
  });

  it('laesst sich per RECHNUNG_NR_UNTERGRENZE ueberschreiben', () => {
    const alt = process.env.RECHNUNG_NR_UNTERGRENZE;
    try {
      process.env.RECHNUNG_NR_UNTERGRENZE = '40000';
      expect(rechnungNrUntergrenze()).toBe(40000);
    } finally {
      if (alt === undefined) delete process.env.RECHNUNG_NR_UNTERGRENZE; else process.env.RECHNUNG_NR_UNTERGRENZE = alt;
    }
  });

  it('gilt als gesperrt bis einschliesslich der Untergrenze', () => {
    expect(zaehlerGesperrt(0)).toBe(true);
    expect(zaehlerGesperrt(rechnungNrUntergrenze() - 1)).toBe(true);
    expect(zaehlerGesperrt(rechnungNrUntergrenze())).toBe(true);
    expect(zaehlerGesperrt(rechnungNrUntergrenze() + 1)).toBe(false);
  });
});

describe('festschreiben mit ungesetztem Zaehler', () => {
  // Der Zaehler startet nach der Migration bei 0. Die erste Festschreibung vergaebe
  // damit Nr. 1 — eine Nummer, die FileMaker 2001 bereits vergeben hat. Nach Spec §6.1
  // ist sie unwiderruflich, der Zusammenstoss also nicht reparierbar.
  it('weist die Festschreibung ab und verbraucht dabei keine Nummer', async () => {
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
    const id = await draftMitPosition();
    await expect(festschreiben(getPool(), id)).rejects.toBeInstanceOf(ValidationError);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
  });

  it('nennt Stand, Untergrenze und den Weg heraus', async () => {
    const id = await draftMitPosition();
    await expect(festschreiben(getPool(), id)).rejects.toThrow(/steht auf 0/);
    await expect(festschreiben(getPool(), id)).rejects.toThrow(/31491/);
    await expect(festschreiben(getPool(), id)).rejects.toThrow(/npm run zaehler -- --rechnung-max=/);
    await expect(festschreiben(getPool(), id)).rejects.toThrow(/PUT \/zaehler\/rechnung/);
  });

  // Auch ein versehentlich zu tief gesetzter Zaehler bleibt gesperrt: genau dafuer
  // steht eine Untergrenze statt einer blossen "> 0"-Pruefung.
  it('bleibt gesperrt, solange der Zaehler nur genau auf der Untergrenze steht', async () => {
    await setzeRechnungZaehler(getPool(), rechnungNrUntergrenze());
    const id = await draftMitPosition();
    await expect(festschreiben(getPool(), id)).rejects.toBeInstanceOf(ValidationError);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(rechnungNrUntergrenze());
  });

  it('gibt die Festschreibung frei, sobald der Zaehler ueber der Untergrenze steht', async () => {
    await setzeRechnungZaehler(getPool(), 33214);
    const f = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    expect(f.lfdNr).toBe(33215);
    expect(f.nummer).toBe('6231.26 - 33215 ml');
  });
});

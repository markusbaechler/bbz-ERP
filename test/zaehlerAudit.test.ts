import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { rechnungZaehlerStand, setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { ValidationError } from '../src/domain/errors';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

// Den Zaehler zu setzen ist ein folgenreicher, in der Wirkung unwiderruflicher Akt
// (Spec §6.1). Wer ihn wann gesetzt hat, muss darum am Datensatz stehen.
describe('Zaehler-Audit', () => {
  it('meldet vor dem ersten Setzen einen leeren Nachweis', async () => {
    const s = await rechnungZaehlerStand(getPool());
    expect(s.wert).toBe(0);
    expect(s.gesetztAm).toBeNull();
    expect(s.gesetztDurch).toBeNull();
  });

  it('haelt Zeitpunkt und Akteur fest', async () => {
    const vorher = Date.now();
    await setzeRechnungZaehler(getPool(), 33214, 'CLI npm run zaehler');
    const s = await rechnungZaehlerStand(getPool());
    expect(s.wert).toBe(33214);
    expect(s.gesetztDurch).toBe('CLI npm run zaehler');
    expect(s.gesetztAm).not.toBeNull();
    expect(new Date(s.gesetztAm as string).getTime()).toBeGreaterThanOrEqual(vorher - 1000);
  });

  it('laesst den Nachweis unangetastet, wenn das Setzen abgewiesen wird', async () => {
    const vorher = await rechnungZaehlerStand(getPool());
    await expect(setzeRechnungZaehler(getPool(), 100, 'REST x-user-role=admin'))
      .rejects.toBeInstanceOf(ValidationError);
    const nachher = await rechnungZaehlerStand(getPool());
    expect(nachher).toEqual(vorher);
  });

  it('haelt auch ohne Akteur den Zeitpunkt fest', async () => {
    await setzeRechnungZaehler(getPool(), 33300);
    const s = await rechnungZaehlerStand(getPool());
    expect(s.wert).toBe(33300);
    expect(s.gesetztDurch).toBeNull();
    expect(s.gesetztAm).not.toBeNull();
  });
});

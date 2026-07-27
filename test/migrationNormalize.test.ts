import { describe, it, expect } from 'vitest';
import { fmText, fmZahl, fmDatum, fmProjektNummer, fmName, fmBereich } from '../src/migration/normalize';
import { ValidationError } from '../src/domain/errors';

describe('fmText', () => {
  it('trimmt und macht aus Leer null', () => {
    expect(fmText('  Urner Kantonalbank ')).toBe('Urner Kantonalbank');
    expect(fmText('   ')).toBeNull();
    expect(fmText(undefined)).toBeNull();
  });
});

describe('fmZahl', () => {
  it('liest die Formate des Exports', () => {
    expect(fmZahl('8329.1')).toBe(8329.1);
    expect(fmZahl('24600')).toBe(24600);
    expect(fmZahl('2.5')).toBe(2.5);
    expect(fmZahl('0')).toBe(0);
  });
  it('entfernt Tausendertrenner und akzeptiert Komma-Dezimal', () => {
    expect(fmZahl("1'234.50")).toBe(1234.5);
    expect(fmZahl('1’234.50’')).toBe(1234.5);
    expect(fmZahl('1234,50')).toBe(1234.5);
  });
  it('gibt null fuer Leeres und Nicht-Zahlen', () => {
    expect(fmZahl('')).toBeNull();
    expect(fmZahl(undefined)).toBeNull();
    expect(fmZahl('Fr.')).toBeNull();
  });
});

describe('fmDatum', () => {
  it('wandelt dd.mm.yyyy nach ISO', () => {
    expect(fmDatum('23.07.2026')).toBe('2026-07-23');
    expect(fmDatum('01.01.2000')).toBe('2000-01-01');
  });
  it('gibt null bei Leer oder unbekanntem Format', () => {
    expect(fmDatum('')).toBeNull();
    expect(fmDatum('2026-07-23')).toBeNull();
  });
});

describe('fmProjektNummer', () => {
  it('zerlegt Stammnummer und Jahr', () => {
    expect(fmProjektNummer('6231.26')).toEqual({ stammnummer: 6231, jahr: 2026 });
    expect(fmProjektNummer('1285.01')).toEqual({ stammnummer: 1285, jahr: 2001 });
    expect(fmProjektNummer('99.95')).toEqual({ stammnummer: 99, jahr: 1995 });
  });
  it('wirft bei unbekanntem Format', () => {
    expect(() => fmProjektNummer('6231')).toThrow(ValidationError);
    expect(() => fmProjektNummer('')).toThrow(ValidationError);
  });
});

describe('fmName', () => {
  it('trennt mehrzeilige Namen in Name und Zusatz', () => {
    expect(fmName('Universität St. Gallen\nInstitut für Banken und Finanzen'))
      .toEqual({ name: 'Universität St. Gallen', zusatz: 'Institut für Banken und Finanzen' });
    expect(fmName('Urner Kantonalbank')).toEqual({ name: 'Urner Kantonalbank', zusatz: null });
  });
});

describe('fmBereich', () => {
  it('nimmt die erste Zeile', () => {
    expect(fmBereich('Kundenberaterausbildung\nIGK\nBanking')).toBe('Kundenberaterausbildung');
  });
  it('verwirft rein numerische Fehleingaben', () => {
    expect(fmBereich('3204')).toBeNull();
    expect(fmBereich('')).toBeNull();
  });
});

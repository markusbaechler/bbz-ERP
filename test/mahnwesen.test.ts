import { describe, it, expect } from 'vitest';
import { addTage, faelligAm, naechsteStufe, istInkasso, beurteileMahnung, pruefeStichtag } from '../src/domain/mahnwesen';
import { MAHNWESEN } from '../src/config/mahnwesen';
import { ValidationError } from '../src/domain/errors';

const rechnung = { datum: '2026-01-05', zahlungsfristTage: 30 };   // faellig am 2026-02-04

describe('mahnwesen: Konfiguration (AGB)', () => {
  it('30 Tage Zahlungsfrist, Erinnerung ohne Gebuehr, ab Stufe 2 CHF 50, max. Stufe 3', () => {
    expect(MAHNWESEN.zahlungsfristTage).toBe(30);
    expect(MAHNWESEN.stufen.map((s) => [s.stufe, s.fristTage, s.gebuehrChf])).toEqual([[1, 10, 0], [2, 10, 50], [3, 10, 50]]);
    expect(MAHNWESEN.stufen[0].bezeichnung).toBe('Zahlungserinnerung');
  });
});

describe('mahnwesen: Datum', () => {
  it('rechnet Tage zeitzonenfrei (Monats-/Jahreswechsel, Schaltjahr)', () => {
    expect(addTage('2026-01-31', 1)).toBe('2026-02-01');
    expect(addTage('2026-12-15', 30)).toBe('2027-01-14');
    expect(addTage('2028-02-28', 1)).toBe('2028-02-29');
    expect(faelligAm('2026-01-05', 30)).toBe('2026-02-04');
    expect(faelligAm('2026-01-05')).toBe('2026-02-04');
  });
  it('validiert den Stichtag', () => {
    expect(pruefeStichtag('2026-02-28')).toBe('2026-02-28');
    expect(() => pruefeStichtag('2026-02-30')).toThrow(ValidationError);
    expect(() => pruefeStichtag('28.02.2026')).toThrow(ValidationError);
    expect(() => pruefeStichtag('2026-99-99')).toThrow(ValidationError);
  });
});

describe('mahnwesen: naechste Stufe', () => {
  it('erste Erinnerung erst, wenn die Faelligkeit vor dem Stichtag liegt', () => {
    expect(naechsteStufe(rechnung, [], '2026-02-04')).toBeNull();
    expect(naechsteStufe(rechnung, [], '2026-02-05')).toBe(1);
  });
  it('naechste Stufe erst nach Ablauf der Frist der vorherigen', () => {
    const m1 = [{ stufe: 1, fristBis: '2026-02-15' }];
    expect(naechsteStufe(rechnung, m1, '2026-02-15')).toBeNull();
    expect(naechsteStufe(rechnung, m1, '2026-02-16')).toBe(2);
    expect(naechsteStufe(rechnung, [...m1, { stufe: 2, fristBis: '2026-02-26' }], '2026-02-27')).toBe(3);
  });
  it('nach Stufe 3 keine weitere Mahnung, sondern Inkasso nach Fristablauf', () => {
    const alle = [{ stufe: 1, fristBis: '2026-02-15' }, { stufe: 2, fristBis: '2026-02-26' }, { stufe: 3, fristBis: '2026-03-09' }];
    expect(naechsteStufe(rechnung, alle, '2026-12-31')).toBeNull();
    expect(istInkasso(alle, '2026-03-09')).toBe(false);
    expect(istInkasso(alle, '2026-03-10')).toBe(true);
    expect(istInkasso(alle.slice(0, 2), '2026-12-31')).toBe(false);
  });
  it('beurteilt eine Rechnung ueber mehrere Stichtage (Stufe, Frist, Gebuehr, Inkasso)', () => {
    const bisher: { stufe: number; fristBis: string }[] = [];
    const verlauf: string[] = [];
    for (let tag = '2026-02-01'; tag <= '2026-03-15'; tag = addTage(tag, 1)) {
      const b = beurteileMahnung(rechnung, bisher, tag);
      if (b.naechsteStufe !== null) {
        bisher.push({ stufe: b.naechsteStufe, fristBis: b.fristBis as string });
        verlauf.push(`${tag}: Stufe ${b.naechsteStufe} bis ${b.fristBis}, CHF ${b.gebuehr}`);
      }
    }
    expect(verlauf).toEqual([
      '2026-02-05: Stufe 1 bis 2026-02-15, CHF 0',
      '2026-02-16: Stufe 2 bis 2026-02-26, CHF 50',
      '2026-02-27: Stufe 3 bis 2026-03-09, CHF 50',
    ]);
    expect(beurteileMahnung(rechnung, bisher, '2026-03-10')).toEqual({
      faelligAm: '2026-02-04', ueberfaellig: true, letzteStufe: 3, naechsteStufe: null, fristBis: null, gebuehr: 0, inkasso: true,
    });
    expect(beurteileMahnung(rechnung, [], '2026-01-20')).toMatchObject({ ueberfaellig: false, letzteStufe: null, naechsteStufe: null });
  });
  it('beruecksichtigt die Zahlungsfrist der einzelnen Rechnung', () => {
    expect(naechsteStufe({ datum: '2026-01-05', zahlungsfristTage: 10 }, [], '2026-01-16')).toBe(1);
    expect(naechsteStufe({ datum: '2026-01-05', zahlungsfristTage: 0 }, [], '2026-01-06')).toBe(1);
  });
});

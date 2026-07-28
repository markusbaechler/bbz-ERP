import { describe, it, expect } from 'vitest';
import { zahl, pruefePosition } from '../public/ui/eingabe.js';

// Befund I2: das Positionsformular war der einzige Schreibpfad ohne Pruefung.
// `Number('33,5')` ergibt NaN, JSON.stringify macht daraus null, und die
// numeric-not-null-Verletzung kam als englisches 500 zurueck. Die Auswertung
// liegt hier als reine Funktion, damit sie ohne DOM pruefbar ist.
describe('zahl', () => {
  it('nimmt das Komma als Dezimalzeichen an — das ist die Schweizer Tastatur, kein Fehler', () => {
    expect(zahl('33,5')).toBe(33.5);
    expect(zahl('33.5')).toBe(33.5);
    expect(zahl('0,25')).toBe(0.25);
  });

  it('nimmt Apostroph und Leerzeichen als Tausendertrenner', () => {
    expect(zahl("1'250.00")).toBe(1250);
    expect(zahl("12'345,60")).toBe(12345.6);
  });

  it('liefert null statt NaN fuer Leeres und Unlesbares', () => {
    expect(zahl('')).toBeNull();
    expect(zahl('   ')).toBeNull();
    expect(zahl(null)).toBeNull();
    expect(zahl('abc')).toBeNull();
    expect(zahl('3,5,5')).toBeNull();
    expect(zahl('-')).toBeNull();
  });

  it('liest gewoehnliche Zahlen unveraendert', () => {
    expect(zahl('1')).toBe(1);
    expect(zahl('230')).toBe(230);
    expect(zahl('-4,5')).toBe(-4.5);
  });
});

describe('pruefePosition', () => {
  const gut = { beschreibung: 'Beratung', menge: '33,5', einzelpreis: "1'250,00" };

  it('gibt die ausgewerteten Werte zurueck, wenn alles stimmt', () => {
    expect(pruefePosition(gut)).toEqual({ werte: { beschreibung: 'Beratung', menge: 33.5, einzelpreis: 1250 } });
  });

  it('trimmt die Beschreibung', () => {
    expect(pruefePosition({ ...gut, beschreibung: '  Beratung  ' }).werte!.beschreibung).toBe('Beratung');
  });

  it('weist eine leere Beschreibung ab und benennt das Feld', () => {
    const { fehler } = pruefePosition({ ...gut, beschreibung: '   ' });
    expect(fehler!.feld).toBe('beschreibung');
    expect(fehler!.meldung).toMatch(/Beschreibung/);
  });

  it('weist eine unlesbare Menge ab, statt sie als null zu senden', () => {
    const { fehler } = pruefePosition({ ...gut, menge: 'drei' });
    expect(fehler!.feld).toBe('menge');
    expect(fehler!.meldung).toMatch(/Menge/);
  });

  it('weist Menge und Preis von 0 ab (sonst stille CHF-0.00-Zeile)', () => {
    expect(pruefePosition({ ...gut, menge: '0' }).fehler!.feld).toBe('menge');
    expect(pruefePosition({ ...gut, einzelpreis: '0' }).fehler!.feld).toBe('einzelpreis');
    expect(pruefePosition({ ...gut, einzelpreis: '' }).fehler!.feld).toBe('einzelpreis');
  });

  it('weist mehr als zwei Nachkommastellen ab — Befund C1, gleiche Regel wie im Repo', () => {
    const { fehler } = pruefePosition({ ...gut, menge: '33,555' });
    expect(fehler!.feld).toBe('menge');
    expect(fehler!.meldung).toMatch(/Nachkommastellen/);
    expect(pruefePosition({ ...gut, einzelpreis: '0,085' }).fehler!.feld).toBe('einzelpreis');
  });

  it('laesst zwei Nachkommastellen zu, auch wenn die Gleitkomma-Darstellung driftet', () => {
    for (const s of ['1,15', '8,29', '1234567,89', '0,05']) {
      expect(pruefePosition({ ...gut, menge: s }).fehler).toBeUndefined();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { franken, datum, prozent, menge } from '../public/ui/format.js';

describe('franken', () => {
  it('setzt Apostroph-Tausender und zwei Nachkommastellen', () => {
    expect(franken(4435265)).toBe("4'435'265.00");
    expect(franken(8329.1)).toBe("8'329.10");
    expect(franken(0)).toBe('0.00');
  });
  it('zeigt negative Betraege mit Minus', () => {
    expect(franken(-1234.5)).toBe("-1'234.50");
  });
  it('zeigt fehlende Werte als Gedankenstrich', () => {
    expect(franken(null)).toBe('—');
  });
});

describe('datum', () => {
  it('wandelt ISO nach Schweizer Schreibweise', () => {
    expect(datum('2026-07-27')).toBe('27.07.2026');
    expect(datum('2026-01-01')).toBe('01.01.2026');
  });
  it('zeigt fehlende Werte als Gedankenstrich', () => {
    expect(datum(null)).toBe('—');
  });
  it('zeigt unsaubere Eingaben als Gedankenstrich statt als Datum', () => {
    expect(datum('banana')).toBe('—');
    expect(datum('2026-07')).toBe('—');
    expect(datum('27.07.2026')).toBe('—');
  });
});

describe('prozent und menge', () => {
  it('formatiert Saetze und Mengen lesbar', () => {
    expect(prozent(8.1)).toBe('8.1 %');
    expect(prozent(0)).toBe('0 %');
    expect(menge(33.5)).toBe('33.5');
    expect(menge(1)).toBe('1');
    expect(menge(0.25)).toBe('0.25');
  });
});

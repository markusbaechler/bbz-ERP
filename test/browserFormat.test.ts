import { describe, it, expect } from 'vitest';
import { franken, datum, prozent, menge, text } from '../public/ui/format.js';
import { laedt, leer, fehler } from '../public/ui/zustand.js';

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

describe('text', () => {
  it('maskiert Sonderzeichen fuer die Verwendung in innerHTML', () => {
    expect(text('Müller & Co. <script>')).toBe('Müller &amp; Co. &lt;script&gt;');
  });
  it('zeigt fehlende Werte als Leerstring', () => {
    expect(text(null)).toBe('');
    expect(text(undefined)).toBe('');
  });
});

// Befund I4: leer() und fehler() haben die Maskierungs-Nachruestung aus Task 4
// nicht mitbekommen. Heute reichen beide Aufrufer nur Literale herein, aber der
// Parameter heisst `text` — der naechste Screen wird eine Servermeldung
// hineingeben. Kein DOM noetig: die Helfer schreiben nur `innerHTML`.
describe('Zustandsmeldungen', () => {
  const leiste = () => ({ innerHTML: '' } as { innerHTML: string });

  it('maskiert den Text in leer()', () => {
    const el = leiste();
    leer(el, 'Kein Treffer für <script>alert(1)</script> & Co.');
    expect(el.innerHTML).toContain('&lt;script&gt;');
    expect(el.innerHTML).toContain('&amp; Co.');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('maskiert den Text in fehler()', () => {
    const el = leiste();
    fehler(el, '<img src=x onerror="alert(1)">');
    expect(el.innerHTML).toContain('&lt;img');
    expect(el.innerHTML).not.toContain('<img');
  });

  it('laedt() bleibt ein Literal', () => {
    const el = leiste();
    laedt(el);
    expect(el.innerHTML).toContain('Lädt');
  });
});

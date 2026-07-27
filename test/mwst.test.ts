import { describe, it, expect } from 'vitest';
import { rappenRunden, berechneMwst } from '../src/domain/mwst';

describe('rappenRunden', () => {
  it('rundet auf 0.05', () => {
    expect(rappenRunden(624.105)).toBe(624.10);
    expect(rappenRunden(1.024)).toBe(1.00);
    expect(rappenRunden(1.026)).toBe(1.05);
  });
});

describe('berechneMwst exkl', () => {
  it('Beispielbeleg: 7705 @ 8.1% -> Steuer 624.10, Brutto 8329.10', () => {
    const e = berechneMwst([{ betrag: 7705, satz: 8.1 }], 'exkl');
    expect(e.totalNetto).toBe(7705);
    expect(e.totalSteuer).toBe(624.10);
    expect(e.totalBrutto).toBe(8329.10);
    expect(e.proSatz).toHaveLength(1);
    expect(e.proSatz[0]).toEqual({ satz: 8.1, netto: 7705, steuer: 624.10, brutto: 8329.10 });
  });
  it('mehrsatzig: 1000@8.1 + 500@2.6 gruppiert je Satz', () => {
    const e = berechneMwst([{ betrag: 1000, satz: 8.1 }, { betrag: 500, satz: 2.6 }], 'exkl');
    expect(e.totalNetto).toBe(1500);
    expect(e.totalSteuer).toBe(94.00); // 81.00 + 13.00
    expect(e.proSatz.find((z) => z.satz === 8.1)!.steuer).toBe(81.00);
    expect(e.proSatz.find((z) => z.satz === 2.6)!.steuer).toBe(13.00);
  });
});

describe('berechneMwst inkl', () => {
  it('108.10 inkl 8.1% -> netto 100.00, steuer 8.10', () => {
    const e = berechneMwst([{ betrag: 108.10, satz: 8.1 }], 'inkl');
    expect(e.totalNetto).toBe(100.00);
    expect(e.totalSteuer).toBe(8.10);
    expect(e.totalBrutto).toBe(108.10);
  });
});

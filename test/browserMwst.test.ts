import { describe, it, expect } from 'vitest';
import { berechneMwst as serverMwst, rappenRunden as serverRunden } from '../src/domain/mwst';
import { berechneMwst as browserMwst, rappenRunden as browserRunden } from '../public/ui/mwst.js';

const faelle: { positionen: { betrag: number; satz: number }[]; modus: 'exkl' | 'inkl' }[] = [
  { positionen: [{ betrag: 7705, satz: 8.1 }], modus: 'exkl' },                       // der echte Beleg
  { positionen: [{ betrag: 8329.1, satz: 8.1 }], modus: 'inkl' },
  { positionen: [{ betrag: 1000, satz: 8.1 }, { betrag: 500, satz: 2.6 }], modus: 'exkl' },
  { positionen: [{ betrag: 333.33, satz: 8.1 }, { betrag: 66.67, satz: 8.1 }], modus: 'exkl' },
  { positionen: [{ betrag: 1, satz: 0 }], modus: 'exkl' },
  { positionen: [], modus: 'exkl' },
  // Befund I7: erst ab drei verschiedenen Saetzen und erst im Modus `inkl`
  // koennten die beiden Umsetzungen ueberhaupt auseinanderlaufen — die
  // Rueckrechnung je Satz vor der Gruppierung ist die Stelle, an der sich ein
  // Unterschied verstecken wuerde.
  { positionen: [{ betrag: 1000, satz: 8.1 }, { betrag: 500, satz: 2.6 }, { betrag: 200, satz: 3.8 }, { betrag: 50, satz: 0 }], modus: 'exkl' },
  { positionen: [{ betrag: 1081, satz: 8.1 }, { betrag: 513, satz: 2.6 }, { betrag: 103.80, satz: 3.8 }], modus: 'inkl' },
];

describe('MWSt im Browser', () => {
  it('rundet auf 0.05 wie der Server', () => {
    for (const x of [0, 0.02, 0.03, 8329.12, 624.07, -1.23]) {
      expect(browserRunden(x)).toBe(serverRunden(x));
    }
  });

  it('liefert fuer jeden Fall exakt das Server-Ergebnis', () => {
    for (const f of faelle) {
      expect(browserMwst(f.positionen, f.modus)).toEqual(serverMwst(f.positionen, f.modus));
    }
  });

  it('reproduziert den echten Beleg', () => {
    const e = browserMwst([{ betrag: 7705, satz: 8.1 }], 'exkl');
    expect(e.totalNetto).toBe(7705);
    expect(e.totalSteuer).toBe(624.1);
    expect(e.totalBrutto).toBe(8329.1);
    expect(e.proSatz).toHaveLength(1);
  });
});

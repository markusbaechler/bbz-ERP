// Typdeklaration nur fuer tsc, damit der Test-Import aus test/browserMwst.test.ts
// nicht als "implicit any" gemeldet wird. public/ selbst bleibt ohne Build-Schritt reines JS.
export declare function rappenRunden(x: number): number;

export type MwstZeile = { satz: number; netto: number; steuer: number; brutto: number };
export type MwstErgebnis = { proSatz: MwstZeile[]; totalNetto: number; totalSteuer: number; totalBrutto: number };

export declare function berechneMwst(
  positionen: { betrag: number; satz: number }[],
  modus: 'exkl' | 'inkl'
): MwstErgebnis;

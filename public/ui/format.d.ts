// Typdeklaration nur fuer tsc, damit der Test-Import aus test/browserFormat.test.ts
// nicht als "implicit any" gemeldet wird. public/ selbst bleibt ohne Build-Schritt reines JS.
export declare function franken(n: number | null): string;
export declare function datum(iso: string | null): string;
export declare function prozent(n: number): string;
export declare function menge(n: number): string;

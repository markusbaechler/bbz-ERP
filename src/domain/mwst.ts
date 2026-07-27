export function rappenRunden(x: number): number {
  return Math.round(x * 20) / 20;
}

export type MwstZeile = { satz: number; netto: number; steuer: number; brutto: number };
export type MwstErgebnis = { proSatz: MwstZeile[]; totalNetto: number; totalSteuer: number; totalBrutto: number };

export function berechneMwst(positionen: { betrag: number; satz: number }[], modus: 'exkl' | 'inkl'): MwstErgebnis {
  const nettoJeSatz = new Map<number, number>();
  for (const p of positionen) {
    const netto = modus === 'exkl' ? p.betrag : (p.betrag * 100) / (100 + p.satz);
    nettoJeSatz.set(p.satz, (nettoJeSatz.get(p.satz) ?? 0) + netto);
  }
  const proSatz: MwstZeile[] = [];
  for (const [satz, nettoRoh] of [...nettoJeSatz.entries()].sort((a, b) => b[0] - a[0])) {
    const netto = rappenRunden(nettoRoh);
    const steuer = rappenRunden((netto * satz) / 100);
    proSatz.push({ satz, netto, steuer, brutto: rappenRunden(netto + steuer) });
  }
  const totalNetto = rappenRunden(proSatz.reduce((s, z) => s + z.netto, 0));
  const totalSteuer = rappenRunden(proSatz.reduce((s, z) => s + z.steuer, 0));
  return { proSatz, totalNetto, totalSteuer, totalBrutto: rappenRunden(totalNetto + totalSteuer) };
}

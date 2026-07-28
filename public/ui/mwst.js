// Spiegel von src/domain/mwst.ts. Aenderungen dort MUESSEN hier nachgezogen werden —
// test/browserMwst.test.ts vergleicht beide Fassungen und schlaegt sonst fehl.
export function rappenRunden(x) {
  return Math.round(x * 20) / 20;
}

export function berechneMwst(positionen, modus) {
  const nettoJeSatz = new Map();
  for (const p of positionen) {
    const netto = modus === 'exkl' ? p.betrag : (p.betrag * 100) / (100 + p.satz);
    nettoJeSatz.set(p.satz, (nettoJeSatz.get(p.satz) ?? 0) + netto);
  }
  const proSatz = [];
  for (const [satz, nettoRoh] of [...nettoJeSatz.entries()].sort((a, b) => b[0] - a[0])) {
    const netto = rappenRunden(nettoRoh);
    const steuer = rappenRunden((netto * satz) / 100);
    proSatz.push({ satz, netto, steuer, brutto: rappenRunden(netto + steuer) });
  }
  const totalNetto = rappenRunden(proSatz.reduce((s, z) => s + z.netto, 0));
  const totalSteuer = rappenRunden(proSatz.reduce((s, z) => s + z.steuer, 0));
  return { proSatz, totalNetto, totalSteuer, totalBrutto: rappenRunden(totalNetto + totalSteuer) };
}

/** Minimale camt.054-Gutschriftsanzeige fuer Tests: eine Sammelbuchung mit je einer TxDtls pro Zahlung. */
export function camt054(zahlungen: { betrag: number; datum: string; txRef: string; qrr?: string; mitteilung?: string; waehrung?: string }[]): string {
  const tx = zahlungen.map((z) => `
      <TxDtls><Refs><AcctSvcrRef>${z.txRef}</AcctSvcrRef></Refs>
        <Amt Ccy="${z.waehrung ?? 'CHF'}">${z.betrag.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <RmtInf>${z.qrr ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${z.qrr}</Ref></CdtrRefInf></Strd>` : ''}${z.mitteilung ? `<Ustrd>${z.mitteilung}</Ustrd>` : ''}</RmtInf>
      </TxDtls>`).join('');
  const total = zahlungen.reduce((s, z) => s + z.betrag, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>T</MsgId><CreDtTm>2026-11-02T06:00:00</CreDtTm></GrpHdr>
  <Ntfctn><Id>N</Id><Ntry><Amt Ccy="CHF">${total.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>${zahlungen[0]?.datum ?? '2026-11-02'}</Dt></BookgDt><NtryDtls>${tx}</NtryDtls></Ntry></Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`;
}

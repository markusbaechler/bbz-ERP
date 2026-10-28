import { describe, it, expect } from 'vitest';
import { parseCamt054, lfdNrAusQrr } from '../src/domain/camt054';
import { qrReferenzRoh } from '../src/domain/qrReferenz';

const REF = qrReferenzRoh(33215);

/** camt.054 (Gutschriftsanzeige der Bank) mit einer Sammelbuchung aus zwei QR-Zahlungen, einer Zahlung ohne Referenz und einer Belastung. */
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
 <BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>MSG-1</MsgId><CreDtTm>2026-11-02T06:00:00</CreDtTm></GrpHdr>
  <Ntfctn>
   <Id>N-1</Id>
   <Ntry>
    <Amt Ccy="CHF">1250.50</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-11-02</Dt></BookgDt><ValDt><Dt>2026-11-03</Dt></ValDt>
    <AcctSvcrRef>BANK-REF-1</AcctSvcrRef>
    <NtryDtls>
     <TxDtls>
      <Refs><AcctSvcrRef>TX-1</AcctSvcrRef></Refs>
      <Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      <RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${REF}</Ref></CdtrRefInf></Strd></RmtInf>
     </TxDtls>
     <TxDtls>
      <Refs><AcctSvcrRef>TX-2</AcctSvcrRef></Refs>
      <Amt Ccy="CHF">250.50</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      <RmtInf><Ustrd>Rechnung 33216</Ustrd></RmtInf>
     </TxDtls>
    </NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="CHF">80.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
    <BookgDt><Dt>2026-11-02</Dt></BookgDt>
    <NtryDtls><TxDtls><Amt Ccy="CHF">80.00</Amt><CdtDbtInd>DBIT</CdtDbtInd></TxDtls></NtryDtls>
   </Ntry>
  </Ntfctn>
 </BkToCstmrDbtCdtNtfctn>
</Document>`;

describe('camt.054 (Zahlungseingaenge der Bank)', () => {
  it('liest Einzelbuchungen einer Sammelbuchung mit Referenz, Betrag, Buchungsdatum und Bankreferenz', () => {
    const b = parseCamt054(CAMT);
    expect(b.filter((x) => x.gutschrift)).toEqual([
      { referenz: REF, betrag: 1000, waehrung: 'CHF', datum: '2026-11-02', bankReferenz: 'TX-1', gutschrift: true, mitteilung: null },
      { referenz: null, betrag: 250.5, waehrung: 'CHF', datum: '2026-11-02', bankReferenz: 'TX-2', gutschrift: true, mitteilung: 'Rechnung 33216' },
    ]);
  });
  it('markiert Belastungen (DBIT) als keine Gutschrift', () => {
    expect(parseCamt054(CAMT).filter((x) => !x.gutschrift)).toHaveLength(1);
  });
  it('lehnt Dokumente ab, die keine camt.054 sind', () => {
    expect(() => parseCamt054('<Document><Foo/></Document>')).toThrow(/camt\.054/);
  });
  it('liest die laufende Rechnungsnummer aus der QR-Referenz (Praefix und Pruefziffer werden geprueft)', () => {
    expect(lfdNrAusQrr(REF)).toBe(33215);
    expect(lfdNrAusQrr(REF.slice(0, 26) + String((Number(REF[26]) + 1) % 10))).toBeNull();   // falsche Pruefziffer
    expect(lfdNrAusQrr('12345')).toBeNull();
    expect(lfdNrAusQrr(qrReferenzRoh(7, '999999'))).toBeNull();                              // fremdes Praefix
  });
});

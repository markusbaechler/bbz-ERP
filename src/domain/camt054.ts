import { XMLParser } from 'fast-xml-parser';
import { calculateQRReferenceChecksum } from 'swissqrbill/utils';
import { CREDITOR } from '../config/creditor';
import { ValidationError } from './errors';

/*
 * camt.054 (ISO 20022, Swiss Payment Standards): Gutschriftsanzeige der Bank fuer QR-Zahlungen. Loest den
 * ESR-Bankfile-Import der FileMaker-Loesung ab (VESR_imp). Eine Buchung (Ntry) kann eine Sammelbuchung mit
 * mehreren Einzelzahlungen (TxDtls) sein; massgebend ist je Zahlung die QR-Referenz (QRR) in RmtInf/Strd.
 */

export type Camt054Buchung = {
  referenz: string | null;      // QRR/SCOR ohne Leerzeichen
  betrag: number;
  waehrung: string;
  datum: string;                // Buchungsdatum YYYY-MM-DD
  bankReferenz: string | null;  // AcctSvcrRef der Einzelzahlung (sonst der Buchung) – fuer die Idempotenz
  gutschrift: boolean;          // CRDT; Belastungen (DBIT) werden nicht verbucht
  mitteilung: string | null;    // unstrukturierte Mitteilung, falls keine Referenz
};

const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true,
  isArray: (name) => ['Ntfctn', 'Ntry', 'NtryDtls', 'TxDtls', 'Ustrd'].includes(name),
});

const textVon = (n: any): string | null => {
  if (n === undefined || n === null) return null;
  const t = typeof n === 'object' ? n['#text'] : n;
  return t === undefined || t === null || String(t).trim() === '' ? null : String(t).trim();
};
const datumVon = (n: any): string | null => textVon(n?.Dt) ?? textVon(n?.DtTm)?.slice(0, 10) ?? null;

export function parseCamt054(inhalt: string): Camt054Buchung[] {
  const doc = xml.parse(inhalt);
  const wurzel = doc?.Document?.BkToCstmrDbtCdtNtfctn;
  if (!wurzel) throw new ValidationError('Keine camt.054-Datei (BkToCstmrDbtCdtNtfctn fehlt)');
  const out: Camt054Buchung[] = [];
  for (const ntf of wurzel.Ntfctn ?? []) for (const ntry of ntf.Ntry ?? []) {
    const datum = datumVon(ntry.BookgDt) ?? datumVon(ntry.ValDt);
    if (!datum) throw new ValidationError('Buchung ohne Buchungsdatum');
    const txs = (ntry.NtryDtls ?? []).flatMap((d: any) => d.TxDtls ?? []);
    const einzel = txs.length ? txs : [{}];
    for (const tx of einzel) {
      const amt = tx.Amt ?? ntry.Amt;
      const ref = textVon(tx.RmtInf?.Strd?.CdtrRefInf?.Ref);
      out.push({
        referenz: ref ? ref.replace(/\s+/g, '') : null,
        betrag: Number(textVon(amt)),
        waehrung: amt?.['@_Ccy'] ?? 'CHF',
        datum,
        bankReferenz: textVon(tx.Refs?.AcctSvcrRef) ?? textVon(ntry.AcctSvcrRef),
        gutschrift: (textVon(tx.CdtDbtInd) ?? textVon(ntry.CdtDbtInd)) === 'CRDT',
        mitteilung: (tx.RmtInf?.Ustrd ?? []).map(textVon).filter(Boolean).join(' ') || null,
      });
    }
  }
  return out;
}

/** Laufende Rechnungsnummer aus einer QR-Referenz der bbz (Umkehrung von qrReferenzRoh); null, wenn fremd oder ungueltig. */
export function lfdNrAusQrr(referenz: string, prefix: string = CREDITOR.qrrPrefix): number | null {
  const r = referenz.replace(/\s+/g, '');
  if (!/^\d{27}$/.test(r) || !r.startsWith(prefix)) return null;
  if (calculateQRReferenceChecksum(r.slice(0, 26)) !== r.slice(26)) return null;
  const nr = Number(r.slice(prefix.length, 26));
  return nr > 0 ? nr : null;
}

export type Camt054Gutschrift = { betrag: number; datum: string; txRef: string; qrr?: string; mitteilung?: string; waehrung?: string };

/** Minimale camt.054-Gutschriftsanzeige (Tests, Beispieldatei der Testumgebung): eine Sammelbuchung mit je einer TxDtls pro Zahlung. */
export function baueCamt054(zahlungen: Camt054Gutschrift[]): string {
  const tx = zahlungen.map((z) => `
      <TxDtls><Refs><AcctSvcrRef>${z.txRef}</AcctSvcrRef></Refs>
        <Amt Ccy="${z.waehrung ?? 'CHF'}">${z.betrag.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <RmtInf>${z.qrr ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${z.qrr}</Ref></CdtrRefInf></Strd>` : ''}${z.mitteilung ? `<Ustrd>${z.mitteilung}</Ustrd>` : ''}</RmtInf>
      </TxDtls>`).join('');
  const total = zahlungen.reduce((s, z) => s + z.betrag, 0);
  const datum = zahlungen[0]?.datum ?? '2026-11-02';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>T</MsgId><CreDtTm>${datum}T06:00:00</CreDtTm></GrpHdr>
  <Ntfctn><Id>N</Id><Ntry><Amt Ccy="CHF">${total.toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>${datum}</Dt></BookgDt><NtryDtls>${tx}</NtryDtls></Ntry></Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`;
}

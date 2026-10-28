import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import type { Rechnung, Rechnungsposition, Auftraggeber } from '../domain/types';
import { CREDITOR } from '../config/creditor';
import { baueQrDaten } from '../domain/qrRechnung';
import { berechneMwst } from '../domain/mwst';

export function erzeugeRechnungPdf(rechnung: Rechnung, positionen: Rechnungsposition[], auftraggeber: Auftraggeber): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const fertig = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Kopf (Creditor)
  doc.fontSize(9).text(CREDITOR.name, { align: 'right' });
  doc.text(`${CREDITOR.address} ${CREDITOR.buildingNumber}, ${CREDITOR.zip} ${CREDITOR.city}`, { align: 'right' });
  doc.moveDown();
  // Empfaenger
  doc.fontSize(11).text(auftraggeber.name);
  doc.text(auftraggeber.strasse);
  doc.text(`${auftraggeber.plz} ${auftraggeber.ort}`);
  doc.moveDown();
  // Meta
  const gutschrift = rechnung.typ === 'gutschrift';
  if (gutschrift) doc.font('Helvetica-Bold').fontSize(14).text('Gutschrift (Storno-Beleg)').font('Helvetica').moveDown(0.5);
  doc.fontSize(10).text(`${gutschrift ? 'Gutschrift' : 'Rechnungs'}-Nr.: ${rechnung.nummer ?? ''}`);
  doc.text(`Datum: ${rechnung.datum}`);
  if (rechnung.betreff) doc.font('Helvetica-Bold').text(rechnung.betreff).font('Helvetica');
  doc.moveDown();
  // Positionen
  for (const p of positionen) {
    doc.text(`${p.beschreibung}   ${p.menge} ${p.einheit} à ${p.einzelpreis.toFixed(2)}   ${p.mwstSatz}%   ${p.betragNetto.toFixed(2)}`);
  }
  doc.moveDown();
  // MWSt-Zusammenfassung
  const e = berechneMwst(positionen.map((p) => ({ betrag: p.betragNetto, satz: p.mwstSatz })), rechnung.mwstModus);
  for (const z of e.proSatz) doc.text(`Netto ${z.netto.toFixed(2)} à ${z.satz}% = MWSt ${z.steuer.toFixed(2)}`);
  doc.font('Helvetica-Bold').text(`${gutschrift ? 'Gutschriftsbetrag' : 'Rechnungsbetrag'}: CHF ${e.totalBrutto.toFixed(2)}`).font('Helvetica');

  // QR-Zahlteil (Slip unten / eigene Seite) – nicht bei Gutschriften (kein Zahlungsauftrag)
  if (!gutschrift) {
    const qr = new SwissQRBill(baueQrDaten(rechnung, auftraggeber));
    qr.attachTo(doc);
  }

  doc.end();
  return fertig;
}

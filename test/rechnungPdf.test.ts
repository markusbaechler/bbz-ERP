import { describe, it, expect } from 'vitest';
import { erzeugeRechnungPdf } from '../src/pdf/rechnungPdf';
import type { Rechnung, Rechnungsposition, Auftraggeber } from '../src/domain/types';

const auftraggeber: Auftraggeber = {
  id: 'a1', nummer: '20577', name: 'bbz academy', strasse: 'Zürcherstrasse 202',
  plz: '9014', ort: 'St. Gallen', land: 'CH', ansprechperson: null, email: null, telefon: null, aktiv: true,
};
const rechnung: Rechnung = {
  id: 'r1', projektId: 'p1', auftraggeberId: 'a1', datum: '2026-07-23', betreff: 'Verrechnung',
  mwstModus: 'exkl', waehrung: 'CHF', lfdNr: 33214, nummer: '6231.26 - 33214 ml',
  status: 'abgerechnet', totalNetto: 7705, totalMwst: 624.10, totalBrutto: 8329.10,
};
const positionen: Rechnungsposition[] = [
  { id: 'x', rechnungId: 'r1', position: 1, beschreibung: '33.5 Std. à 230.00', menge: 33.5, einheit: 'Std', einzelpreis: 230, mwstSatz: 8.1, kontoId: null, betragNetto: 7705 },
];

describe('erzeugeRechnungPdf', () => {
  it('erzeugt ein nicht-leeres PDF', async () => {
    const buf = await erzeugeRechnungPdf(rechnung, positionen, auftraggeber);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

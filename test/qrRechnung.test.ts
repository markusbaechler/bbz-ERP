import { describe, it, expect } from 'vitest';
import { baueQrDaten } from '../src/domain/qrRechnung';
import { ValidationError } from '../src/domain/errors';
import type { Rechnung, Auftraggeber } from '../src/domain/types';

const auftraggeber: Auftraggeber = {
  id: 'a1', nummer: '20577', name: 'bbz academy', strasse: 'Zürcherstrasse 202',
  plz: '9014', ort: 'St. Gallen', land: 'CH', ansprechperson: null, email: null, telefon: null, aktiv: true,
  zusatz: null, adresseUnvollstaendig: false,
};
const rechnung: Rechnung = {
  id: 'r1', projektId: 'p1', auftraggeberId: 'a1', datum: '2026-07-23', betreff: 'Test',
  mwstModus: 'exkl', waehrung: 'CHF', lfdNr: 33214, nummer: '6231.26 - 33214 ml',
  status: 'abgerechnet', totalNetto: 7705, totalMwst: 624.10, totalBrutto: 8329.10,
};

describe('baueQrDaten', () => {
  it('setzt Creditor QR-IBAN, Referenz, Betrag und Debitor', () => {
    const d = baueQrDaten(rechnung, auftraggeber);
    expect(d.creditor.account).toBe('CH4430777003713211030');
    expect(d.amount).toBe(8329.10);
    expect(d.currency).toBe('CHF');
    expect(d.reference).toBe('761040000000000000000332141');
    expect(d.debtor?.name).toBe('bbz academy');
    expect(d.debtor?.city).toBe('St. Gallen');
  });
  it('verweigert nicht festgeschriebene Rechnung', () => {
    expect(() => baueQrDaten({ ...rechnung, lfdNr: null }, auftraggeber)).toThrow(ValidationError);
  });

  it('laesst zusatz bewusst aus dem Debitor-Feld des QR-Zahlteils weg (nur der Brief traegt ihn)', () => {
    // Das QR-Debitorfeld "name" ist auf 70 Zeichen begrenzt und kennt keine eigene
    // Zusatzzeile (anders als der Adressblock im Brief). Ein Zusammenfuegen von
    // Name und Zusatz wuerde bei anderen Auftraggebern unvorhersehbar an dieser
    // Grenze scheitern (swissqrbill wirft dann einen Validierungsfehler) - fuer
    // einen Zahlteil, den die Bank zur Zahlungsverarbeitung nutzt, nicht zur
    // Postzustellung. Die Zustellung haengt am Brief, der die Zusatzzeile bereits
    // separat druckt (siehe rechnungPdf.test.ts). Deshalb bleibt der QR-Debitor
    // unveraendert nur auftraggeber.name, ohne Anhaengen von zusatz.
    const auftraggeberMitZusatz = {
      ...auftraggeber,
      name: 'Universität St. Gallen',
      zusatz: 'Institut für Banken und Finanzen',
    };
    const d = baueQrDaten(rechnung, auftraggeberMitZusatz);
    expect(d.debtor?.name).toBe('Universität St. Gallen');
    expect(d.debtor?.name).not.toContain('Institut');
    expect((d.debtor?.name ?? '').length).toBeLessThanOrEqual(70);
  });
});

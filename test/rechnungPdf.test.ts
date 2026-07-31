import { describe, it, expect } from 'vitest';
import { erzeugeRechnungPdf } from '../src/pdf/rechnungPdf';
import type { Rechnung, Rechnungsposition, Auftraggeber } from '../src/domain/types';
import { extrahierePdfZeilen } from './helpers/pdfText';

const auftraggeber: Auftraggeber = {
  id: 'a1', nummer: '20577', name: 'bbz academy', strasse: 'Zürcherstrasse 202',
  plz: '9014', ort: 'St. Gallen', land: 'CH', ansprechperson: null, email: null, telefon: null, aktiv: true,
  zusatz: null, adresseUnvollstaendig: false,
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

  it('druckt Zusatz als eigene Zeile direkt unter dem Namen (z. B. Institut einer Uni)', async () => {
    const auftraggeberMitZusatz: Auftraggeber = {
      ...auftraggeber,
      name: 'Universität St. Gallen',
      zusatz: 'Institut für Banken und Finanzen',
    };
    const buf = await erzeugeRechnungPdf(rechnung, positionen, auftraggeberMitZusatz);
    const zeilen = extrahierePdfZeilen(buf);

    const nameZeile = zeilen.find((z) => z.text === 'Universität St. Gallen');
    const zusatzZeile = zeilen.find((z) => z.text === 'Institut für Banken und Finanzen');
    const strasseZeile = zeilen.find((z) => z.text === auftraggeberMitZusatz.strasse);
    expect(nameZeile).toBeDefined();
    expect(zusatzZeile).toBeDefined();
    expect(strasseZeile).toBeDefined();

    // Zusatz liegt genau eine Zeile unter dem Namen, Strasse wiederum eine Zeile unter dem Zusatz
    // (gleicher Zeilenabstand wie ueberall sonst im Adressblock - keine zusaetzliche Luecke).
    const abstandNameZusatz = nameZeile!.y - zusatzZeile!.y;
    const abstandZusatzStrasse = zusatzZeile!.y - strasseZeile!.y;
    expect(abstandNameZusatz).toBeCloseTo(abstandZusatzStrasse, 3);
    expect(abstandNameZusatz).toBeGreaterThan(0);
  });

  it('laesst die Zusatz-Zeile weg, wenn zusatz null oder leer ist - keine Luecke im Adressblock', async () => {
    const ohneZusatz = { ...auftraggeber, zusatz: null };
    const leererZusatz = { ...auftraggeber, zusatz: '' };

    const bufOhne = await erzeugeRechnungPdf(rechnung, positionen, ohneZusatz);
    const bufLeer = await erzeugeRechnungPdf(rechnung, positionen, leererZusatz);

    for (const buf of [bufOhne, bufLeer]) {
      const zeilen = extrahierePdfZeilen(buf);
      expect(zeilen.some((z) => z.text === '')).toBe(false);

      const nameZeile = zeilen.find((z) => z.text === auftraggeber.name);
      const strasseZeile = zeilen.find((z) => z.text === auftraggeber.strasse);
      expect(nameZeile).toBeDefined();
      expect(strasseZeile).toBeDefined();
      // Strasse folgt unmittelbar auf den Namen (Standard-Zeilenabstand, kein Zusatz dazwischen).
      const zeilenIndexName = zeilen.indexOf(nameZeile!);
      const zeilenIndexStrasse = zeilen.indexOf(strasseZeile!);
      expect(zeilenIndexStrasse).toBe(zeilenIndexName + 1);
    }
  });
});

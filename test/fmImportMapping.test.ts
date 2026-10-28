import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pruefeMapping } from '../tools/fm-import/import';

const lade = (datei: string) => JSON.parse(readFileSync(join(__dirname, '../tools/fm-import', datei), 'utf8'));

describe('fm-import: Mapping pruefen', () => {
  it('meldet unbekannte Tabellen, unbekannte ERP-Felder und fehlende Pflichtfelder; "_"-Schluessel sind Kommentare', () => {
    expect(pruefeMapping({
      _hinweis: 'x',
      projekte: { datei: 'P.mer', felder: { name: 'Name', auftraggeberNummer: 'AG', projektnr: 'Nr' }, _quelle: 'x' },
      rechnungen: { datei: 'R.mer', felder: { lfdNr: 'RgNr', projektNummer: 'P', datum: 'D' } },
      foo: { datei: 'F.mer', felder: {} },
    } as any)).toEqual([
      'projekte.projektnr: unbekanntes ERP-Feld',
      'rechnungen.totalBrutto: Pflichtfeld ohne Zuordnung',
      'foo: unbekannte Tabelle',
    ]);
  });

  it('das Beispiel-Mapping ist vollstaendig', () => {
    expect(pruefeMapping(lade('mapping.beispiel.json'))).toEqual([]);
  });

  it('das bbz-Mapping nutzt die Dateien und Feldnamen der FileMaker-Loesung (Script-Ausdruck 28.10.2026)', () => {
    const m = lade('mapping.bbz.json');
    expect(m.projekte).toMatchObject({ datei: 'Projekte.mer', felder: { nummer: 'Projekt_Nr.', name: 'Projekt_Name', jahr: 'Jahr', kontoNummer: 'Konto' } });
    expect(m.rechnungen).toMatchObject({ datei: 'Faktura_P.mer', felder: { lfdNr: 'Rechnung Nr.', projektNummer: 'Projekt_Nr.' } });
    expect(m.kontakte).toMatchObject({ datei: 'Teilnehmer.mer', felder: { nachname: 'Name', vorname: 'Vorname', email: 'eMail' } });
    // offen bis zum ersten echten Export: Feldname des Rechnungstotals (im Ausdruck nicht referenziert)
    expect(pruefeMapping(m)).toEqual(['rechnungen.totalBrutto: Pflichtfeld ohne Zuordnung']);
  });
});

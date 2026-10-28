# Datenmigration FileMaker → bbz-ERP

Werkzeug: `tools/fm-import` (Plan 5). Grundsatz: **Probelauf zuerst**. Er führt den kompletten Import inklusive aller Regeln und DB-Constraints aus und rollt danach zurück.

## 1. Export aus FileMaker
Je Tabelle *Datei → Datensätze exportieren…*:
- **Format „Seriendruck (.mer)“**: Das ist CSV **mit Feldnamen in der Kopfzeile**. Das Format „CSV“ von FileMaker hat keine Kopfzeile.
- Ausgabezeichensatz **UTF-8**, „Formatierung des aktuellen Layouts anwenden“ **aus**.
- Alle Datensätze (vorher *Alle Datensätze anzeigen*).

| Datei | Inhalt | Pflichtfelder (ERP) |
|---|---|---|
| `Mitarbeitende.mer` | Kürzel, Vorname, Name, E-Mail | kuerzel, nachname |
| `Auftraggeber.mer` | Debitoren | nummer, name; Strasse/PLZ/Ort für den Debitor (sonst nur CRM-Organisation) |
| `Projekte.mer` | Projekte aller Jahre | Projektnummer `6231.26` (oder Stammnummer + Jahr), Name, Auftraggeber-Nr. |
| `Kontakte.mer` | Personen | Nachname (E-Mail dient dem Dubletten-Schutz) |
| `Fakturen.mer` | Rechnungen (mindestens offene, idealerweise alle) | RgNr, Projektnummer, Datum, Total brutto; Bezahlt/Bezahlt am |

## 2. Mapping
`tools/fm-import/mapping.beispiel.json` kopieren und die **Spaltennamen** an den echten Export anpassen. Den Vorschlag liefert `npm run fm:analyse` aus dem DDR: Die Datei `mapping-entwurf.json` enthält FM-Feld → ERP-Spalte. Wertelisten wie der Projektstatus werden über `werte` übersetzt.

## 3. Ablauf
```bash
npm run migrate
npm run fm:import -- --ordner "C:\Export\FileMaker" --mapping mapping.json                                  # Probelauf
npm run fm:import -- --ordner "C:\Export\FileMaker" --mapping mapping.json --zaehler-start 33215 --ausfuehren   # Import
```
- `--zaehler-start` = **nächster Serienwert** der Rechnungsnummer in FileMaker (DDR: Feld RgNr → Auto-Eingabe → nächster Wert). Damit schliesst die erste ERP-Rechnung **lückenlos** an. Ohne Angabe gilt das Maximum der importierten RgNr.
- Der Bericht `IMPORT-BERICHT.md` liegt im Exportordner. Er enthält Zähler je Tabelle, Fehlerzeilen (werden nicht übernommen), Hinweise sowie **Summen zum Abgleich** (Projekte und Budget je Jahr, Rechnungen brutto/bezahlt/offen, offene Posten je Debitor).
- Der Import ist **idempotent**: Erneute Läufe erkennen bestehende Datensätze (Nummer, Kürzel, E-Mail, RgNr) und legen nichts doppelt an. Fehlerzeilen korrigiert man in FileMaker und exportiert neu.

## 4. Abnahme
1. Die Summen aus dem Bericht mit dem FileMaker-Report vergleichen: Projekte je Jahr, Budget, offene Posten total und je Debitor.
2. Stichproben: 5 Projekte, 5 offene Rechnungen inklusive QR-PDF (`/rechnung/:id/pdf`).
3. Nach der Abnahme: FileMaker auf „nur lesen“ stellen, ab dann im ERP arbeiten.

Ergänzend für SAQ: Die Excel-Datei *Reporting_KUBA.xlsx* lässt sich über dasselbe Feldschema übernehmen (`GET /saq/export/kuba` zeigt das Zielformat). Das Import-Werkzeug dafür ist ein offener Folgeschritt.

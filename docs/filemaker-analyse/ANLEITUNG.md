# FileMaker-Funktionsumfang analysieren

Ziel: den **vollständigen** Funktionsumfang der FileMaker-Lösung erfassen (Tabellen, Felder, Berechnungen, Beziehungen, Layouts, Scripts, Wertelisten, Rechte) und gegen das ERP abgleichen. Screenshots zeigen nur, was gerade offen ist. Der **Datenbank-Designreport (DDR)** liefert die ganze Struktur maschinenlesbar.

## Weg A – Datenbank-Designreport (empfohlen, ca. 2 Minuten)

Voraussetzung: FileMaker **Pro Advanced** (bis Version 18) oder FileMaker Pro ab Version 19, und ein Konto mit **[Vollzugriff]**.

1. **Alle Dateien der Lösung öffnen.** Der DDR erfasst nur geöffnete Dateien. Mindestens „Projekte“ öffnen, dazu alle Dateien, auf die sie verweist (z. B. Seminare, Adressen).
2. Menü **Werkzeuge → Datenbank-Designreport…**
3. Unter **Dateien für den Bericht**: alle Dateien anhaken, je Datei **alle Tabellen**.
4. Unter **In Bericht einschliessen**: alles anhaken (Felder, Beziehungen, Layouts, Scripts, Wertelisten, Eigene Funktionen, Konten, Berechtigungssätze, Erweiterte Zugriffsrechte, Dateiverweise, Eigene Menüs, Script-Trigger).
5. **Berichtsformat: XML**. „Bericht nach Erstellung öffnen“ ausschalten.
6. **Erstellen** und einen Ordner wählen, z. B. `Dokumente\bbz-DDR`. Es entstehen `Summary.xml` und je Datei eine `<Datei>_fmp12.xml`.

> Der DDR enthält **keine Datensätze** und keine Passwörter. Er enthält aber Kontennamen. Der Bericht des Werkzeugs zeigt deshalb standardmässig nur die Anzahl Konten je Berechtigungssatz (nDSG); Namen erscheinen nur mit `--mit-konten`.

**Alternative ab FileMaker 19.5:** *Datei → Kopie speichern als… → XML* (Format `FMSaveAsXML`). Das Werkzeug liest es experimentell.

## Auswertung starten

### Lokal (Windows, im Repo-Ordner)
```powershell
powershell -ExecutionPolicy Bypass -File tools\fm-analyse\fm-analyse.ps1 -DdrPfad "$env:USERPROFILE\Documents\bbz-DDR"
```
oder direkt:
```bash
npm run fm:analyse -- "C:\Users\<name>\Documents\bbz-DDR" --out fm-analyse-out
```

### Über Google Drive (für eine Claude-Cloud-Session)
`bbz-DDR` zippen (`fm-analyse.ps1 -Zip` erledigt das) und ins eigene Google Drive legen. Claude lädt die Datei über den Drive-Connector und führt die Auswertung aus.

### Per Computer Use
Ist in der Claude-Desktop-App *Computer use* aktiv und der Rechner mit der Session gekoppelt, kann Claude Schritt 2–6 selbst im FileMaker-Fenster ausführen. Du bestätigst dabei den Zugriff auf „FileMaker Pro Advanced“.

## Ergebnis

| Datei | Inhalt |
|---|---|
| `FUNKTIONSUMFANG.md` | Kennzahlen · Dateien und Verweise · Tabellen mit ERP-Modul und Zieltabelle · Beziehungen · **Funktionsumfang aus Scripts** (Import, Export, PDF, Druck, E-Mail, Web/URL, Server …) mit Ablösung im ERP · Layouts · Wertelisten · Zugriff · **Lücken** |
| `inventar.json` | vollständiges Inventar (Grundlage für weitere Auswertungen) |
| `mapping-entwurf.json` | Feld-Mapping-Vorschlag FileMaker → ERP-Spalten für die Datenmigration (`tools/fm-import`) |

Die Modulzuordnung (`MODUL_REGELN`) und die Feld-Synonyme (`SYNONYME`) stehen in `tools/fm-analyse/analyse.ts`. Wenn der echte DDR Lücken zeigt, werden zuerst dort Regeln ergänzt. Danach wird das ERP erweitert, bis Kapitel 9 „Lücken“ leer ist.

## Weg B – Daten profilieren (für die Migration)
Je Tabelle *Datei → Datensätze exportieren…* als **CSV (UTF-8)**: Projekte, Auftraggeber, Fakturen, Positionen, Seminare, Teilnehmer, Mitarbeitende, Referenten. Diese Exporte liest `tools/fm-import` (siehe `docs/filemaker-analyse/MIGRATION.md`).

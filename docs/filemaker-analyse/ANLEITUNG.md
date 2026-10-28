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

## Weg C – Data API des FileMaker Servers (ohne FileMaker-Oberfläche)

Geeignet, wenn die Lösung auf einem **FileMaker Server** liegt (Spec v1: „Projekte“ auf `BBZ-AZ-SRVAPP01`) und niemand den DDR am Bildschirm erstellen kann. Das Werkzeug liest über die Data API: Layouts (mit Ordnern), Scripts (Namen und Ordner), Felder je Tabellenvorkommen (Typ, Berechnung/Statistik, global, Validierung, Werteliste), Wertelisten und die Datensatzanzahl je Tabellenvorkommen.

Voraussetzungen:
- Die Data API ist in der Admin Console des Servers aktiviert (Konnektoren → FileMaker Data API).
- Es gibt ein Konto mit dem erweiterten Zugriffsrecht **fmrest** und Leserechten auf alle Layouts, am besten ein eigenes Analysekonto.
- Die Metadaten-Endpunkte gibt es ab FileMaker Server 18 [Hypothese].
- Der Server ist per **https** erreichbar. Bei einem internen Zertifikat setzt du `NODE_EXTRA_CA_CERTS=<CA-Datei>`. Die TLS-Prüfung wird nie abgeschaltet.

```powershell
powershell -ExecutionPolicy Bypass -File tools\fm-analyse\fm-analyse.ps1 -Server "https://bbz-az-srvapp01.<domäne>" -Datenbank Projekte,Seminare -Benutzer analyse
```
Das Skript fragt das Passwort verdeckt ab und übergibt es nur über die Umgebungsvariable `FM_PASSWORT`. Direkt geht es mit `FM_PASSWORT=… npm run fm:analyse -- --data-api https://… --datenbank Projekte --benutzer analyse`.

Grenzen gegenüber Weg A:
- Keine Script-Schritte, Formeln, Beziehungsschlüssel und Konten.
- Tabellen erscheinen als Tabellenvorkommen und nur, soweit sie auf einem Layout liegen.

Datensatzinhalte und die Werte feldbasierter Wertelisten werden **nicht** übernommen. Für die Datensatzanzahl liest das Werkzeug je Tabellenvorkommen einen Datensatz und verwirft ihn sofort; mit `--ohne-anzahl` entfällt auch das. Weg C liefert schnell den Umfang. Für die Lückenanalyse der Scripts bleibt Weg A massgebend.

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

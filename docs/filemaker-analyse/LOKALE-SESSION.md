# FileMaker-Analyse in einer lokalen Claude-Session

Die Cloud-Session hat keinen Zugriff auf den Rechner, auf dem FileMaker Pro Advanced läuft. Deshalb läuft die direkte Analyse in einer Session **auf diesem Rechner**.

## Vorbereitung (einmalig)
1. **Claude Desktop** öffnen und unter **Settings → This computer → Computer use** einschalten.
2. **Node.js LTS** installieren (https://nodejs.org), falls es noch fehlt.
3. Repo holen:
   ```bash
   git clone https://github.com/markusbaechler/bbz-ERP
   cd bbz-ERP
   git checkout claude/admiring-archimedes-2segqh
   npm install
   ```
4. In Claude Desktop eine **lokale Code-Session** im Ordner `bbz-ERP` starten. Alternativ im Terminal `claude` oder `claude remote-control` ausführen.
5. In FileMaker die Lösung „Projekte“ **und alle Dateien öffnen, auf die sie verweist**, mit einem Konto mit [Vollzugriff].

## Auftrag für die lokale Session (einfügen)
```
Lies HANDOVER.md und docs/filemaker-analyse/ANLEITUNG.md.
1. Erstelle per Computer Use im geöffneten FileMaker Pro Advanced den Datenbank-Designreport (Weg A):
   alle geöffneten Dateien, alle Tabellen, alle Elemente, Format XML, Ziel %USERPROFILE%\Documents\bbz-DDR.
2. Führe aus: npm run fm:analyse -- "%USERPROFILE%\Documents\bbz-DDR" --out fm-analyse-out
   (%USERPROFILE% gilt nur in cmd; Git Bash: "$USERPROFILE/Documents/bbz-DDR", PowerShell: "$env:USERPROFILE\Documents\bbz-DDR").
   Erfolg nur, wenn "Bericht geschrieben: … (n offene Luecken)" erscheint. Bei Speichermangel: NODE_OPTIONS=--max-old-space-size=8192.
3. Prüfe in fm-analyse-out/FUNKTIONSUMFANG.md das Kapitel "Lücken". Schliesse jede Lücke im ERP (TDD, Konventionen aus HANDOVER.md)
   oder begründe, warum sie entfällt.
4. Ersetze die Tabelle in docs/filemaker-analyse/FUNKTIONSUMFANG-STAND.md durch die belegten Ergebnisse
   (Quelle: DDR vom <Datum>). Übernimm die Feldzuordnung aus mapping-entwurf.json in tools/fm-import.
5. Commit und Push auf claude/admiring-archimedes-2segqh.
Datenschutz: Weder den DDR noch fm-analyse-out committen (Kontennamen, Strukturdetails). Kontennamen nicht ausgeben (kein --mit-konten).
Keine Datensätze exportieren.
```

## Ergebnis
- `FUNKTIONSUMFANG-STAND.md` ist **direkt belegt** (DDR statt Discovery).
- Die Lücken sind geschlossen oder begründet.
- Das Feld-Mapping für die Datenmigration steht.

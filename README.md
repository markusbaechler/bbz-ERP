# bbz-ERP

ERP für das **Bankenberatungszentrum bbz st.gallen ag**. Es löst die FileMaker-Lösung „Projekte“ ab und deckt alle Geschäftsprozesse ab:

| Modul | Inhalt |
|---|---|
| **CRM** | Organisationen (Banken, Gruppen), Kontakte (360°), Aktivitäten, Wiedervorlagen, Verkaufschancen-Pipeline, Anfrage-Eingang, Newsletter (nDSG) |
| **Projektmanagement** | Projektstatus, Phasen, Meilensteine, Aufgaben-Kanban, Gantt, Zeiterfassung → Rechnung, Einsatzplanung Referent:innen, Cockpit mit Ampel, Portfolio, Jahresfortführung |
| **Bildung** | Kursangebote, Durchführungen, Kurstage, Anmeldungen (Warteliste, Storno nach AGB), Teilnehmerlisten, Lernnachweise, Rezertifizierung, Verrechnung je Bank |
| **SAQ-Zertifizierung** | Vorgänge nach Reporting-KUBA-Modell (WE/OE × Runs, Experten, Zertifikate, Kennzahlen, KUBA-Export) |
| **Finanzen** | Rechnungen mit MWSt je Position, lückenlose Nummern, Swiss-QR-Rechnung (PDF), Zahlungen, offene Posten, Mahnwesen, Storno |
| **Integration** | Homepage (Public-API, Kurs-Widget, WPForms/Zapier-Eingang, Webhooks), Moodle (Einschreibung, Kursabschluss, Face-to-Face-Buchungen), Microsoft 365 (Entra-ID-Login, Mail über Graph) |
| **Migration** | FileMaker-DDR-Analyse (`fm:analyse`), Datenimport (`fm:import`), KUBA-Import |

Stack: TypeScript · Fastify · PostgreSQL · vitest · Vanilla-JS-PWA. Ziel-Hosting: Azure Switzerland North.

## Schnellstart (lokal)
```bash
docker compose up -d                 # Postgres auf localhost:5433
npm install
npm test                             # alle Test-Suiten (brauchen die DB)
npm run migrate
npm run seed:demo                    # synthetische Demodaten
npm run dev                          # http://localhost:3000/app/  (Dev-Login: Kürzel + Rolle)
npm run worker                       # Outbox: Moodle, Webhooks, Mail (separates Terminal)
```

## Testumgebung (localhost, Testdaten)
Eigene Datenbank `bbz_demo` (Einstellungen in `.env.demo`). `npm test` setzt nur `bbz_test` zurück, die Testdaten bleiben also erhalten.
```bash
docker compose up -d                 # Postgres auf localhost:5433
npm run demo:neu                     # bbz_demo anlegen bzw. leeren, Migrationen, Testdaten, Beispieldateien
npm run demo                         # http://localhost:3000/app/  (Worker läuft mit)
```
- **Anmeldung (Dev-Login):** `ml` = Admin, `ph` und `sk` = Standard.
- **Testdaten:** nur synthetische Namen und Banken. Die Termine liegen relativ zum Tag von `demo:neu`. Enthalten sind CRM-Pipeline, Projekte mit Zeiten und Spesen, Kurse mit Seminarnummern 9901–9904, Anmeldungen, SAQ-Vorgänge sowie Rechnungen (offen, teilbezahlt, bezahlt).
- **Beispieldateien** in `demo-dateien/` (nicht eingecheckt):
  - `moodle-anmeldungen-kursdaten-v2.csv`: in der PWA unter Bildung → „Moodle-Buchungen importieren“.
  - `camt054-gutschriften.xml`: unter Finanzen → Zahlungsimport. Die Datei begleicht die überfällige Rechnung und enthält eine Zahlung ohne passende Rechnung.
- **Sammelrechnung:** Die Demo-Kurse liegen im laufenden Halbjahr, die Vorschau zeigt aber das vorherige. Darum den Zeitraum umstellen.
- **Keine Verbindungen nach aussen:** Mails werden nur protokolliert (`MAIL_ADAPTER=protokoll`), Moodle ist nicht angebunden.
- **Zurücksetzen:** `npm run demo:neu` löscht nur lokale Datenbanken mit „demo“ im Namen.
- **Claude-Desktop-App:** `.claude/launch.json` startet die Testumgebung in der Vorschau.

## Dokumentation
| Thema | Datei |
|---|---|
| Gesamt-Spezifikation (Prozesse, Module, API-Vertrag) | `docs/superpowers/specs/2026-10-28-erp-gesamtsystem-design.md` |
| Alle API-Routen (generiert) | `docs/API-ROUTEN.md` |
| Geschäftsprozesse laut Website | `docs/analyse/WEBSITE-GESCHAEFTSPROZESSE.md` |
| FileMaker analysieren (DDR) / Stand der Abdeckung | `docs/filemaker-analyse/ANLEITUNG.md`, `FUNKTIONSUMFANG-STAND.md` |
| Datenmigration aus FileMaker | `docs/filemaker-analyse/MIGRATION.md` |
| Homepage- und Moodle-Anbindung | `docs/integration/HOMEPAGE.md`, `docs/integration/MOODLE.md` |
| Übergabe / Arbeitsstand | `HANDOVER.md` |

# FileMaker-Funktionsumfang und Abdeckung im bbz-ERP (Stand 28.10.2026)

> **Kennzeichnung:** [belegt: Quelle] · [Hypothese] · [offen]
> **Analyseweg:** Der vollständige, maschinell erhobene Funktionsumfang entsteht mit `npm run fm:analyse` aus dem Datenbank-Designreport (DDR) von FileMaker Pro Advanced (Anleitung: `ANLEITUNG.md`). Diese Seite fasst den **bisher belegten** Stand aus Discovery (Spec v1), crm-spa, bbz-saq und Website zusammen. Sobald der DDR vorliegt, ersetzt der generierte `FUNKTIONSUMFANG.md` die Tabelle unten. Was er als Lücke meldet, wird nachgezogen.

## 1. Bekannter Funktionsumfang der FileMaker-Lösung

| # | FileMaker-Bereich | Belegt durch | Ablösung im ERP | Status |
|---|---|---|---|---|
| 1 | Projekte: Stammnummer.Jahr, Jahresfortführung, Bereich, Budget CHF/Tage, Kontierung | [belegt: Spec v1 §4.2, Export 151 Projekte 2026] | `projekt` + PM-Modul (Status, Phasen, Meilensteine, Aufgaben-Kanban, Gantt, Zeiterfassung, Cockpit/Ampel, Portfolio, Fortsetzen) | ✅ |
| 2 | Auftraggeber (Banken), Debitorennummer, Adresse | [belegt: Spec v1 §4.1] | `auftraggeber` ↔ CRM-`organisation` (360°-Sicht, Bankengruppen) | ✅ |
| 3 | Faktura mit Positionen, MWSt je Posten, lückenlose Nummer | [belegt: Spec v1 §4.3–4.4, Beleg 6231.26] | `rechnung`/`rechnungsposition`, Festschreibung, Storno mit Freigabe der Leistungen | ✅ |
| 4 | QR-Rechnung (QRR, SZKB-QR-IBAN) als PDF | [belegt: Spec v1 §5.4, Golden-Test] | `GET /rechnung/:id/pdf` | ✅ |
| 5 | Debitoren, Zahlungen, offene Posten | [belegt: Spec v1 §5.5] | Zahlungseingang, OP-Liste, Saldo, **Mahnwesen** (AGB-Stufen) | ✅ |
| 6 | Seminare / Kursdurchführungen | [belegt: Spec v1 §2 „Seminare-Tabelle“] | Kursangebot, Durchführung, Kurstage, Belegung, Status, Absage-Kaskade | ✅ |
| 7 | Teilnehmende / Anmeldungen, **Excel-Intake** | [belegt: Spec v1 §2] | Anmeldung (Warteliste, Storno nach AGB, Ersatzperson), Homepage-API, WPForms/Zapier-Eingang, Moodle-Buchungsimport | ✅ |
| 8 | Serienbriefe | [belegt: Spec v1 §2] | Mail-Vorlagen über Outbox (Bestätigung, Warteliste, Nachrücken, Mahnung), CSV-Exporte (Teilnehmerliste, Newsletter) | ✅ Basis; Briefvorlagen-Editor [offen] |
| 9 | Mitarbeitende / Zugriffsverwaltung (Kürzel in Rg-Nr.) | [belegt: Spec v1 §4.8] | `mitarbeitende` + Entra ID (Rollen Admin/Standard) | ✅ |
| 10 | Referenten | [belegt: Spec v1 §4.9] | `referent` (intern/extern), Einsatzplanung mit Überbuchungsschutz, Auslastung, Honorare im Cockpit | ✅ |
| 11 | Kontenplan, MWSt-Sätze (historisiert) | [belegt: Spec v1 §4.5–4.6] | `konto`, `mwst_satz` | ✅ |
| 12 | Layouts/Navigation, Suchen, Druck | [Hypothese: übliche FM-Funktionen] | PWA mit Filtern, PDF/CSV | ✅ (Frontend) |
| 13 | Scripts (Import, Export, PDF, E-Mail, Druck, URL …) | [offen: erst der DDR zeigt sie vollständig] | `fm-analyse` klassifiziert jedes Script und meldet Lücken | ⏳ DDR |
| 14 | Berechnungsfelder, Wertelisten, eigene Funktionen | [offen: DDR] | Fachlogik in `src/domain/*` (MWSt, QR, Ampel, Annullation, Rezertifizierung …) | ⏳ DDR |

## 2. Über FileMaker hinaus (aus Website, crm-spa, bbz-saq, Moodle-Audit)

| Bereich | Quelle | Im ERP |
|---|---|---|
| CRM: Firmen, Kontakte, Aktivitäten, Wiedervorlagen, Klassifizierung A/B/C/Akquisition, Pflegeabdeckung | [belegt: crm-spa] | CRM-Modul inkl. Dashboard, Verkaufschancen-Pipeline, Anfrage-Eingang, Newsletter mit nDSG-Einwilligung |
| SAQ-Zertifizierung: Vorgänge, Teilprüfungen WE/OE × 3 Runs, Experten, Kennzahlen | [belegt: bbz-saq/Reporting KUBA] | SAQ-Modul + KUBA-Export (Cockpit kann das ERP lesen) + KUBA-Import |
| Rezertifizierung 24 Lernstunden / 36 Monate | [belegt: Website /rezertifizierung/] | Lernnachweise (aus Moodle-Abschluss), Fälligkeitsliste |
| Moodle-Lernreisen, Kursabschluss | [belegt: Moodle-Audit BEF, Website] | Einschreibung, Abschluss-Sync, Lernnachweis |
| Formulare WPForms → Zapier → SharePoint | [belegt: Datenschutzerklärung] | Formular-Eingang `/public/v1/formulare/*` |
| Doppelte Terminpflege (Elementor-Listen, Formular-Dropdowns, Moodle) | [belegt: Website-Quelltext] | ERP als einziges Terminstammdatum, Widget/API |

## 3. Stand der direkten Analyse (28.10.2026)
| Weg | Was er liefert | Stand |
|---|---|---|
| A – Designreport (XML) | alles inkl. Script-Schritte, Formeln, Beziehungen, Rechte | Werkzeug fertig und getestet; **Export fehlt** (nur am Rechner mit FileMaker möglich) |
| C – Data API des Servers | Layouts, Scripts (Namen), Felder je Tabellenvorkommen, Wertelisten, Datensatzanzahlen | Werkzeug fertig und getestet; **Zugang fehlt** (fmrest-Konto, https-Erreichbarkeit von `BBZ-AZ-SRVAPP01`) |
| Computer Use | Claude erstellt den DDR selbst im FileMaker-Fenster | in der Cloud-Session nicht verfügbar; nötig ist eine Session auf dem Rechner mit FileMaker |
| Weitere Belege | Google Drive, Repos bbz-marktanalyse und bbz_Kurswerkstatt durchsucht | keine FileMaker-Artefakte gefunden; bbz360 und crm-spa waren in dieser Session nicht zugänglich |

Die Tabelle in Kapitel 1 bleibt deshalb **indirekt belegt**. Discovery-Bericht (Spec v1), echter Projekte-Export und Rechnungsbelege sind Primärquellen. Die Scripts sind es nicht.

## 4. Nächster Schritt
DDR erzeugen (2 Minuten, `ANLEITUNG.md` Weg A) **oder** Data-API-Lauf (Weg C) → `npm run fm:analyse` → Kapitel „Lücken“ des Berichts prüfen → Mapping für die Datenmigration (`MIGRATION.md`) übernehmen.

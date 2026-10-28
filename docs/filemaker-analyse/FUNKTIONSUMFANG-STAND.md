# FileMaker-Funktionsumfang und Abdeckung im bbz-ERP (Stand 28.10.2026)

> **Kennzeichnung:** [belegt: Quelle] · [Hypothese] · [offen]
> **Quelle:** Script-Ausdruck vom 28.10.2026 (Weg D, `ANLEITUNG.md`), ausgewertet mit `npm run fm:analyse -- --script-druck`. Der Datenbank-Designreport (DDR) war nicht möglich: Das verfügbare Konto hat keinen [Vollzugriff] [belegt: FileMaker sperrt *Datei → Dateioptionen → Öffnen* mit „Ihre Zugriffsrechte ermöglichen Ihnen diese Aktion nicht“]. Der Script-Ausdruck enthält Scripts mit allen Schritten, soweit das Konto sie ansehen darf. Daraus abgeleitet: Layouts, Dateiverweise und die in Scripts genannten Felder. Formeln, Beziehungen, Wertelisten und Konten fehlen. Datensatzzahlen: Statusbereich der Fenster [belegt: Bildschirm].
> **Datenschutz:** Ausdrucke und Bericht liegen nur lokal (`%USERPROFILE%\Documents\bbz-DDR`, `fm-analyse-out/`). Hier stehen nur Strukturangaben.
> **Auskunft Fachseite (28.10.2026):** Der Mandant IGK ist nicht mehr aktiv; alles, was IGK war, ist ins bbz integriert. Nicht mehr alle FileMaker-Funktionen sind in Gebrauch. Weiterhin genutzt: Sammelrechnung je Bank, Rechnung per Mail, Spesen weiterverrechnen. Kursbriefe, Seminarbeurteilung und Kursstatistik deckt das LMS (Moodle) ab [belegt: Auskunft Fachseite].

## 1. Funktionsumfang der FileMaker-Lösung [belegt: Script-Ausdruck]

Die Lösung („IGK-Kurs-Informations-System“ / MacOffice, Entwickler INCON) besteht aus **33 Dateien** mit je einer Tabelle [Hypothese: aus FileMaker 6 konvertiert, eine Tabelle je Datei]. Erfasst sind 408 Scripts mit 2'679 Schritten; mindestens 54 weitere Scripts darf das Konto nicht ansehen, vor allem die Kontoverwaltung. Die Datei „Start“ hat keine Script-Ansicht. Die Dateien enthalten 381'839 Datensätze.

| # | Bereich (Dateien, Datensätze) | Funktionen laut Scripts | Ablösung im ERP | Status |
|---|---|---|---|---|
| 1 | **Projekte** (Projekte 5'020; Schritte 24'124; Wochenplan; Referenten_P 24) | Projekt_Nr./Jahr/Kürzel, Ertrags- und Aufwandkonto, Budget; Projektschritte mit Datum, Referent, Ort, „abgerechnet“; *Termine Fortsetzung* (Jahresfortführung, 77 Schritte); Wochenplan je Referent; *Projekt-Abrechnung (mehrere)*, *nicht abgerechnete Projekte*; *Deckungsbeiträge*, *ER-Konti*, *ER nach Kunde*, *Aufw.-Konti*; Seminardaten/-kosten ins Projekt | `projekt` + PM (Phasen, Aufgaben, Zeit, Cockpit/Deckungsbeitrag je Projekt, Fortsetzen); Projektschritte → `einsatz` (Referent, Datum, Honorar, Status); **neu: Kontenauswertung** `GET /finanzen/konten-auswertung` | ✅ (Lücken 2, 9, 14) |
| 2 | **Faktura** (Faktura_P 11'658; pos_fak1_P 166'296; pos_fak_konti 68'235; alt: Faktura 671, pos_fak1 299) | Rechnung bbz und IGK, MWSt inkl./exkl./variabel; Kontierung bis 6 Konten (*Konti berechnen*); *Beleg drucken*, *Buchen*; Honorar/Spesen in Positionen; *print Leistungen* | `rechnung`/`rechnungsposition` mit Konto, MWSt-Modus, Festschreibung, Storno mit Gutschrift, QR-PDF | ✅; Spesen und Rechnung per Mail offen (Lücken 9, 12), IGK entfällt (Lücke 7) |
| 3 | **Debitoren / VESR** (7'882) | QR-Referenz und Prüfziffer, BESR-/QR-Zahlteil, *Rechnung Mail* (PDF + Leistungsblatt), Bankfile-Import *VESR_imp* mit Verbuchung über die Rechnungsnummer, *Übertrag Debitoren*, *print Lieferschein*, Mandant bbz/igk | QR-Rechnung, OP-Liste, Saldo, Mahnwesen; **neu: camt.054-Import** `POST /debitoren/camt054` | ✅ Import; Rechnung per Mail offen (Lücke 12), Lieferschein entfällt (Lücke 13) |
| 4 | **Kurse/Seminare** (Kurs_Typ 631; Seminare 5'033; P_Seminare 1'367) | Kursstamm (Kategorie, Kursart, Abkürzung, Blöcke); Seminare mit Kostenkomponenten je Teilnehmer (Schulungskosten IGK/fremd, Hotel, ZF, Kurtaxe, Raum, Bücher, Reisespesen), *BAG verteilen* (Prozentzuschlag, aufgerundet); *Export AGKB DBF/TXT*; *Kursstatistik*, *Ausbildungsbedarf* | `kursangebot`, `durchfuehrung`, Nebenkosten pro Tag mit MWSt, Belegung, Absage-Kaskade, öffentliche Kurs-API | ✅; Preisstufen IGK/fremd, AGKB-Export und Kursstatistik entfallen (Lücken 8, 15, 16) |
| 5 | **Anmeldungen** (Seminar_Belegung 53'436, 52 Layouts, 76 Scripts; P_Teilnehmer 9'443) | Status definitiv/Warteliste/abgemeldet, Spezialpreis, Vorauszahlung, *Preise aktualisieren*; *Doublettenkontrolle*; Briefe: Bestätigung, Einladung, Begleitbrief, Transferbrief, Vorgesetzteninfo, Teilnahmebestätigung, Warteliste (je bbz- und IGK-Variante); Teilnehmerlisten (auch je Bank), Namensschilder, Ordner-/Adressetiketten; *Rechnung Halbjahresrechnung* (Vorauszahlungsrechnung je Bank, 45 und 72 Schritte); Seminar-Abrechnung (Kontrolle); *Seminarbeurteilung*, *Referenten Feedback* | `anmeldung` (Warteliste, Nachrücken, Storno nach AGB, Ersatzperson), Doppelanmeldung per Unique-Index ausgeschlossen, Mailvorlagen Bestätigung/Warteliste/Nachrücken, Verrechnung je Durchführung; **neu: Liste je Institut** `GET /anmeldung?organisationId=`, **Postadresse in der Teilnehmerliste** (CSV für Etiketten/Namensschilder) | ✅; Sammelrechnung je Bank offen (Lücke 6); Briefe und Beurteilung im LMS (Lücken 10, 11) |
| 6 | **Adressen/CRM** (Adressen 937; Personen 2'041; Kommunik 1'722; Teilnehmer 16'280; Banken 431; Filialen 1'588; Adr_Typ 13; Story 0; PLZ 4'353) | Firmen, Personen, Kommunikationsdaten je Person, Banken mit Rechnungsanschrift und Filialen, Adresstypen (Kunde/Interessent A–C, Lieferant, Hotel …), Next-Step-Liste, abgelaufene Termine, Adresslisten, Umschläge, *wählen* (Telefon) | `organisation`/`kontakt` mit Kategorie und Klassifizierung A/B/C, Wiedervorlagen, 360°-Sicht, `tel:`/`mailto:`-Links | ✅; Filialen teilweise (Lücke 17) |
| 7 | **Korrespondenz/Textvorlagen** (Korresp 49; Briefe_P 32; Briefe 55; Vermerk 9) | Serienbrief, Kurzbrief, Fax, Mail, Korrekturlesen; Textvorlagen | `aktivitaet` (Briefe/E-Mails protokolliert), Mail-Vorlagen über Outbox, CSV-Exporte | ✅ Basis; Briefvorlagen-Editor offen (Lücke 10) |
| 8 | **Stammdaten** (Konti 123; MWSt 4: 0 / 2.6 / 3.8 / 8.1 %; Standard) | Kontenplan, MWSt-Codes, Lizenznehmer, Bankverbindung, Grussformel | `konto`, `mwst_satz` (historisiert), Creditor-Konfiguration | ✅ |
| 9 | **Zugriff** | *Konti erstellen / Konto erstellen / Konto löschen* in jeder Datei; Berechtigungssätze „Nur Dateneingabe“, „Nur Lesezugriff“ | Entra ID (Rollen Admin/Standard) | ✅ |
| 10 | **Start/Navigation** | Startseite mit Modulnavigation, Schalter *WP-Daten* [Hypothese: Übernahme von Homepage-Daten] | PWA-Navigation, Homepage-Anbindung `/public/v1/*` | ✅ |

## 2. Lücken und Entscheid

| # | Lücke (FileMaker) | Entscheid | Umsetzung / Begründung |
|---|---|---|---|
| 1 | Bankfile-Import und Verbuchung (*VESR_imp*) | **geschlossen** | camt.054 (QR-Gutschriften) `POST /debitoren/camt054`: Zuordnung über die QR-Referenz (= laufende Rechnungsnummer), Teilzahlungen, idempotent über die Bankreferenz (Migration 016), nicht zuordenbare Zahlungen mit Grund. `src/domain/camt054.ts`, `src/repos/zahlungImportRepo.ts` |
| 2 | *ER-Konti*, *ER nach Kunde*, *Aufw.-Konti*, Druck aus *pos_fak_konti* | **geschlossen** | `GET /finanzen/konten-auswertung?von&bis`: Ertrag je Konto und je Auftraggeber (Storno netto 0), Honorare je Aufwandkonto. `src/repos/finanzAuswertungRepo.ts` |
| 3 | *Teilnehmerliste pro Bank*, *Liste nach Institut* | **geschlossen** | `GET /anmeldung?organisationId=` mit Kurs-Code, Titel und Startdatum |
| 4 | Namensschilder, Ordneretiketten, *Etiketten 3er*, Umschlag | **geschlossen** (Datenquelle) | Die Teilnehmerliste (JSON/CSV) enthält die Postadresse der Organisation. Gedruckt wird per Serienbrief/Avery-Vorlage, wie heute aus FileMaker-Layouts. Ein eigener Etikettendruck im ERP entfällt. |
| 5 | *Doublettenkontrolle* (Anmeldungen) | **vorhanden** | Unique-Index `anmeldung_aktiv_uq`: eine aktive Anmeldung je Person und Durchführung. Kontakt-Dubletten: E-Mail-Index. Zusammenführen bestehender Dubletten [offen] |
| 6 | Sammelrechnung je Bank (in FileMaker *Rechnung Halbjahresrechnung*: eine Rechnung je Rechnungsempfänger über alle Anmeldungen einer Periode) | **offen – zu bauen** | In Gebrauch [belegt: Auskunft Fachseite]. Heute rechnet das ERP je Durchführung ab (`bildungVerrechnungRepo`); neu je Rechnungsempfänger und Zeitraum über mehrere Durchführungen, nur bbz |
| 7 | Mandant **IGK** (Faktura igk/bbz, Mandant im Debitor) | **entfällt** | IGK ist nicht mehr aktiv und ins bbz integriert [belegt: Auskunft Fachseite]. Ein Kreditor genügt (`src/config/creditor.ts`) |
| 8 | Preisstufen **IGK/fremd**, BAG-Zuschlag, Vorauszahlung, *Preise aktualisieren* | **entfällt** | IGK-Mechanik; die Kursabwicklung liegt im LMS [belegt: Auskunft Fachseite]. Allgemeine „Preisregeln für Bankengruppen“ bleiben ein eigener Punkt (v2.1) |
| 9 | Spesen/Honorar in Rechnungspositionen (*Spesen Importieren*, *Import Spesen*) | **offen – zu bauen** | In Gebrauch [belegt: Auskunft Fachseite]. Honorare je Einsatz vorhanden, Spesen fehlen |
| 10 | Briefe Einladung, Vorgesetzteninfo, Transferbrief, Teilnahmebestätigung/Diplom, Serien-/Kurzbrief mit Textvorlagen | **entfällt** | Im LMS abgedeckt [belegt: Auskunft Fachseite]. Im ERP bleiben die Mail-Vorlagen Bestätigung, Warteliste, Nachrücken, Mahnung |
| 11 | *Seminarbeurteilung*, *Kursbeurteilung*, *Referenten Feedback* | **entfällt** | Im LMS abgedeckt [belegt: Auskunft Fachseite] |
| 12 | *Rechnung Mail* (PDF + Leistungsblatt per E-Mail) | **offen – zu bauen** | In Gebrauch [belegt: Auskunft Fachseite]. Die Mail-Outbox kennt keine Anhänge; das PDF lässt sich bisher nur herunterladen (`GET /rechnung/:id/pdf`) |
| 13 | *print Lieferschein*, Artikelpositionen (Art. Nr.), *Etiketten Führungshandbuch* | **entfällt** | Nicht mehr in Gebrauch [belegt: Auskunft Fachseite] |
| 14 | Wochenplan als Druck | **entfällt** | Einsatzliste je Zeitraum und Auslastungs-Heatmap; Druck über den Browser |
| 15 | *Export für AGKB* (DBF/TXT von Kurstypen, Seminaren, Referenten) | **entfällt** | Das DBF-Format ist veraltet. Kurse, Durchführungen und Referenten stehen als REST-API und Webhooks bereit |
| 16 | *Kursstatistik*, *Ausbildungsbedarf* | **entfällt** | Im LMS abgedeckt [belegt: Auskunft Fachseite]; im ERP Belegung je Durchführung und SAQ-Kennzahlen |
| 17 | Filialen je Bank | **teilweise** | `organisation.gruppe_id` im Schema, noch ohne Oberfläche |
| 18 | PLZ-Verzeichnis | **entfällt** | PLZ/Ort werden direkt erfasst; eine Nachschlagetabelle ist für die Ablösung nicht nötig |
| 19 | Fax | **entfällt** | nicht mehr im Einsatz [Hypothese] |
| 20 | Verarbeitung Spende/Abo im Bankfile-Import | **entfällt** | Die Bedingungen sind in FileMaker auskommentiert [belegt: Script *Verarbeiten Spende und Abo*] |
| 21 | Plugin-Registrierung für den QR-Code | **entfällt** | QR-Zahlteil mit `swissqrbill` |
| 22 | Verweise auf „P_Start“, „MacOffice“, „Lizenz“ | **entfällt** | „P_Start“ existiert auf dem Server nicht [belegt: Meldung „P_Start.fmp12 konnte nicht geöffnet werden“]; „MacOffice“ ist Importquelle von Altdaten [Hypothese] |

Feldzuordnung für die Datenmigration: `tools/fm-import/mapping.bbz.json` (Feldnamen aus dem Script-Ausdruck, offene Punkte unter `_offen`; `fm-import` prüft das Mapping vor dem Lauf).

## 3. Über FileMaker hinaus (aus Website, crm-spa, bbz-saq, Moodle-Audit)

| Bereich | Quelle | Im ERP |
|---|---|---|
| CRM: Firmen, Kontakte, Aktivitäten, Wiedervorlagen, Klassifizierung A/B/C/Akquisition, Pflegeabdeckung | [belegt: crm-spa] | CRM-Modul inkl. Dashboard, Verkaufschancen-Pipeline, Anfrage-Eingang, Newsletter mit nDSG-Einwilligung |
| SAQ-Zertifizierung: Vorgänge, Teilprüfungen WE/OE × 3 Runs, Experten, Kennzahlen | [belegt: bbz-saq/Reporting KUBA] | SAQ-Modul + KUBA-Export (Cockpit kann das ERP lesen) + KUBA-Import |
| Rezertifizierung 24 Lernstunden / 36 Monate | [belegt: Website /rezertifizierung/] | Lernnachweise (aus Moodle-Abschluss), Fälligkeitsliste |
| Moodle-Lernreisen, Kursabschluss | [belegt: Moodle-Audit BEF, Website] | Einschreibung, Abschluss-Sync, Lernnachweis |
| Formulare WPForms → Zapier → SharePoint | [belegt: Datenschutzerklärung] | Formular-Eingang `/public/v1/formulare/*` |
| Doppelte Terminpflege (Elementor-Listen, Formular-Dropdowns, Moodle) | [belegt: Website-Quelltext] | ERP als einziges Terminstammdatum, Widget/API |

## 4. Stand der direkten Analyse (28.10.2026)
| Weg | Was er liefert | Stand |
|---|---|---|
| A – Designreport (XML) | alles inkl. Formeln, Beziehungen, Wertelisten, Rechte | **nicht möglich**: kein Konto mit [Vollzugriff]. Werkzeug fertig und getestet |
| C – Data API des Servers | Layouts, Scripts (Namen), Felder je Tabellenvorkommen, Wertelisten | **nicht möglich**: Der Server (FileMaker-Verbindung Port 5003) ist auf https/443 nicht erreichbar [belegt: Verbindungstest]; zusätzlich fehlt ein fmrest-Konto |
| D – Script-Ausdruck (ohne Vollzugriff) | Scripts mit Schritten wie im DDR; daraus Layouts, Dateiverweise, referenzierte Felder | **durchgeführt** per Computer Use: 33 Dateien, 408 Scripts, 2'679 Schritte. Ergebnis in Kapitel 1 und 2 |

Offen bleibt, was nur der DDR zeigt: Feldtypen, Formeln (z. B. Rechnungstotal, Vergleichszahl der Doublettenkontrolle), Beziehungen, Wertelisten und die gesperrten Scripts. Sobald ein Konto mit [Vollzugriff] verfügbar ist (Entwickler INCON oder Server-Administration [Hypothese]), ergänzt Weg A das Bild in rund 2 Minuten. Dann: `npm run fm:analyse -- "%USERPROFILE%\Documents\bbz-DDR"`.

## 5. Nächster Schritt
1. Die drei Lücken bauen, die noch in Gebrauch sind: Sammelrechnung je Bank (6), Rechnung per Mail mit PDF (12), Spesen weiterverrechnen (9).
2. PWA-Oberfläche für camt.054-Import, Kontenauswertung und Anmeldungen je Institut.
3. Moodle (LMS) gegen das ERP abgleichen: Was dort abgedeckt ist (Briefe, Beurteilung, Statistik), baut das ERP nicht nach; die Schnittstelle (Einschreibung, Abschluss) muss dazu passen.
4. Erster echter Export (`MIGRATION.md`) mit `mapping.bbz.json`: Kopfzeilen prüfen, `rechnungen.totalBrutto` ergänzen, Probelauf.
5. Bei Zugang mit [Vollzugriff]: DDR nachziehen (Weg A).

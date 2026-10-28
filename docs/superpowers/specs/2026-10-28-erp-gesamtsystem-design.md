# Design-Spec: bbz-ERP Gesamtsystem (v2)

**Datum:** 2026-10-28 · **Status:** in Umsetzung · **Vorgänger:** `2026-07-26-projekt-verrechnung-debitoren-design.md` (v1, Finanz-Kern, umgesetzt in Plan 1–4)

> **Kennzeichnung:** [belegt: Quelle] = aus Code, Discovery, Drive-Dokument oder Website verifiziert · [Hypothese] = plausibel, aber noch nicht bestätigt · [Entscheid] = Designentscheid dieser Spec.

---

## 1. Zweck und Ausgangslage

bbz (Bankenberatungszentrum, bbz st.gallen ag) ist ein Bildungs- und Beratungsanbieter für Schweizer Banken [belegt: Spec v1 §1]. Die operativen Daten liegen heute verteilt:

| System | Inhalt | Problem |
|---|---|---|
| **FileMaker Pro Advanced**, File „Projekte“ auf `BBZ-AZ-SRVAPP01` | Projekte (~4967), Auftraggeber, Faktura/QR-Rechnung, MWSt, Debitoren, Seminare/Teilnehmende, Mitarbeitende, Referenten, Serienbriefe [belegt: Spec v1 §1–2] | Monolith, Einzelplatz-nah, keine Web-/LMS-Anbindung |
| **crm-spa** (SharePoint-Listen, MSAL) | Firmen, Kontakte, Aktivitäten, Tasks, Events [belegt: crm-spa/CLAUDE.md] | Getrennt von Projekten und Verrechnung, keine Transaktionen |
| **Excel „BBZ Adressen“** | Adressliste mit Zielgruppe, Lead bbz, Interessen (Nachwuchs/Tailor-made/Weiterbildung/Zertifizierung), Priorität, Status, Follow-up [belegt: Drive „BBZ Adressen“, nur Spaltenköpfe gelesen] | Parallelpflege zu crm-spa |
| **Moodle** | Lernreisen (Selbstlernphase vor Präsenztagen), Kursabschluss über Aktivitätsabschluss [belegt: Drive „Audit_Moodle-Lernreise_BEF_bbz“] | Keine Verbindung zu Anmeldungen/Verrechnung |
| **Reporting KUBA (Excel)** | SAQ-Prüfungen, ausgestellte Zertifikate [belegt: bbz-saq/README.md] | Nur lesend ausgewertet |
| **Homepage** bankenberatungszentrum.ch | Angebot, Anmeldung, Kontakt [Hypothese, Details §2.3] | Medienbruch zur Administration |

**Ziel v2:** Ein ERP, das **alle Geschäftsprozesse** abdeckt: CRM, Vertrieb, **vollwertiges Projektmanagement**, Seminarbetrieb, Verrechnung und Debitoren. Dazu kommt eine **digitale Anschlussfähigkeit** an Homepage und Moodle. Der Finanz-Kern aus v1 bleibt unverändert und wird erweitert.

## 2. Geschäftsprozesse (Prozesslandkarte)

### 2.1 Kernprozesse

| # | Prozess | Ablauf (Soll im ERP) | Module |
|---|---|---|---|
| **P1** | **Markt & Kundenpflege** | Organisationen klassifizieren (A/B/C/Akquisition), Kontakte pflegen, Aktivitäten protokollieren, Wiedervorlagen, Events/Neujahrskarte, Newsletter mit nDSG-Einwilligung | CRM |
| **P2** | **Anfrage → Auftrag** | Anfrage (Homepage/Telefon/E-Mail) → qualifizieren → Kontakt/Organisation → Verkaufschance (Pipeline) → Offerte → gewonnen → **Projekt eröffnen** (Stammnummer.Jahr) | CRM → PM |
| **P3a** | **Seminarbetrieb (offene Kurse)** | Kursangebot im Katalog → Durchführung planen (Kurstage, Ort, Kapazität, Referent:innen) → **auf Homepage ausschreiben** → Anmeldung (online) → Bestätigung → **Moodle-Einschreibung (Lernreise)** → Präsenztage → Kursabschluss (Moodle) → Lernnachweis → Verrechnung je Bank | Bildung, Integration, Finanzen |
| **P3b** | **Firmenkurse / Tailor-made** | Verkaufschance → Projekt (Phasen, Meilensteine, Aufgaben) → geschlossene Durchführung(en) für eine Bank → Einsatzplanung → Zeiterfassung → Verrechnung (pauschal oder nach Aufwand) | PM, Bildung, Finanzen |
| **P3c** | **Beratung / Vertriebsentwicklung** | Projekt mit Phasen/Meilensteinen, Aufgaben-Kanban, Zeiterfassung, Einsätze → Verrechnung nach Aufwand (MWSt-pflichtig) | PM, Finanzen |
| **P3d** | **Zertifizierung / Rezertifizierung (SAQ)** | Zertifikat je Person mit Gültigkeit → Lernstunden aus besuchten Kursen sammeln → Fälligkeitsliste (fehlende Lernstunden) → gezielte Angebote (zurück zu P1/P2) | Bildung, CRM |
| **P4** | **Verrechnung & Debitoren** | Rechnung (Entwurf → festgeschrieben, lückenlose Nr., QR) → Zahlung → offene Posten → (Mahnwesen v2.1) | Finanzen (v1) |
| **P5** | **Steuerung** | Dashboard: Wiedervorlagen, Pipeline gewichtet, Projektportfolio mit Ampel (Budget/Ist, Meilensteine), Auslastung Referent:innen, Kursbelegung, offene Posten | alle |

### 2.2 Unterstützungsprozesse
- **Ressourcen:** Referent:innen intern/extern, Tages-/Halbtagessätze, Belegungskalender, Überbuchungsschutz.
- **Stammdaten & Rollen:** Mitarbeitende (Kürzel), Kontenplan, MWSt-Sätze (historisiert), Rollen Admin/Standard.
- **Qualität/Lernwirkung:** Moodle-Kursabschluss als Nachweis. Das Moodle-Audit (BEF) zeigt fehlende Lernstandsdaten [belegt: Audit]. Das ERP übernimmt deshalb zunächst nur den **Abschlussstatus**, nicht Noten.
- **Datenschutz (nDSG):** Einwilligungsnachweis für Newsletter/Marketing, Datensparsamkeit an Schnittstellen, Datenstandort CH.

### 2.3 Website-Befunde (Recherche 28.10.2026, Details: `docs/analyse/WEBSITE-GESCHAEFTSPROZESSE.md`)
| Befund | Konsequenz fürs ERP |
|---|---|
| Website = WordPress/Elementor (Hostpoint); 52 Kurse als Custom Post Type `kurs` mit Taxonomien Kursbereich, Kurstyp, Berufsprofil, Kompetenzfeld [belegt] | `kursangebot.homepage_post_id`, Felder Bereich/Format/Profile; Katalog-API kann das Moodle-Termin-Plugin später ersetzen |
| **Öffentliche Kurse werden in Moodle gebucht** (Face-to-Face-Sessions, Plugin `moodle-f2f-display` zeigt Termine; Login in Moodle Pflicht) [belegt] | ERP übernimmt **Buchungen aus Moodle** (Sync/Import je Session → `anmeldung`, Quelle `moodle`); `durchfuehrung.moodle_session_id` |
| Formulare (SAQ-Anmeldung in 5 Schritten, DLP, BFK UNO, Führungseinstieg, Kontakt, ÜK/BEM, Clientis) = **WPForms → Zapier → SharePoint/M365** [belegt] | **Formular-Eingang** `POST /public/v1/formulare/:formular` (Zapier/WPForms-Webhook) mit Mapping je Formular → Anfrage, Anmeldung oder SAQ-Fall |
| Moodle 4.5 „mybbz“ unter cometas.bankenberatungszentrum.ch, Betreiber cometas.ch gmbh, Selbstregistrierung aktiv, Profilfelder Profil/Funktion/Geburtsdatum [belegt] | Benutzer immer zuerst per E-Mail suchen, nur bei Bedarf anlegen; Web-Service-Token bei cometas beantragen |
| AGB: öffentliche Kurse > 30 Tage vor Beginn kostenlos, sonst 100 %; Ersatzperson kostenlos. SAQ: CHF 300 ab 30 Tagen, voller Preis ab 10 Arbeitstagen (mit Arztzeugnis CHF 300), CHF 150 Admin-Gebühr. Projekte: 90/60/30-Tage-Staffel je Einsatztag [belegt] | Annullationsregel je Angebot (`kursangebot.annullationsregel`), datengetriebene Staffeln |
| Rechnung nach Veranstaltung, **30 Tage**; 1. Erinnerung mit 10 Tagen Frist, **ab 2. Erinnerung CHF 50** [belegt] | **Mahnwesen** in v2 (nicht erst v2.1) |
| Standardkurse MWSt-befreit; Verpflegung/Beherbergung separat; Tailor-made MWSt-pflichtig [belegt] | Nebenkosten als eigene Position mit eigenem MWSt-Satz (`kursangebot.nebenkosten_*`) |
| SAQ „Kundenberater Bank“: 6 Profile (PK, IK, Affluent, CWMA, KMU, CCoB), Teilprüfungen, schriftlich > 70 %, mündlich > 70 %, Arbeitgeberbestätigung Pflicht, 300+ Zertifizierungen/Jahr; Rezertifizierung 24 LS / 36 Monate mit Komponenten Fachwissen/Verhalten je Kurs und Profil [belegt] | **SAQ-Modul** (§5.4b): Zertifizierungsfall, Prüfungen, Resultate, Zertifikat; Lernnachweise mit Komponenten |
| Bankengruppen (Raiffeisen, Clientis) mit eigenen Seiten/Formularen [belegt], vermutlich Rahmenverträge [Hypothese] | `organisation.gruppe_id` (Bankengruppe) |
| Prüfungs- und Kurstermine heute **doppelt gepflegt** (Elementor-Listen + Formular-Dropdowns + Moodle) [belegt] | ERP als **einziges Terminstammdatum**, Ausgabe per API/Widget |

## 3. FileMaker-Funktionsumfang und Ablösung

Der vollständige Funktionsumfang wird **maschinell** aus dem **Datenbank-Designreport (DDR)** von FileMaker Pro Advanced erhoben (Werkzeug `tools/fm-analyse`, Anleitung `docs/filemaker-analyse/ANLEITUNG.md`). Bereits belegt [belegt: Spec v1, Discovery]:

| FileMaker-Bereich | Ablösung im ERP | Status |
|---|---|---|
| Projekte (Stammnummer.Jahr, Jahresfortführung, Kontierung, Budget) | `projekt` + PM-Modul (Status, Phasen, Meilensteine, Aufgaben, Zeiterfassung, Cockpit) | v1 ✅ / v2 |
| Auftraggeber (Banken) | `auftraggeber` (Debitor) ↔ `organisation` (CRM) | v1 ✅ / v2 |
| Faktura, Positionen, MWSt, QR-Rechnung | `rechnung`, `rechnungsposition`, QR/PDF | v1 ✅ |
| Debitoren / Zahlungen | `zahlungseingang`, offene Posten, Saldo | v1 ✅ |
| Seminare / Kursdurchführungen | `kursangebot`, `durchfuehrung`, `kurstag` | v2 |
| Teilnehmende / Anmeldungen (inkl. Excel-Intake) | `anmeldung` + Homepage-API + Import | v2 |
| Mitarbeitende / Zugriffsverwaltung | `mitarbeitende` + Entra ID | v2 |
| Referenten | `referent` + `einsatz` | v2 |
| Serienbriefe | Exporte (CSV) + Mail-Outbox; Vorlagen-Engine später | v2 (Basis) |

Was der DDR zusätzlich zeigt (Scripts, Berechnungsfelder, Wertelisten, Layouts), wird per **Abdeckungsmatrix** (`fm-analyse --matrix`) gegen diese Tabelle geprüft. Nicht abgedeckte Funktionen landen als Lücke im Report.

## 4. Architektur

```
 Homepage (WordPress o. ä.)        Moodle (LMS)                Mitarbeitende (Browser/PWA)
   │  Widget / REST                  ▲ Web Services (REST)          │ Entra ID (Bearer JWT)
   ▼                                 │        │ Events (HMAC)       ▼
┌────────────── Fastify-API (Node/TS) ────────────────────────────────────────┐
│ /public/v1/*  (API-Key, CORS)   /integration/moodle/*   /api (intern, Rollen) │
│ Repos (einziger DB-Zugriff) ── Domänenlogik (DB-frei) ── Outbox-Worker        │
└──────────────────────────────── PostgreSQL (CH) ────────────────────────────┘
```

- [Entscheid] **Transaktionale Outbox** für alles, was das System verlässt (Moodle-Einschreibung, Webhooks, Mails): Fachänderung und Folgeauftrag committen gemeinsam. Der Worker arbeitet mit exponentiellem Backoff und Status `tot` nach `max_versuche`.
- [Entscheid] **Frontend:** Vanilla-JS-PWA ohne Build-Step (konsistent zu crm-spa), ausgeliefert unter `/app/`.
- [Entscheid] **Auth:** `AUTH_MODE=entra` verifiziert Entra-ID-JWT (JWKS) und mappt auf `mitarbeitende` (oid/E-Mail). `AUTH_MODE=dev` (Default lokal/Tests) liest die Header `x-user-role` und `x-user`.

## 5. Module und API-Vertrag

**Rechte [Entscheid]:** Lesen und Schreiben in CRM, PM und Bildung = alle angemeldeten Mitarbeitenden. **Admin-only:** Stammdaten (Konto, MWSt, Mitarbeitende), Finanzaktionen (Rechnung festschreiben/stornieren, Zahlung, Verrechnungsläufe), Löschungen, API-Clients/Webhooks, Outbox-Eingriffe.
**Fehler:** 400 Validierung · 404 nicht gefunden · 409 fachlicher Konflikt (Dublette, Überbuchung, Kapazität, gesperrt).
**Konvention:** JSON in camelCase, Datum `YYYY-MM-DD`, Beträge als Zahl (CHF).

### 5.1 Personal & Ressourcen ✅
`GET/POST /mitarbeitende`, `PATCH /mitarbeitende/:id` · `GET/POST /referent`, `PATCH /referent/:id`, `GET /referent/:id/belegung?von&bis`.
Regel: max. 1.0 Einsatztage pro Referent:in und Datum (Halbtage kombinierbar); abgesagte Einsätze geben frei.

### 5.2 CRM
| Endpoint | Zweck / Regeln |
|---|---|
| `GET /organisation?suche&kategorie&klassifizierung&betreuerId&inklArchiviert` | Liste inkl. `kontakteAnzahl`, `letzteAktivitaet` |
| `POST /organisation`, `PATCH /organisation/:id` | Name Pflicht |
| `GET /organisation/:id` | **360°-Sicht:** Organisation + Kontakte + letzte Aktivitäten + offene Aufgaben + Verkaufschancen + Projekte + verknüpfter Auftraggeber + Umsatz (festgeschriebene Rechnungen netto, je Jahr) |
| `POST /organisation/:id/auftraggeber` | Erzeugt/verknüpft Debitor; **vollständige Adresse Pflicht** (QR-Regel v1) |
| `GET /kontakt?suche&organisationId&interesse&betreuerId&newsletter`, `POST /kontakt`, `PATCH /kontakt/:id` | E-Mail eindeutig (aktiv), Interessen-Whitelist |
| `GET /kontakt/:id` | **360°-Sicht:** Kontakt + Organisation + Aktivitäten + Aufgaben + Anmeldungen + Lernnachweise + Zertifizierungen |
| `GET /kontakt/export/newsletter` | CSV aller Kontakte mit Newsletter **und** Einwilligungszeitpunkt |
| `GET /aktivitaet?kontaktId&organisationId&projektId&mitarbeitendeId&von&bis`, `POST /aktivitaet`, `DELETE /aktivitaet/:id` (Admin) | Organisation wird aus Kontakt abgeleitet, falls leer; Record-Lead = `mitarbeitendeId` |
| `GET /verkaufschance?phase&verantwortlichId&organisationId`, `POST`, `PATCH /verkaufschance/:id` | |
| `POST /verkaufschance/:id/phase {phase, verlustgrund?}` | Default-Wahrscheinlichkeit je Phase (lead 10, qualifiziert 25, offeriert 50, verhandlung 75, gewonnen 100, verloren 0); `verloren` verlangt `verlustgrund`; gewonnen/verloren setzt `abgeschlossenAm` |
| `POST /verkaufschance/:id/projekt {stammnummer, jahr, ertragskontoId?, name?}` | Eröffnet Projekt beim verknüpften Auftraggeber (sonst 400), Phase → gewonnen, Link `projektId` |
| `GET /verkaufschance/pipeline` | je Phase: Anzahl, Summe, gewichtete Summe; Forecast je Monat (erwarteter Abschluss) |
| `GET /anfrage?status`, `POST /anfrage` | Eingang (auch Homepage via `createAnfrage`) |
| `POST /anfrage/:id/uebernehmen {organisationId? \| organisationNeu?, verkaufschance?}` | Kontakt via E-Mail-Dublettenschutz, optional Verkaufschance; Status `uebernommen` |
| `POST /anfrage/:id/verwerfen` | Status `verworfen` |
| `GET /crm/wiedervorlagen?mitarbeitendeId` | offene Aufgaben **ohne Projekt**: `ueberfaellig`, `dieseWoche`, `ohneTermin` |
| `GET /crm/dashboard` | neue Anfragen, Wiedervorlagen, Pipeline gewichtet, Aktivitäten 30 Tage, **Pflegeabdeckung** je Klassifizierung (Organisation mit Aktivität in 365 Tagen) |

### 5.3 Projektmanagement
| Endpoint | Zweck / Regeln |
|---|---|
| `GET /projekt?jahr&auftraggeberId&status&projektleitungId` | erweitert |
| `PATCH /projekt/:id` | Stammfelder, Termine, Budgets, Projektleitung |
| `POST /projekt/:id/status {status, force?}` | Übergänge: akquise→offeriert→laufend→abgeschlossen→archiviert; abgesagt aus akquise/offeriert/laufend; abgeschlossen→laufend (Wiedereröffnung). **Abschluss blockiert (409)**, solange verrechenbare, unverrechnete Zeit existiert (Admin: `force`) |
| `POST /projekt/:id/fortsetzen {jahr}` | Jahresfortführung: gleiche Stammnummer, übernimmt Name, Auftraggeber, Kontierung, Bereich, Leitung |
| `GET/POST /projekt/:id/phase`, `PATCH/DELETE /phase/:id` | Zeitraum gültig |
| `GET/POST /projekt/:id/meilenstein`, `PATCH /meilenstein/:id`, `POST /meilenstein/:id/erreicht {datum}` | |
| `GET /aufgabe?projektId&zustaendigId&status&kontaktId&organisationId&ueberfaellig`, `POST /aufgabe`, `PATCH /aufgabe/:id`, `DELETE /aufgabe/:id` | `erledigt` setzt `erledigtAm`; Vorgänger im selben Projekt, **zyklenfrei**; Start (in_arbeit/review/erledigt) nur wenn Vorgänger erledigt (409) |
| `POST /aufgabe/:id/verschieben {status, sortierung}` | Kanban-Drag&Drop |
| `GET /projekt/:id/kanban` | Spalten offen/in_arbeit/review/erledigt |
| `GET /projekt/:id/gantt` | Phasen, Aufgaben (Start/Fällig/Vorgänger), Meilensteine, Einsätze als Zeitachse |
| `GET /zeiterfassung?projektId&mitarbeitendeId&von&bis&verrechnet`, `POST`, `PATCH/DELETE /zeiterfassung/:id` | Ansatz-Default = Verrechnungssatz der Person; verrechnete Einträge gesperrt (409) |
| `POST /projekt/:id/zeit-verrechnen {datum, bis?, mwstSatz, gruppierung, rechnungId?}` (Admin) | **Zeit → Rechnung** in einer Transaktion: Rechnungsentwurf (oder bestehender Entwurf), Positionen (Std × Ansatz) gruppiert nach `mitarbeitende`/`taetigkeit`/`einzeln`, Einträge verknüpft |
| `GET/POST /einsatz`, `POST /einsatz/:id/status` | Überbuchungsschutz (§5.1) |
| `GET /ressourcen/auslastung?von&bis` | je Referent:in und Tag verplante Tage |
| `GET /projekt/:id/cockpit` | Budget CHF/Std, abgerechnet, Leistungen, unverrechnet, interne Kosten, Honorare, Deckungsbeitrag, Fortschritt, Meilensteine, **Ampel** |
| `GET /projekt/portfolio?jahr&status` | Cockpit-Kurzform je Projekt |

**Ampel [Entscheid]:** rot = Budgetverbrauch > 100 % (Kosten+Leistungen vs. Budget) **oder** Meilenstein > 14 Tage überfällig; gelb = > 85 % **oder** Meilenstein überfällig; sonst grün.

### 5.4 Bildung (Seminarbetrieb)
| Endpoint | Zweck / Regeln |
|---|---|
| `GET /kursangebot?bereich&aktiv&oeffentlich`, `POST`, `GET/PATCH /kursangebot/:id` | Code eindeutig; Slug aus Titel |
| `GET /durchfuehrung?kursangebotId&von&bis&status`, `POST /durchfuehrung` | Code `{ANGEBOT}-{JAHR}-{n}`; Kurstage aus Liste oder je Werktag Start…Ende |
| `GET /durchfuehrung/:id` | inkl. Kurstage, Einsätze, **Belegung** (Kapazität, aktiv, Warteliste, frei) |
| `PATCH /durchfuehrung/:id`, `POST /durchfuehrung/:id/status {status}` | `ausgeschrieben` verlangt ≥1 Kurstag; `abgesagt` storniert alle aktiven Anmeldungen gebührenfrei (+ Moodle-Ausschreibung) |
| `POST /durchfuehrung/:id/kurstag`, `DELETE /kurstag/:id`, `POST /kurstag/:id/referent` | Referent:in → `einsatz` (Projekt der Durchführung, Überbuchungsschutz) |
| `POST /durchfuehrung/:id/anmeldung` | **`meldeAn()`**, transaktional mit Zeilensperre: Kontakt via E-Mail-Dublettenschutz, Preis-Snapshot, voll → **Warteliste** (Position), Doppelanmeldung 409, Anmeldeschluss/Status geprüft; Webhook-Ereignis `anmeldung.eingegangen` |
| `POST /anmeldung/:id/bestaetigen` | Status bestätigt; mit `moodleKursId` → Outbox `moodle.einschreiben` |
| `POST /anmeldung/:id/stornieren {grund, datum?}` | **Annullationskosten** nach Tagen vor Kursbeginn (Konfig); Warteliste **rückt nach**; Outbox `moodle.ausschreiben` falls eingeschrieben |
| `POST /anmeldung/:id/teilnahme {status}` | teilgenommen/abgeschlossen/nicht_bestanden; abgeschlossen → **Lernnachweis** (Lernstunden des Angebots) |
| `GET /anmeldung?durchfuehrungId&kontaktId&status`, `GET /durchfuehrung/:id/teilnehmerliste[?format=csv]` | Präsenzliste |
| `POST /durchfuehrung/:id/verrechnen {datum, pauschalChf?}` (Admin) | **Anmeldungen → Rechnungen**: je Rechnungsempfänger eine Rechnung (Projekt der Durchführung), Position je Teilnehmer:in bzw. Annullationskosten; MWSt/Konto aus Kursangebot; atomar |
| `GET /kontakt/:id/lernnachweise`, `POST /lernnachweis` | externe Nachweise erfassbar |
| `GET/POST /zertifizierung`, `GET /zertifizierung/:id/rezertifizierung` | Lernstunden im Gültigkeitszeitraum vs. Soll |
| `GET /bildung/rezertifizierung/faellig?innertMonaten=6` | ablaufende Zertifikate mit fehlenden Lernstunden (Vertriebschance) |

**Konfiguration [belegt: AGB bbz Oktober 2026]:** Annullation öffentlicher Kurse > 30 Tage vor Beginn 0 %, danach 100 % (Ersatzperson kostenlos); Staffel je Angebot austauschbar (SAQ, Projekte). Rezertifizierung: **24 Lernstunden innerhalb von 36 Monaten**, Komponenten Fachwissen/Verhalten je Kurs und Profil [belegt: /rezertifizierung/]. MWSt Standardkurse 0 % (befreit), Nebenkosten (Verpflegung) separat mit Normalsatz [belegt: AGB].

### 5.4b SAQ-Zertifizierung (Prüfungsadministration)
Fachmodell und Begriffe übernommen aus **bbz-saq / Reporting KUBA** [belegt: bbz-saq/config.js, glossary.js]: Ein **Zertifizierungsvorgang** (`saq_fall`) = eine Person × ein Profil. Profile **PK, IK, AFFL, CWMA, KMU, CCoB**. Schriftliche Teilprüfungen WE1–WE6, mündlich OE1–OE2, je bis zu **3 Runs** (`saq_pruefung` = ein Run: Datum, Ort, Score, Resultat, Passed, Experte 1/2). Pflichtteile schriftlich PK 1 · IK 1 · AFFL 2 · CWMA 3 · KMU 3 · CCoB 3, mündlich OE1. **Passerelle** PK→IK, AFFL→CWMA, KMU→CCoB = ein schriftlicher Teil. Bestanden **ab 70 %**; massgebend ist „Passed“. Die Website nennt „> 70 %“, der Auftraggeber hat am 10.09.2026 „ab 70 %“ bestätigt.

| Endpoint | Zweck / Regeln |
|---|---|
| `GET /saq/fall?status&profil&organisationId&suche`, `POST /saq/fall`, `GET/PATCH /saq/fall/:id` | Vorgang mit Kontakt, Bank, Profil, Variante, Umfang, Sprache, Rolle, Einwilligungen; Ansicht mit `fehlendeTeile`, `passerelleMoeglich`, `passiv` (> 365 Tage ohne Prüfung und ohne Termin) |
| `POST /saq/fall/:id/arbeitgeberbestaetigung {datum}` | Voraussetzung für die mündliche Prüfung |
| `POST /saq/fall/:id/pruefung {art, teil, datum, ort, remote, durchfuehrungId?, experte1Id?, experte2Id?}` | nächster Run (max. 3, nur wenn der vorherige nicht bestanden ist); Kapazität über die Durchführung (409) |
| `POST /saq/pruefung/:id/resultat {resultatProzent?, score?, bestanden?}` | Run 3 nicht bestanden → Vorgang nicht bestanden; alle Pflichtteile schriftlich bestanden → `schriftlich_bestanden`; OE bestanden → `bestanden` |
| `POST /saq/fall/:id/zertifikat {zertifikatNr, ausgestelltAm}` | → `zertifizierung` (3 Jahre) → Rezertifizierungsfrist läuft |
| `GET /saq/kennzahlen?jahr` | Vorgänge, Bestehensquote (Nenner = abgeschlossene Vorgänge), Erstversuch-Quoten, Ø Resultat; immer mit n |
| `GET /saq/export/kuba` | Export im Feldschema von bbz-saq (`we1.run1.result` …). Damit kann das Cockpit das ERP statt der Excel-Datei lesen |

### 5.5 Finanzen (v1 + Erweiterungen)
v1 unverändert. Neu: Zeit→Rechnung (§5.3), Anmeldungen→Rechnung (§5.4), **Nebenkosten-Positionen** (eigener MWSt-Satz).
**Mahnwesen [belegt: AGB]:** Fälligkeit = Rechnungsdatum + `zahlungsfrist_tage` (Default 30). `GET /debitoren/mahnvorschlag?stichtag` listet überfällige offene Posten mit nächster Stufe. `POST /debitoren/mahnlauf {stichtag, rechnungIds?}` (Admin) erzeugt Mahnungen: Stufe 1 = Erinnerung, Frist 10 Tage, ohne Gebühr; ab Stufe 2 CHF 50 Gebühr; max. Stufe 3, danach Inkasso-Liste. Eine neue Stufe entsteht erst nach Ablauf der Frist der vorherigen. camt-Import folgt in v2.1.

### 5.6 Dashboard / Reporting
`GET /dashboard` aggregiert: meine Aufgaben (überfällig/Woche), Wiedervorlagen, neue Anfragen, Pipeline gewichtet, Projekte mit Ampel ≠ grün, nächste Durchführungen mit Belegung, offene Posten total, Outbox-Fehler.

## 6. Integrationen

### 6.1 Homepage (WordPress/Elementor/WPForms)
- **Formular-Eingang (ersetzt Zapier → SharePoint):** `POST /public/v1/formulare/:formular` mit Header `x-api-key` (Scope `public:formular`). Zapier („Webhooks by Zapier“) oder das WPForms-Webhook-Addon senden die Felder als JSON. Ein **Mapping je Formular** (`src/integrations/formulare.ts`) übersetzt die Felder:
  - `kontakt`, `anfrage-uek-bem`, `clientis` → CRM-**Anfrage**
  - `anmeldung` (Kurs mit ERP-Durchführung), `dlp`, `bfk-uno`, `fuehrungseinstieg` → **Anmeldung** (falls die Durchführung bekannt ist), sonst Anfrage vom Typ `offerte`
  - `saq-anmeldung` → **SAQ-Zertifizierungsfall** (+ Kontakt, Bank-Zuordnung über Namen)
  - Rohdaten bleiben im Payload der Anfrage nachvollziehbar. Idempotenz per Header `idempotency-key` (z. B. WPForms-Entry-ID).
- **Public API v1** (Header `x-api-key`, Scopes, CORS-Whitelist, Rate-Limit):
  - `GET /public/v1/kurse?bereich` und `GET /public/v1/kurse/:slug`: öffentliche Angebote mit Durchführungen und freien Plätzen. Ersetzt die doppelte Terminpflege.
  - `POST /public/v1/anmeldungen` (Header `idempotency-key`): direkte Anmeldung über das ERP-Widget
  - `POST /public/v1/anfragen`
- **Widget** `GET /widget/bbz-kurse.js`: Vanilla-JS, `<div data-bbz-kurse data-bereich="Banking">` rendert Termine mit freien Plätzen und optional das Anmeldeformular. Es ist mit Elementor über ein HTML-Widget einbindbar und braucht einen publishable key mit Origin-Bindung.
- **Webhooks (ausgehend):** `kurs.aktualisiert`, `anmeldung.eingegangen`, `anmeldung.bestaetigt`, `anmeldung.storniert`. Signatur: `x-bbz-signature: sha256=<HMAC(secret, timestamp.body)>`, Header `x-bbz-timestamp` und `x-bbz-ereignis`.

### 6.2 Moodle (mybbz, Moodle 4.5, Betrieb cometas)
- **Web Services (REST)** mit dem Token eines Service-Users. Benötigt: `core_webservice_get_site_info`, `core_user_get_users_by_field`, `core_user_create_users`, `enrol_manual_enrol_users`, `enrol_manual_unenrol_users`, `core_completion_get_course_completion_status`, `core_enrol_get_enrolled_users`.
- **Abläufe:**
  1. **Einschreibung (Lernreise/Blended):** Anmeldung bestätigt → Outbox `moodle.einschreiben` → Benutzer per E-Mail suchen, sonst anlegen. `kontakt.moodle_user_id` wird gesetzt. Dann manuelle Einschreibung in `durchfuehrung.moodle_kurs_id`: Rolle Student; Start 14 Tage vor Kursbeginn, Ende 60 Tage nach Kursende (Konfig).
  2. **Ausschreibung** bei Storno oder Absage.
  3. **Kursabschluss:** `POST /integration/moodle/abschluss-sync` (Cron) liest die Completion je eingeschriebener Anmeldung → `abgeschlossen` + Lernnachweis. Optional als Push über ein Moodle-Event-Plugin: `POST /integration/moodle/events` mit HMAC-Signatur.
  4. **Buchungen aus Moodle (Face-to-Face):** Solange Moodle der Buchungskanal ist, übernimmt `POST /integration/moodle/buchungen` die Teilnehmenden einer Session (`durchfuehrung.moodle_session_id`) als CSV-Export der Face-to-Face-Teilnehmerliste oder als JSON → `meldeAn(quelle='moodle')`, idempotent pro Session+E-Mail. [Hypothese] Ob das Face-to-Face-Plugin von cometas Web-Service-Funktionen für Signups anbietet, prüft `GET /integration/moodle/status` (`get_site_info` listet die freigegebenen Funktionen). Sind sie vorhanden, wird der Import automatisiert.
- Fehler sind in der Outbox sichtbar (Status, letzter Fehler, „Wiederholen“).

### 6.3 Microsoft 365
Login über Entra ID (§4). Mail-Versand über Microsoft Graph `sendMail`: App-Registrierung mit Client Credentials, Absender-Postfach konfigurierbar. Adapter `protokoll` für Tests und Entwicklung.

## 7. Nichtfunktionale Anforderungen
nDSG: Einwilligungszeitpunkt und Quelle, Export nur mit Einwilligung, Public-API gibt keine Personendaten heraus. Datenstandort CH (Azure Switzerland North). Audit-Log für Festschreibung, Storno, Statuswechsel und Verrechnungsläufe. Idempotenz für öffentliche POSTs. Secrets ausschliesslich über Umgebungsvariablen.

## 8. Migration aus FileMaker
`tools/fm-import`: CSV-Exporte (Auftraggeber, Projekte, Kontakte/Teilnehmende) → Upsert mit Mapping-Datei, Zählerstartwert `rechnung_lfd_nr` = FileMaker-Maximum, Summenreport zur Validierung.

## 9. Offene Punkte
- Moodle (cometas): Web-Service-Token, freigegebene Funktionen, Face-to-Face-Signups per Web Service verfügbar?, Rolle-ID Student, Auth-Plugin der Selbstregistrierung.
- Zapier/WPForms: Umstellung der Zaps von SharePoint auf `/public/v1/formulare/:formular`; Feldnamen der Formulare gegen Mapping prüfen.
- Rahmenverträge/Preise der Bankengruppen (Raiffeisen, Clientis) als Preisregeln abbilden?
- Nebenkosten-Modelle (Tagespauschale je Jahr vs. effektiv) und Staffelpreise (SAQ-Vorbereitung) als Preisregeln.
- DDR aus FileMaker liefern → Abdeckungsmatrix schliessen.

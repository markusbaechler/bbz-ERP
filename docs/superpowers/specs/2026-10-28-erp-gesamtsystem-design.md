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

### 2.3 Website-Befunde
Wird aus der Website-Recherche ergänzt (Angebotsstruktur, Anmeldefelder, AGB/Annullierung, CMS). Bis dahin gelten die Default-Annahmen in §5.4 und §6.1 als [Hypothese].

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

**Konfiguration [Hypothese, gegen AGB zu verifizieren]:** Annullation ≥ 30 Tage vor Beginn 0 %, 29–14 Tage 50 %, < 14 Tage 100 % (Ersatzteilnehmer:in kostenlos). Rezertifizierung: **24 Lernstunden innerhalb der 36-monatigen Gültigkeit** [belegt: Positionspapier Compliance-Lernplattform, Juni 2026]. MWSt Bildung 0 % (von der Steuer ausgenommen) [Hypothese, Treuhand prüfen].

### 5.5 Finanzen (v1 + Erweiterungen)
v1 unverändert. Neu: Zeit→Rechnung (§5.3), Anmeldungen→Rechnung (§5.4). Mahnwesen und camt-Import folgen in v2.1.

### 5.6 Dashboard / Reporting
`GET /dashboard` aggregiert: meine Aufgaben (überfällig/Woche), Wiedervorlagen, neue Anfragen, Pipeline gewichtet, Projekte mit Ampel ≠ grün, nächste Durchführungen mit Belegung, offene Posten total, Outbox-Fehler.

## 6. Integrationen

### 6.1 Homepage
- **Public API v1** (`/public/v1`, Header `x-api-key`, Scopes, CORS-Whitelist je Client, Rate-Limit):
  - `GET /public/v1/kurse?bereich` → öffentliche, aktive Angebote mit ausgeschriebenen Durchführungen (Termine, Ort, Preis, **freie Plätze**, Warteliste möglich)
  - `GET /public/v1/kurse/:slug`
  - `POST /public/v1/anmeldungen` (Header `idempotency-key`) → `meldeAn()`; Antwort: Status `angemeldet`/`warteliste`
  - `POST /public/v1/anfragen` → CRM-Anfrage (Kontaktformular, Offertanfrage, Newsletter mit Einwilligung)
- **Einbettung:** `GET /widget/bbz-kurse.js` (Vanilla, kein Framework) rendert Kurskatalog und Anmeldeformular per `<div data-bbz-kurse>`; nutzt einen **publishable key** mit Scopes `public:read`, `public:anmeldung` und Origin-Bindung.
- **Webhooks (ausgehend):** `kurs.aktualisiert`, `anmeldung.eingegangen`, `anmeldung.bestaetigt`, `anmeldung.storniert`; signiert mit `x-bbz-signature: sha256=HMAC(secret, body)` und `x-bbz-ereignis`.

### 6.2 Moodle
- **Moodle Web Services (REST)**, Token eines dedizierten Service-Users. Benötigte Funktionen: `core_user_get_users_by_field`, `core_user_create_users`, `enrol_manual_enrol_users`, `enrol_manual_unenrol_users`, `core_course_get_courses_by_field`, `core_completion_get_course_completion_status`, `core_enrol_get_enrolled_users`.
- **Abläufe:**
  1. Anmeldung bestätigt → Outbox `moodle.einschreiben` → Benutzer per E-Mail suchen/anlegen (`auth=manual` oder SSO-Plugin), Kontakt erhält `moodleUserId` → Einschreibung in `durchfuehrung.moodleKursId` (Rolle Student, `timestart` = 14 Tage vor Kursbeginn [Hypothese: Lernreise vor Präsenz], `timeend` = Kursende + 60 Tage) → `moodleStatus=eingeschrieben`.
  2. Storno/Absage → `moodle.ausschreiben`.
  3. **Kursabschluss:** Pull-Job `POST /integration/moodle/abschluss-sync` (Cron) liest Completion je eingeschriebener Anmeldung → `abgeschlossen` + Lernnachweis. Optional Push: Moodle-Event-Observer/Webhook-Plugin → `POST /integration/moodle/events` (HMAC-signiert, `\core\event\course_completed`).
- Fehler werden in der Outbox sichtbar (Status, letzter Fehler, Wiederholen-Button).

### 6.3 Microsoft 365
Entra ID für Login (§4). Das PDF-Archiv auf SharePoint bleibt optional (v1 §3).

## 7. Nichtfunktionale Anforderungen
nDSG: Einwilligungszeitpunkt und Quelle, Export nur mit Einwilligung, Public-API gibt keine Personendaten heraus. Datenstandort CH (Azure Switzerland North). Audit-Log für Festschreibung, Storno, Statuswechsel und Verrechnungsläufe. Idempotenz für öffentliche POSTs. Secrets ausschliesslich über Umgebungsvariablen.

## 8. Migration aus FileMaker
`tools/fm-import`: CSV-Exporte (Auftraggeber, Projekte, Kontakte/Teilnehmende) → Upsert mit Mapping-Datei, Zählerstartwert `rechnung_lfd_nr` = FileMaker-Maximum, Summenreport zur Validierung.

## 9. Offene Punkte
- AGB-Annullierungsstaffel, Zahlungsfrist und MWSt-Behandlung je Angebot verbindlich klären.
- Moodle-Instanz-URL, Auth-Plugin (manual/OIDC) und Rolle-ID des Service-Users.
- Homepage-CMS bestätigen (Widget vs. Plugin) und Origin-Liste festlegen.
- DDR aus FileMaker liefern → Abdeckungsmatrix schliessen.

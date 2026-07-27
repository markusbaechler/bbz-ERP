# Design-Spec: bbz Projekt- & Verrechnungssystem (v1)

**Datum:** 2026-07-26
**Status:** Entwurf zur Freigabe
**Kontext:** Ablösung des FileMaker-Kernstücks „Projekte" (File auf `BBZ-AZ-SRVAPP01`) durch eine eigenständige Web-App. Grundlage: Discovery-Bericht `../../../fm-discovery/DISCOVERY-REPORT.md` (§0a–0c) inkl. echtem Projekte-Export (151 Projekte 2026) und zwei echten QR-Rechnungs-Belegen.

---

## 1. Zweck & Kontext

bbz (Bankenberatungszentrum, bbz st.gallen ag) betreibt ein projektbasiertes Bildungs-/Beratungsgeschäft für Schweizer Banken. Das operative und finanzielle Kernstück ist heute ein FileMaker-File „Projekte" (~4967 Projekte, ~4.4 Mio. CHF Jahresertrag). Es verwaltet Projekte je Bank-Auftraggeber, deren Verrechnung (inkl. Swiss-QR-Rechnung), MWSt und Debitoren.

v1 löst **diesen Finanz-Kern** ab — nicht den Teilnehmer-/Seminar-/CRM-Teil.

## 2. Scope

### In v1
- **Projekte** mit korrekter **Kontierung** (Ertrags-/Aufwandskonto)
- **Verrechnung**: Rechnungen mit **strukturierten Positionen**
- **MWSt** korrekt **je Posten** (mehrsatzfähig, Netto/Steuer/Brutto, Rappenrundung)
- **QR-Rechnung** (SIX-konform) — **Muss-Kriterium**
- **Debitorenkontrolle**: offene Posten + Kontokorrent-Saldo je Auftraggeber; Zahlungseingang **manuell** erfasst
- **Stammdaten**: Auftraggeber (Banken), Kontenplan, MWSt-Sätze, Mitarbeitende/User (Rollen), Referenten
- **Migration** der Bestandsdaten aus FileMaker

### Nicht in v1 (spätere Ausbaustufen)
- Teilnehmer-/Seminar-Anmeldungen, Kursdurchführungen (Seminare-Tabelle)
- Serienbriefe / Formular-Intake (Excel-Anmeldungen)
- Kontakt-CRM (überschneidet sich mit bestehendem `crm-spa`)
- Automatischer Zahlungsabgleich (camt.053/054) — v2

### Nicht-Ziele
- Keine Doppik/vollständige Finanzbuchhaltung — die App liefert Kontierung + Debitoren, nicht das Hauptbuch.

## 3. Architektur & Stack

| Schicht | Wahl | Begründung |
|---|---|---|
| **Datenbank** | **Azure Database for PostgreSQL (Flexible Server), Region „Switzerland North" (Zürich)** | Relationale Integrität + Transaktionen; **lückenlose/unveränderliche Rg-Nummerierung** via Sequenz/Constraint; CH-Datenstandort; managed = wenig Betrieb; bleibt in der bestehenden Microsoft/Azure-Welt |
| **Backend/API** | Node.js (TypeScript), schlankes API (Azure Functions oder kleiner App Service, Switzerland North) | Nummernvergabe, MWSt-/QR-Berechnung, Referenz-Generierung, Saldo-Updates **serverseitig in DB-Transaktionen** = korrekt & manipulationssicher |
| **Frontend** | PWA, vanilla-nah (konsistent zu `crm-spa`), optional leichtes Rendering-Helferlein | Internes Tool, wenige Nutzer; kein grosser Framework-Lernaufwand |
| **Auth/Rollen** | **Entra ID (Azure AD) via MSAL** — gleiche Identität wie `crm-spa`; Rollen **Admin/Standard** | Kein neuer Identity-Stack; spiegelt heutige „Mitarbeitende"-Zugriffsverwaltung |
| **QR-Rechnung** | Library `swissqrbill` | SIX-/ISO-20022-konformer Zahlteil/Empfangsschein als PDF/SVG; de-riskt das Muss-Kriterium |
| **PDF** | serverseitige Generierung (Rechnungsbrief + QR-Seite) | Reproduziert heutiges Layout |
| **Dokumentablage** | SharePoint/OneDrive (CH-Tenant) für PDF-Archiv | Nutzt bestehende M365-Welt — **aber nicht** als Finanz-Datenspeicher |
| **Betrieb** | Managed Postgres + Functions/App Service (Switzerland North), autom. Backups | Kleines Team, minimaler Betrieb |

**Datenstandort:** Alle Daten (DB, Backups, PDF-Ablage) in der **Schweiz**. Kein Transfer in Nicht-CH-Regionen.

### 3.1 Warum relationale DB — und nicht SharePoint/Excel als Speicher
Geprüfte Alternative (Nutzerfrage): v1 auf **MS Lists/Excel** hosten, später migrieren. Entscheidung dagegen für den **Finanz-Kern**:
- **Excel** ist kein transaktionaler Mehrbenutzer-Speicher → als System of Record für Rechnungen ungeeignet (nur als Export/Report-Ziel).
- **MS Lists** kennen **keine Transaktionen** (Rechnung+Positionen+Saldo nicht atomar), **keine erzwungene lückenlose Nummerierung** (Race bei gleichzeitigen Nutzern) und rechnen Saldi clientseitig (schwach ab ~5000 Einträgen). Bei **striktem, revisions-/MWSt-konformem Nummernzwang** (Nutzer-Entscheid) müsste man ohnehin eine Server-Zählkomponente bauen — und hätte trotzdem keinen transaktionalen Speicher.
- **Azure Postgres (Switzerland North)** liefert dasselbe M365-/CH-Umfeld, aber mit echter Integrität. **Portabilität** bleibt: Standard-Postgres + Repository/Adapter-Muster → später zu jedem Host migrierbar.

## 4. Datenmodell (v1)

> Namen deutsch/fachnah, Feldtypen für Postgres. `id` = surrogate PK (uuid oder bigserial). Beträge als `numeric(12,2)`, Sätze als `numeric(5,2)`.

### 4.1 `auftraggeber` (Debitor / Bank-Kunde)
- `id`, `nummer` (z. B. 20577, aus FM), `name` (z. B. „Urner Kantonalbank")
- `adresse_strasse`, `adresse_plz`, `adresse_ort`, `land` (default „CH")
- `ansprechperson`, `email`, `telefon`
- `kontokorrent_saldo` (abgeleitet/gecacht), `aktiv` (bool)
- **Regel:** Debitor-Adresse **vollständig** (Pflicht Strasse/PLZ/Ort/Land) — behebt heutige QR-Lücke.

### 4.2 `projekt`
- `id`, `nummer` (Anzeige, z. B. „6231.26" = `stammnummer`.`jahr2`), **`stammnummer`** (int, i. d. R. 4-stellig — identifiziert das Projekt **jahresübergreifend**), `jahr` (int, 4-stellig)
- **Jahresverlauf:** alle `projekt`-Zeilen mit gleicher `stammnummer`, sortiert nach `jahr`, bilden die Fortführung desselben Projekts über die Jahre (z. B. 6231.24 → .25 → .26). `stammnummer` ist damit der Gruppierungsschlüssel; ein Projekt ist eindeutig über (`stammnummer`, `jahr`).
- `alte_projekt_nr` (Migration), `fortsetzung_von_id` (FK, **optional** — nur für Sonderfälle wie Jahreslücken/Umnummerierung; Normalfall wird über `stammnummer` abgeleitet), `kuerzel`
- `name`, `bereich` (enum: Banking, Lizenzierung, Kundenberaterausbildung/IGK, Leadership, Beratung, Managementausbildung, …)
- `auftraggeber_id` (FK), `ansprechperson`
- `budget_chf` (numeric), `budget_tage` (numeric), `ertragskonto_id` (FK `konto`, Default-Kontierung)
- `aufwand_budget_chf`, `aufwand_konto_id`
- `projektleitung_id` (FK `mitarbeitende`)
- `beschrieb` (text), `mwst_modus` (enum: exkl/inkl, Default exkl)
- Audit: `erstellt_am`, `erstellt_durch`, `geaendert_am`, `geaendert_durch`

### 4.3 `rechnung` (Faktura)
- `id`, `nummer` (Anzeige: „6231.26 - 33214 ml/ml"), `lfd_nr` (int, fortlaufend, Basis der QR-Ref)
- `projekt_id` (FK), `auftraggeber_id` (FK, denormalisiert für Debitor)
- `datum`, `betreff`, `einleitungstext`, `schlusstext`
- `mwst_modus` (exkl/inkl), `waehrung` (default „CHF")
- `total_netto`, `total_mwst`, `total_brutto` (berechnet aus Positionen)
- `qr_referenz` (27-stellig QRR), `qr_iban` (Creditor QR-IBAN)
- `status` (enum: `offen_prov` → `def_vereinbart` → `abgerechnet` → `bezahlt` → `storniert`)
- `betrag_bezahlt`, `bezahlt_am` (manueller Zahlungseingang)
- Audit-Felder
- **Regel:** `lfd_nr` und `qr_referenz` werden **serverseitig** vergeben, unveränderlich nach Festschreibung.

### 4.4 `rechnungsposition`
- `id`, `rechnung_id` (FK), `position` (Reihenfolge)
- `beschreibung` (text), `menge` (numeric), `einheit` (enum: Std/Tag/Pauschal/Stk)
- `einzelpreis` (numeric), `betrag_netto` (= menge × einzelpreis)
- `mwst_satz_id` (FK `mwst_satz`), `konto_id` (FK `konto`, **Kontierung je Posten**)
- **Regel:** MWSt-Satz und Konto **pro Position** → korrekte Zuteilung und Auswertung.

### 4.5 `konto` (Kontenplan)
- `id`, `nummer` (z. B. 3010, 3100, 3200, 5000), `bezeichnung`, `typ` (Ertrag/Aufwand), `aktiv`

### 4.6 `mwst_satz`
- `id`, `satz` (z. B. 8.10, 3.80, 2.60, 0.00), `bezeichnung` (Normal/Beherbergung/Reduziert/Befreit)
- `gueltig_ab`, `gueltig_bis` (historisierbar wegen Satzänderungen, z. B. 7.7 % → 8.1 %)

### 4.7 `zahlungseingang`
- `id`, `rechnung_id` (FK), `datum`, `betrag`, `bemerkung`, `erfasst_durch`
- → reduziert offenen Posten; aktualisiert `kontokorrent_saldo` des Auftraggebers.

### 4.8 `mitarbeitende` (User)
- `id`, `kuerzel` (z. B. „ml", „ph"), `name`, `email`, `rolle` (Admin/Standard), `aktiv`, `passwort_hash`

### 4.9 `referent`
- `id`, `name`, `typ` (intern/extern), `kontakt` — (v1 nur Stammdaten für Projektbezug)

### Beziehungen
```
auftraggeber 1─n projekt 1─n rechnung 1─n rechnungsposition
rechnung 1─n zahlungseingang
projekt.ertragskonto → konto ; rechnungsposition.konto → konto ; rechnungsposition.mwst_satz → mwst_satz
projekt.projektleitung → mitarbeitende ; projekt.fortsetzung_von → projekt
```

## 5. Modul-Spezifikationen

### 5.1 Projekte
- CRUD Projekte, Filter nach Jahr/Bereich/Auftraggeber/Status.
- **Kontierung:** Default-Ertragskonto am Projekt; jede Position erbt es, kann abweichen.
- **Jahres-Fortführung:** über die **Stammnummer** (4 Ziffern vor dem Punkt). Der Jahresverlauf eines Projekts = alle Zeilen gleicher Stammnummer über die Jahre; „Fortsetzung von" nur als optionaler Sonderfall-Link.
- Budget-Übersicht: Budget CHF, abgerechnet, offen — pro Projekt und aggregiert.

### 5.2 Verrechnung (Rechnungen)
- Rechnung aus Projekt erstellen → erbt Auftraggeber, Ansprechperson, Kontierung.
- **Positionen** strukturiert erfassen (Menge, Einzelpreis, MWSt-Satz, Konto).
- **Nummernvergabe:** `lfd_nr` fortlaufend (serverseitig, lückenlos, kein Reuse); Anzeige-Nr = `{projekt.nummer} - {lfd_nr} {ersteller_kuerzel}`.
- Status-Lebenszyklus: `offen_prov` → `def_vereinbart` → `abgerechnet` (Festschreibung: Nummer + QR-Referenz fix, nicht mehr editierbar) → `bezahlt`.
- PDF: Rechnungsbrief (Seite 1) + QR-Zahlteil/Empfangsschein (Seite 2), Layout an heutigem Beleg orientiert.

### 5.3 MWSt (korrekt je Posten)
- Satz pro Position; Summierung **je Satz**: Netto → Steuer → Brutto.
- **Rundung:** kaufmännisch auf 0.05 CHF (Rappenrundung) auf Steuer-/Totalebene.
- Modus exkl. (Default) / inkl. je Rechnung; Stern-Konvention im PDF wie heute.
- MWSt-Zusammenfassung (mehrsatzfähig) im PDF; **Swico-S1-String** im QR-Teil (`/30/` MWST-Nr `CHE-105.127.654`, `/32/` Satz:Betrag …).

### 5.4 QR-Rechnung (SIX-konform)
- **Creditor:** Bankenberatungszentrum bbz st.gallen ag, Zürcherstrasse 202, CH-9014 St. Gallen.
- **QR-IBAN:** `CH44 3077 7003 7132 1103 0` (IID 30777, Schwyzer Kantonalbank) → **QR-Referenz (QRR)** zwingend.
- **Referenz-Bildung:** 27-stellig = fixes Creditor-Präfix (`76 10400 …`) + nullgepolsterte `lfd_nr` + Mod10-rekursive Prüfziffer. *(Präfix-Aufbau aus einem Beleg abgeleitet → in Bauphase gegen ISR-Vertrag der SZKB verifizieren.)*
- **Debitor:** vollständige Auftraggeber-Adresse (Pflicht).
- Generierung via `swissqrbill`; Betrag/Währung aus Rechnungstotal.

### 5.5 Debitorenkontrolle
- **Offene Posten:** je Rechnung `total_brutto − Σ zahlungseingang`.
- **Kontokorrent-Saldo** je Auftraggeber (Summe offener Posten; optional Vorauszahlungen).
- **Zahlungseingang manuell** erfassen (Datum, Betrag, Rechnung) → Status/Saldo aktualisiert.
- OP-Liste: filterbar (Auftraggeber, überfällig, Jahr), Summen; Basis für Mahnwesen (v2).

### 5.6 Stammdaten & Auth
- Kontenplan, MWSt-Sätze (historisiert), Auftraggeber, Referenten, Mitarbeitende/User.
- Rollen: **Admin** (Stammdaten, alle Rechnungen, Storno) / **Standard** (Projekte, Rechnungen erstellen).

## 6. Geschäftsregeln (kritisch)

1. **Rechnungsnummer** **strikt lückenlos** fortlaufend (DB-Sequenz + Unique-Constraint, Vergabe in Transaktion), **unveränderlich** nach Festschreibung — revisions-/MWSt-konform (Nutzer-Anforderung). Storno erzeugt Storno-Beleg, keine Löschung/Lücke.
2. **QR-Referenz** eindeutig je Rechnung, aus `lfd_nr` deterministisch + Mod10-Prüfziffer.
3. **MWSt** je Position; Summierung je Satz; Rappenrundung; historisierte Sätze (Beleg-Datum bestimmt gültigen Satz).
4. **Festschreibung** (`abgerechnet`): Kopf/Positionen/Nummer/QR eingefroren; Änderungen nur via Storno + Neu.
5. **Debitor-Saldo** stets = Σ offener Posten; jede Zahlung/Storno hält ihn konsistent (Transaktion).
6. **Audit** auf Projekt/Rechnung (wer/wann erstellt/geändert).

## 7. Migration aus FileMaker
- Export (wie bewährt) → Import-Skripte in Postgres:
  - `auftraggeber` (aus Projekte-Auftraggeber, dedupliziert über Nummer)
  - `konto`, `mwst_satz` (Stammdaten anlegen)
  - `projekt` (~4967), inkl. `fortsetzung_von` über alte Nr.
  - Offene Rechnungen/Salden als Anfangsbestand Debitoren.
- Historische, bereits bezahlte Rechnungen: als abgeschlossen importieren (kein QR-Neudruck).
- Validierung: Summen (Budget/offen/abgerechnet) gegen FileMaker-Report abgleichen.

## 8. Nicht-funktionale Anforderungen
- **Datenstandort Schweiz** (DB, Backup, PDF-Ablage).
- **Sicherheit:** HTTPS, Passwort-Hashing, rollenbasierte Autorisierung, serverseitige Validierung aller Finanzoperationen.
- **Backups:** täglich, Restore getestet.
- **Nachvollziehbarkeit:** Audit-Felder; festgeschriebene Rechnungen unveränderlich.
- **Verfügbarkeit:** internes Tool, Bürozeiten; einfacher Betrieb (1 VPS).

## 9. Teststrategie
- **Unit:** MWSt-Summierung (mehrsatzfrei/mehrsatzig, exkl/inkl, Rundung), QRR-Prüfziffer, Nummernvergabe, Saldo-Berechnung.
- **Golden-Test:** Nachbau der echten Beispielrechnung (Projekt 6231.26, Total 8'329.10, MWSt 624.10, QR-Ref `76 10400 00000 00000 00003 32141`) → Byte-/Feldvergleich.
- **Integration:** Rechnung erstellen → festschreiben → QR-PDF → Zahlung → Saldo.
- **Migration:** Summenabgleich gegen FileMaker.

## 10. Offene Punkte / Annahmen
- **QRR-Präfix-Aufbau** (`76 10400 …`) aus einem Beleg abgeleitet → gegen SZKB-ISR-Vertrag verifizieren.
- Genaue interne **Faktura-Feldnamen** aus FileMaker noch nicht exportiert (nicht blockierend; Modell hier ist fachlich vollständig).
- **Frontend-Detail** (reines Vanilla vs. leichtes Framework) in der Planungsphase final entscheiden.
- **Hosting entschieden:** Azure Postgres + Functions/App Service, Region Switzerland North; Auth via Entra ID. Zu verifizieren: Tenant-Geo = Schweiz für die PDF-Ablage in SharePoint/OneDrive.
- SharePoint/Excel als Finanz-Speicher **verworfen** (siehe §3.1); mögliche Rolle nur als PDF-Archiv.
- Gemischt-MWSt-Beispiel (mehrere Sätze auf einer Rechnung) zur Golden-Test-Absicherung wäre wünschenswert.

## 11. Zukunft (nach v1)
Teilnehmer-/Seminarverwaltung, Anmeldungs-Intake, Serienbriefe, camt-Zahlungsabgleich, Mahnwesen, Reporting/BI, ggf. Auftraggeber-Portal.

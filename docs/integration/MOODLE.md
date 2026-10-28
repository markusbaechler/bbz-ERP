# Moodle-Anbindung (mybbz, Moodle 4.5, Betrieb cometas)

[belegt: Website-Recherche] Instanz `https://cometas.bankenberatungszentrum.ch`, Version 2024100715.01 (Moodle 4.5), Selbstregistrierung aktiv. Öffentliche Kurse werden über **Face-to-Face-Sessions** gebucht.

## 1. Einrichtung bei cometas (einmalig)
1. *Website-Administration → Server → Webservices*: Webservices und das REST-Protokoll aktivieren.
2. Service-User `bbz-erp` anlegen und einer Rolle mit diesen Rechten zuweisen: `moodle/user:create`, `moodle/user:viewdetails`, `enrol/manual:enrol`, `enrol/manual:unenrol`, `moodle/course:view`, `report/completion:view`, `webservice/rest:use`.
3. Externen Dienst „bbz-erp“ anlegen mit diesen Funktionen:
   `core_webservice_get_site_info, core_user_get_users_by_field, core_user_create_users, enrol_manual_enrol_users, enrol_manual_unenrol_users, core_completion_get_course_completion_status, core_enrol_get_enrolled_users`
4. Für den Service-User ein Token erzeugen. In jedem verknüpften Kurs die Einschreibemethode **„Manuelle Einschreibung“** aktivieren.
5. Im ERP setzen: `MOODLE_URL`, `MOODLE_TOKEN`, optional `MOODLE_STUDENT_ROLE_ID` (Standard 5).
6. Prüfen mit `GET /integration/moodle/status`. Die Antwort meldet Version, **fehlende Funktionen** und vorhandene Face-to-Face-Funktionen.

## 2. Abläufe
| Ablauf | Auslöser | Was passiert |
|---|---|---|
| **Einschreibung** (Lernreise/Blended) | Anmeldung bestätigt, Durchführung hat `moodleKursId` | Outbox `moodle.einschreiben`: Benutzer per E-Mail suchen (selbstregistrierte Konten werden genutzt), sonst anlegen (Moodle schickt das Passwort) → manuelle Einschreibung von 14 Tagen vor Beginn bis 60 Tage nach Ende |
| **Ausschreibung** | Storno, Absage | Outbox `moodle.ausschreiben` |
| **Kursabschluss** | Cron oder Button: `POST /integration/moodle/abschluss-sync` | Completion je eingeschriebener Anmeldung → Status `abgeschlossen` + **Lernnachweis** (Lernstunden des Angebots → Rezertifizierung) |
| **Kursabschluss (Push, optional)** | Moodle-Event-Plugin sendet `\core\event\course_completed` an `POST /integration/moodle/events` | gleiche Wirkung, sofort; signiert mit `MOODLE_EVENT_SECRET` (HMAC wie Webhooks) |
| **Face-to-Face-Buchungen** | `POST /integration/moodle/buchungen {moodleSessionId, csv}` | Teilnehmerliste einer Session (CSV-Export, Spalten DE/EN) → Anmeldungen (Quelle `moodle`), idempotent; Status „Gebucht/Booked“ → bestätigt, „Teilgenommen/Attended“ → teilgenommen, „Storniert/Cancelled“ → ignoriert. Keine Doppel-Mail und keine Doppel-Einschreibung, weil Moodle selbst bestätigt |

Die Zuordnung Session ↔ Durchführung läuft über `durchfuehrung.moodle_session_id` (`s=<ID>` in `mod/facetoface/signup.php?s=…`).

## 3. Betrieb
- Der Worker-Prozess `npm run worker` arbeitet die Outbox ab; Intervall über `WORKER_INTERVALL_MS`.
- Für den Abschluss-Sync einen Cron einrichten (Server: `npm run moodle:abschluss`, oder per HTTP), z. B. nachts:
  ```bash
  curl -X POST -H "Authorization: Bearer <Token>" https://erp…/integration/moodle/abschluss-sync
  ```
- Fehler zeigen `/admin/outbox?status=fehler` sowie die Spalten `anmeldung.moodleStatus` und `moodleFehler`. „Wiederholen“ läuft über `POST /admin/outbox/:id/wiederholen`.

## 4. Offene Punkte mit cometas
- Bietet das Face-to-Face-Plugin Web-Service-Funktionen für Sessions und Signups? Falls ja, wird der CSV-Import durch einen automatischen Abgleich ersetzt (`/integration/moodle/status` listet die Funktionen).
- Bewertungen sind laut Audit kursweit ausgeschaltet. Sobald Lernkontrollen ins Bewertungsbuch schreiben, kann das ERP Resultate übernehmen (`gradereport_user_get_grade_items`).
- Web-Services, Token und Funktionsliste konnten am 28.10.2026 nicht geprüft werden (Konto ohne Website-Administration, §5).

## 5. Ist-Stand cometas (Analyse 28.10.2026, nur lesend)
Zugang mit Kurs-Manager-Rechten, **ohne** Website-Administration: Plugins, Webservices und Konfiguration waren nicht einsehbar [belegt: Moodle meldet „nopermissions“]. Keine Teilnehmerdaten gelesen oder exportiert.

| Bereich | Befund |
|---|---|
| Kursbereiche | Nachwuchsbildung, SAQ-Zertifizierung (Unterbereich Raiffeisen), Tailormade (BEKB, GKB, GLKB, UNO, BSD, Migros Bank, Clientis, SGKB), Weiterbildung (44 Kurse), Prüfungen (28), bbz intern, Testing, ZugerKB, Zentrale Fragendatenbank [belegt: Kursbereiche] |
| Aktivitäten (Stichprobe 64 Kurse) | Face-to-Face in 52 Kursen; Feedback in 33; `cometascreator` (Lerninhalte von cometas) in 43 Kursen mit 500 Instanzen; Quiz 9; SCORM 3; H5P 1; dazu Seiten, Dateien, Links [belegt: Kursstruktur] |
| Face-to-Face-Termine | Eigene Felder **Veranstaltungsort**, **Seminarnummer**, Bemerkungen; Kapazität, Stand („Ausgebucht“, „Buchung möglich“), Warteliste. Die Buchung fragt nur die Benachrichtigungsart ab (E-Mail/iCalendar) [belegt: Termin- und Buchungsseite]. Die Seminarnummern (z. B. 8961, 9045) setzen die Nummernfolge der FileMaker-„Seminar Nr.“ fort [Hypothese] |
| Profilfelder (Selbstregistrierung) | Pflicht: Bank (Liste Schweizer Banken + „Andere“), Profil (Privatkunden, Individualkunden, Affluent, CWMA, KMU, CCoB, Andere), Funktion, Telefon, Geburtsdatum; dazu Sprache (DE/FR/IT), Geschäftsadresse, AGB-Zustimmung. Im Bericht zusätzlich „Rechnungsadresse (falls abweichend von Geschäftsadresse)“ [belegt: Registrierungsformular, Berichtsspalten] |
| Einschreibung (Beispielkurs) | Manuelle Einschreibung aktiv, Selbsteinschreibung, Gastzugang [belegt: Einschreibemethoden] |
| Zertifikate | `tool_certificate` („Meine Zertifikate“); `customcert` nicht installiert [belegt] |
| Berichte (Berichtsgenerator) | Anmeldungen Kursdaten (V1/V2), Stornierungen (V1/V2), Facetoface Warteliste, Anmeldestände, Anmeldungen SAQ mündlich/schriftlich, Prüfungsanmeldungen PC-/FK-Zertifizierung, Remindplus (Erinnerungen), Neue Registrierungen, Weihnachtskarte [belegt: Berichtsliste] |
| Spalten „Anmeldungen Kursdaten V2“ | Nachname, Vorname, E-Mail, Funktion, Telefon, Geschäftsadresse, Rechnungsadresse (falls abweichend), Seminarnummer, Kursname, Beginn, Booked/Capacity, Erstellungsdatum, Session status, Profil; am 28.10.2026 um die Spalte **Bank** (Profilfeld `bankv2`) ergänzt, als letzte Spalte [belegt: Berichtskopf] |

### Folgerungen für das ERP
1. Kursbriefe und Erinnerungen (Face-to-Face-Benachrichtigungen, Remindplus), Beurteilung (Feedback), Teilnahmebestätigungen (`tool_certificate`) und Kursstatistik (Berichtsgenerator) laufen in Moodle. Das ERP baut sie nicht nach (FileMaker-Lücken 10, 11, 16).
2. Der fachliche Schlüssel zwischen Moodle und ERP ist die **Seminarnummer** des Face-to-Face-Termins. **Umgesetzt:** `durchfuehrung.seminarnummer` (Migration 017, PWA-Feld in der Durchführung).
3. **Umgesetzt:** `POST /integration/moodle/kursdaten` (PWA Bildung → „Moodle-Buchungen importieren“) liest den CSV-Export des Berichts „Anmeldungen Kursdaten V2“ über alle Termine, ordnet je Seminarnummer zu, übernimmt Funktion und Telefon, setzt den Rechnungsempfänger über die Bank (Organisation → Debitor) und hält eine abweichende Rechnungsadresse in der Bemerkung fest. Zeilen gelten als gebucht („Session status“ ist der Stand des Termins, nicht der Buchung). Stornierungen (Bericht „Stornierungen V2“) übernimmt der Import nicht [offen].
4. Sammelrechnung je Bank (`/verrechnung/sammelrechnung`) nutzt diese Rechnungsempfänger. Die Spalte Bank ist im Bericht ergänzt (28.10.2026); der Import liest sie. Wo die Bank „Andere“ ist oder keiner Organisation mit Debitor entspricht: Rechnungsempfänger an der Anmeldung setzen oder die Person einer Organisation mit Debitor zuordnen.
5. Moodle erhebt das Geburtsdatum als Pflichtfeld. Das ERP übernimmt es nur, wo es fachlich nötig ist (nDSG, Datensparsamkeit).

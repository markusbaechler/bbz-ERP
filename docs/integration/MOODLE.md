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
- Für den Abschluss-Sync einen Cron einrichten, z. B. nachts:
  ```bash
  curl -X POST -H "Authorization: Bearer <Token>" https://erp…/integration/moodle/abschluss-sync
  ```
- Fehler zeigen `/admin/outbox?status=fehler` sowie die Spalten `anmeldung.moodleStatus` und `moodleFehler`. „Wiederholen“ läuft über `POST /admin/outbox/:id/wiederholen`.

## 4. Offene Punkte mit cometas
- Bietet das Face-to-Face-Plugin Web-Service-Funktionen für Sessions und Signups? Falls ja, wird der CSV-Import durch einen automatischen Abgleich ersetzt (`/integration/moodle/status` listet die Funktionen).
- Bewertungen sind laut Audit kursweit ausgeschaltet. Sobald Lernkontrollen ins Bewertungsbuch schreiben, kann das ERP Resultate übernehmen (`gradereport_user_get_grade_items`).

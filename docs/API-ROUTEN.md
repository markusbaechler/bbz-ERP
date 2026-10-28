# API-Routen (generiert)

Stand: 2026-10-28 · 158 Routen · erzeugt mit `npm run api:routen`. Fachliche Beschreibung: Spec v2 §5–§6.

## Administration & Integration

| Methode | Pfad |
|---|---|
| `GET` | `/admin/api-clients` |
| `POST` | `/admin/api-clients` |
| `PATCH` | `/admin/api-clients/:id` |
| `POST` | `/admin/api-clients/:id/rotieren` |
| `GET` | `/admin/integration/laeufe` |
| `GET` | `/admin/outbox` |
| `POST` | `/admin/outbox/:id/wiederholen` |
| `GET` | `/admin/outbox/statistik` |
| `POST` | `/admin/outbox/verarbeiten` |
| `GET` | `/admin/ping` |
| `GET` | `/admin/webhooks` |
| `POST` | `/admin/webhooks` |
| `DELETE` | `/admin/webhooks/:id` |
| `PATCH` | `/admin/webhooks/:id` |
| `POST` | `/admin/webhooks/test` |
| `POST` | `/integration/moodle/abschluss-sync` |
| `POST` | `/integration/moodle/buchungen` |
| `POST` | `/integration/moodle/events` |
| `GET` | `/integration/moodle/status` |

## Allgemein

| Methode | Pfad |
|---|---|
| `GET` | `/` |
| `GET` | `/app` |
| `GET` | `/health` |

## Bildung

| Methode | Pfad |
|---|---|
| `GET` | `/anmeldung` |
| `GET` | `/anmeldung/:id` |
| `PATCH` | `/anmeldung/:id` |
| `POST` | `/anmeldung/:id/bestaetigen` |
| `POST` | `/anmeldung/:id/stornieren` |
| `POST` | `/anmeldung/:id/teilnahme` |
| `GET` | `/bildung/rezertifizierung/faellig` |
| `GET` | `/durchfuehrung` |
| `POST` | `/durchfuehrung` |
| `GET` | `/durchfuehrung/:id` |
| `PATCH` | `/durchfuehrung/:id` |
| `POST` | `/durchfuehrung/:id/anmeldung` |
| `POST` | `/durchfuehrung/:id/kurstag` |
| `POST` | `/durchfuehrung/:id/status` |
| `GET` | `/durchfuehrung/:id/teilnehmerliste` |
| `POST` | `/durchfuehrung/:id/verrechnen` |
| `GET` | `/kursangebot` |
| `POST` | `/kursangebot` |
| `GET` | `/kursangebot/:id` |
| `PATCH` | `/kursangebot/:id` |
| `DELETE` | `/kurstag/:id` |
| `POST` | `/kurstag/:id/referent` |
| `POST` | `/lernnachweis` |
| `GET` | `/zertifizierung` |
| `POST` | `/zertifizierung` |
| `GET` | `/zertifizierung/:id` |
| `GET` | `/zertifizierung/:id/rezertifizierung` |

## CRM

| Methode | Pfad |
|---|---|
| `GET` | `/aktivitaet` |
| `POST` | `/aktivitaet` |
| `DELETE` | `/aktivitaet/:id` |
| `GET` | `/anfrage` |
| `POST` | `/anfrage` |
| `GET` | `/anfrage/:id` |
| `POST` | `/anfrage/:id/uebernehmen` |
| `POST` | `/anfrage/:id/verwerfen` |
| `GET` | `/crm/dashboard` |
| `GET` | `/crm/wiedervorlagen` |
| `GET` | `/kontakt` |
| `POST` | `/kontakt` |
| `GET` | `/kontakt/:id` |
| `PATCH` | `/kontakt/:id` |
| `GET` | `/kontakt/:id/lernnachweise` |
| `GET` | `/kontakt/export/newsletter` |
| `GET` | `/organisation` |
| `POST` | `/organisation` |
| `GET` | `/organisation/:id` |
| `PATCH` | `/organisation/:id` |
| `POST` | `/organisation/:id/auftraggeber` |
| `GET` | `/verkaufschance` |
| `POST` | `/verkaufschance` |
| `GET` | `/verkaufschance/:id` |
| `PATCH` | `/verkaufschance/:id` |
| `POST` | `/verkaufschance/:id/phase` |
| `POST` | `/verkaufschance/:id/projekt` |
| `GET` | `/verkaufschance/pipeline` |

## Finanzen

| Methode | Pfad |
|---|---|
| `GET` | `/auftraggeber` |
| `POST` | `/auftraggeber` |
| `GET` | `/auftraggeber/:id/saldo` |
| `POST` | `/debitoren/mahnlauf` |
| `GET` | `/debitoren/mahnvorschlag` |
| `GET` | `/debitoren/offene-posten` |
| `GET` | `/rechnung` |
| `POST` | `/rechnung` |
| `GET` | `/rechnung/:id` |
| `POST` | `/rechnung/:id/def-vereinbart` |
| `POST` | `/rechnung/:id/festschreiben` |
| `GET` | `/rechnung/:id/mahnungen` |
| `GET` | `/rechnung/:id/pdf` |
| `POST` | `/rechnung/:id/position` |
| `POST` | `/rechnung/:id/stornieren` |
| `POST` | `/rechnung/:id/zahlung` |

## Homepage (oeffentlich, API-Schluessel)

| Methode | Pfad |
|---|---|
| `POST` | `/public/v1/anfragen` |
| `POST` | `/public/v1/anmeldungen` |
| `POST` | `/public/v1/formulare/:formular` |
| `GET` | `/public/v1/kurse` |
| `GET` | `/public/v1/kurse/:slug` |

## Personal & Ressourcen

| Methode | Pfad |
|---|---|
| `GET` | `/mitarbeitende` |
| `POST` | `/mitarbeitende` |
| `GET` | `/mitarbeitende/:id` |
| `PATCH` | `/mitarbeitende/:id` |
| `GET` | `/referent` |
| `POST` | `/referent` |
| `GET` | `/referent/:id` |
| `PATCH` | `/referent/:id` |
| `GET` | `/referent/:id/belegung` |

## Projektmanagement

| Methode | Pfad |
|---|---|
| `GET` | `/aufgabe` |
| `POST` | `/aufgabe` |
| `DELETE` | `/aufgabe/:id` |
| `GET` | `/aufgabe/:id` |
| `PATCH` | `/aufgabe/:id` |
| `POST` | `/aufgabe/:id/verschieben` |
| `GET` | `/einsatz` |
| `POST` | `/einsatz` |
| `POST` | `/einsatz/:id/status` |
| `DELETE` | `/meilenstein/:id` |
| `PATCH` | `/meilenstein/:id` |
| `POST` | `/meilenstein/:id/erreicht` |
| `DELETE` | `/phase/:id` |
| `PATCH` | `/phase/:id` |
| `GET` | `/projekt` |
| `POST` | `/projekt` |
| `GET` | `/projekt/:id` |
| `PATCH` | `/projekt/:id` |
| `GET` | `/projekt/:id/cockpit` |
| `POST` | `/projekt/:id/fortsetzen` |
| `GET` | `/projekt/:id/gantt` |
| `GET` | `/projekt/:id/kanban` |
| `GET` | `/projekt/:id/meilenstein` |
| `POST` | `/projekt/:id/meilenstein` |
| `GET` | `/projekt/:id/phase` |
| `POST` | `/projekt/:id/phase` |
| `POST` | `/projekt/:id/status` |
| `POST` | `/projekt/:id/zeit-verrechnen` |
| `GET` | `/projekt/portfolio` |
| `GET` | `/ressourcen/auslastung` |
| `GET` | `/zeiterfassung` |
| `POST` | `/zeiterfassung` |
| `DELETE` | `/zeiterfassung/:id` |
| `GET` | `/zeiterfassung/:id` |
| `PATCH` | `/zeiterfassung/:id` |

## SAQ-Zertifizierung

| Methode | Pfad |
|---|---|
| `GET` | `/saq/export/kuba` |
| `GET` | `/saq/fall` |
| `POST` | `/saq/fall` |
| `GET` | `/saq/fall/:id` |
| `PATCH` | `/saq/fall/:id` |
| `POST` | `/saq/fall/:id/arbeitgeberbestaetigung` |
| `POST` | `/saq/fall/:id/pruefung` |
| `POST` | `/saq/fall/:id/stornieren` |
| `POST` | `/saq/fall/:id/verrechnen` |
| `POST` | `/saq/fall/:id/zertifikat` |
| `GET` | `/saq/kennzahlen` |
| `PATCH` | `/saq/pruefung/:id` |
| `POST` | `/saq/pruefung/:id/resultat` |

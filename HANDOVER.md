# Handover — bbz Projekt- & Verrechnungssystem (bbz-ERP)

Stand: 2026-07-27. Dieses Dokument erlaubt einer neuen Session/Person, nahtlos weiterzubauen.

## Was das ist
Ablösung des FileMaker-Kernstücks „Projekte" (gehostet auf `BBZ-AZ-SRVAPP01`) durch eine eigenständige Web-App: **Projekte + Verrechnung (QR-Rechnung) + Debitorenkontrolle** für bbz (Banken-Bildung). v1 = Finanz-Kern, kein Teilnehmer-/Seminarteil.

## Wo alles liegt
- **Repo:** `github.com/markusbaechler/bbz-ERP` · lokal `C:\Users\markus.baechler\Documents\bbz_vc\bbz-projekte`
- **Spec:** `docs/superpowers/specs/2026-07-26-projekt-verrechnung-debitoren-design.md`
- **Pläne:** `docs/superpowers/plans/` (1 Fundament, 2 Verrechnung/MWSt, 3 QR/PDF, 4 Debitorenkontrolle, 5 Migration FileMaker — 6 total, Plan 6 noch nicht geschrieben)
- **Discovery + echte Belege + Beispiel-PDF:** `..\fm-discovery\` (DISCOVERY-REPORT.md, screens/)
- **Projektgedächtnis:** Claude-Memory `filemaker-ablosung-projekt.md`

## Stack (umgesetzt)
TypeScript · Fastify · PostgreSQL (`pg`) · vitest · `swissqrbill` 4.4 + `pdfkit`. Ziel-Hosting: Azure Postgres **Switzerland North** + Entra-ID (noch nicht verdrahtet — Auth ist aktuell Header-Platzhalter `x-user-role`).

## Lokal starten / testen
```bash
docker compose up -d          # Postgres auf localhost:5433 (User/DB/PW = bbz)
npm install
npm test                      # vitest, alle Suites (DB nötig)
npx tsc --noEmit              # Typecheck
npm run dev                   # Server (Fastify) auf :3000
```
Env: `DATABASE_URL` hat Fallback in `vitest.config.ts`; `.env` = lokale DB. `git config core.autocrlf false` ist gesetzt.

## Konventionen (bitte beibehalten)
- **TDD**, bite-sized: Test → rot → Implementierung → grün → Commit (ein Commit je Task).
- **Ein Branch + PR je Plan** (`planN-...`), Basis `master`; PR mergen, dann nächsten Plan ab `master`.
- Aller DB-Zugriff nur über `src/repos/*` (Portabilität). Domänenlogik DB-frei in `src/domain/*`.
- Beträge `numeric(12,2)`; DATE als String (TZ-sicher, `pool.ts` type-parser).
- Deutsch, „ss" statt „ß". Commit-Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Fortschritt (Plan 1–4 in `master` gemergt; Plan 5 fertig auf `plan5-migration-filemaker`, noch nicht gepusht/gemergt)
- **Plan 1 Fundament & Projekte** ✅ — Migrations, Konto, MWSt-Satz, Auftraggeber (Pflichtadresse), Projekt (Stammnummer.Jahr, Jahresverlauf, Kontierung), Fastify+Rollen, REST.
- **Plan 2 Verrechnung & MWSt** ✅ — MWSt-Engine (Rappenrundung 0.05, mehrsatzig, exkl/inkl), rechnung/rechnungsposition/zaehler, Festschreibung mit **lückenloser** Nummer (Zähler+Transaktion), Status/Storno, REST.
- **Plan 3 QR-Rechnung & PDF** ✅ — QRR-Referenz (Golden reproduziert echten Beleg), swissqrbill-Daten, PDF (Brief+Zahlteil), `GET /rechnung/:id/pdf`. Beispiel-PDF in `..\fm-discovery\screens\beispiel_qr_rechnung.pdf`.
- **Plan 4 Debitorenkontrolle** ✅ — `zahlungseingang` (manuell), Zahlung+Statuswechsel transaktional, offene Posten, Kontokorrent-Saldo, REST. **39 Tests grün.**
- **Plan 5 Migration** ✅ — CSV-Parser, FM-Normalisierung, Parent/Child-Gruppierung, Stammdaten (Kontenplan + MWSt-Satzhistorie), Auftraggeber (ohne Adresse, markiert), Projekte (151/2026), Summenabgleich, Zaehler nur explizit. CLI: `npm run migrate:fm -- --projekte=<pfad> [--apply] [--rechnung-max=<n>]`. **122 Tests grün.**
  - Die Festschreibung weist einen Auftraggeber mit `adresse_unvollstaendig = true` ab, bevor der Zähler läuft — sonst würde eine unwiderrufliche Rechnungsnummer (Spec §6.1) für einen nicht zustellbaren QR-Beleg verbraucht. Der Ausweg ist **`PUT /auftraggeber/:id`** (Admin) bzw. `updateAuftraggeber` in `src/repos/auftraggeberRepo.ts`: das Kennzeichen ist kein Eingabefeld, sondern fällt genau dann auf `false`, wenn Strasse, PLZ und Ort nach dem Update alle gefüllt sind.
  - Der Report trennt **`## Warnungen`** (Handlungsbedarf: unbekanntes Konto, übersprungenes Projekt, unlesbarer Betrag, doppelte `Projekt_Nr.`, unerkanntes MWSt, Jahr-Abweichung) von **`## Datenbefunde`** (abweichende Ansprechpersonen/Auftraggeber-Namen — es geht nichts verloren). Echter Export: 9 Warnungen + 14 Datenbefunde.
  - Toleranz des Summenabgleichs = `0.01 + (Zahl der tatsächlich gerundeten Beträge) * 0.005`, **nicht** an der Projektzahl aufgehängt (siehe `vergleiche` in `src/migration/report.ts`).

## Nächste Schritte (für neue Session)
1. **Plan 5 abschliessen:** Branch `plan5-migration-filemaker` pushen und PR gegen `master` erstellen (Branch existiert auf GitHub noch nicht). Danach Plan 6.
2. **Plan 6 Frontend-PWA** + Entra-ID-Auth (echte Token statt Header-Platzhalter `x-user-role`) — Plan noch zu schreiben.
3. Danach: Swico/S1-String, PDF-Feinlayout, camt-Import (v2).

## Offene Punkte / To-verify
- **Aus FileMaker nachzuziehen (Befunde Plan 5, blockieren die Migration):**
  - **Adressen-Export der Auftraggeber** — fehlt in beiden Exporten; der Adressblock der Faktura hängt an `Bank_Nr.`, einem *anderen* Nummernkreis als `Auftraggeber_Nr.` (nur 13/49 Überschneidung, widersprüchliche Namen). Darf **nicht** gejoint werden → Import setzt `adresse_unvollstaendig = true`. Ohne Adressen keine QR-Rechnung. **Der Weg zum Nachtragen existiert** (`PUT /auftraggeber/:id`, s.o.); offen sind nur noch die Adressdaten selbst — alle 49 migrierten Auftraggeber sind bis dahin nicht fakturierbar. Ein Massenweg (CSV-Import der Adressen) fehlt noch; für 49 Datensätze reicht die Einzelpflege.
  - **Vollständiger Projekt-Export** — `export_daten.csv` enthält nur Jahr 2026 (151 von ~4967 Projekten). Vollexport aller Jahrgänge nachziehen; der Import ist idempotent und kann erneut laufen.
  - **Aktueller Faktura-Export** — vorhandener endet 26.06.2025 bei Rg-Nr 31491, Livebeleg Juli 2026 trägt 33214. Zählerstand darum nur manuell via `--rechnung-max`; Rechnungs-/OP-Übernahme erst in einem Folgeplan „5b".
  - **Kontenplan-Bezeichnungen** in `src/migration/stammdaten.ts` sind abgeleitet, nicht bestätigt. Die vier fünfstelligen Konten (`31001`, `31021`, `32001`, `32041`) sind ungeklärt — betroffene Projekte kommen ohne Kontierung an.
  - **Mapping `Referent intern` → `projektleitung_kuerzel` ist unbestätigt.** „Interner Referent" und „Projektleitung" können im Quellsystem verschiedene Rollen sein; dann steht in `projekt.projektleitung_kuerzel` die falsche Person. Vor dem produktiven Lauf mit dem Fachbereich klären (gleiche Sitzung wie die Kontenplan-Bezeichnungen).

### Aus dem Abschluss-Review Plan 5 — bewusst nicht behoben, vor Produktivbetrieb zu prüfen
- **`src/pdf/rechnungPdf.ts`: `auftraggeber.zusatz` wird gespeichert, aber nie gedruckt.** Der Import zerlegt mehrzeilige Namen korrekt in Name + Zusatz, das PDF gibt nur den Namen aus. „Universität St. Gallen" ohne „Institut für Banken und Finanzen" landet in der falschen Abteilung. Betrifft jeden Auftraggeber mit mehrzeiligem Namen im Export.
- **`src/migration/csv.ts` ist gegenüber kaputten Exporten wehrlos.** Ein nicht geschlossenes Anführungszeichen zieht den Rest der Datei stillschweigend in ein einziges Feld; Felder rechts der Header-Breite werden kommentarlos verworfen. Nur die `gelesen`-Zahl im Report würde es verraten. Vor dem ~4967-Zeilen-Vollexport: Parser-Fehler explizit melden (unterminiertes Quote am Dateiende, Zeile mit abweichender Feldzahl).
- **`src/migration/report.ts` — irreführende Darstellung im Dry-Run.** Die Spalten `neu`/`aktualisiert` stehen dort auf `0`, ununterscheidbar von „nichts zu tun". Zusätzlich stehen in den Zeilen Konten/MWSt-Sätze die Werte `angelegt`/`vorhanden` unter den Überschriften „neu"/„aktualisiert" — semantisch etwas anderes. Beide Zeilen brauchen eigene Beschriftungen oder ein `—` im Dry-Run. (Der Summenabgleich zeigt im Dry-Run und bei einem vollständig übersprungenen Lauf inzwischen korrekt `—`; die Tabelle „Übernommene Datensätze" ist noch nicht angefasst.)
- **Kein `.env`-Loader.** Weder `npm run migrate:fm` noch `npm run dev` lesen `.env`; `DATABASE_URL` muss von Hand exportiert werden (nur `vitest.config.ts` hat einen Fallback). Entweder `--env-file=.env` in die npm-Skripte aufnehmen oder im README dokumentieren.
- `qrrPrefix` (`7610400` in `src/config/creditor.ts`) final gegen **SZKB-ISR-Vertrag** bestätigen (Golden deckt aktuellen Stand).
- **Swico/S1-String** (`additionalInformation`) für maschinenlesbare MWSt im QR-Teil.
- Rundungsregel 0.05 vs. 0.01 — aktuell 0.05, gegen Beleg bestätigt.
- npm-audit-Warnungen (transitive Deps) bei Bedarf adressieren.
- Auth: Entra-ID/MSAL echt verdrahten (Plan 6).

## So übernimmt eine neue Session
1. Memory `filemaker-ablosung-projekt.md` + dieses HANDOVER.md lesen.
2. Repo klonen/öffnen, `docker compose up -d`, `npm install`, `npm test` (muss grün sein).
3. Nächsten Plan schreiben/ausführen mit den Superpowers-Skills (writing-plans → executing-plans), Konventionen oben.

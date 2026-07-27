# Handover — bbz Projekt- & Verrechnungssystem (bbz-ERP)

Stand: 2026-07-27. Dieses Dokument erlaubt einer neuen Session/Person, nahtlos weiterzubauen.

## Was das ist
Ablösung des FileMaker-Kernstücks „Projekte" (gehostet auf `BBZ-AZ-SRVAPP01`) durch eine eigenständige Web-App: **Projekte + Verrechnung (QR-Rechnung) + Debitorenkontrolle** für bbz (Banken-Bildung). v1 = Finanz-Kern, kein Teilnehmer-/Seminarteil.

## Wo alles liegt
- **Repo:** `github.com/markusbaechler/bbz-ERP` · lokal `C:\Users\markus.baechler\Documents\bbz_vc\bbz-projekte`
- **Spec:** `docs/superpowers/specs/2026-07-26-projekt-verrechnung-debitoren-design.md`
- **Pläne:** `docs/superpowers/plans/` (1 Fundament, 2 Verrechnung/MWSt, 3 QR/PDF — je 6 total)
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

## Fortschritt (alle in `master` gemergt)
- **Plan 1 Fundament & Projekte** ✅ — Migrations, Konto, MWSt-Satz, Auftraggeber (Pflichtadresse), Projekt (Stammnummer.Jahr, Jahresverlauf, Kontierung), Fastify+Rollen, REST.
- **Plan 2 Verrechnung & MWSt** ✅ — MWSt-Engine (Rappenrundung 0.05, mehrsatzig, exkl/inkl), rechnung/rechnungsposition/zaehler, Festschreibung mit **lückenloser** Nummer (Zähler+Transaktion), Status/Storno, REST.
- **Plan 3 QR-Rechnung & PDF** ✅ — QRR-Referenz (Golden reproduziert echten Beleg), swissqrbill-Daten, PDF (Brief+Zahlteil), `GET /rechnung/:id/pdf`. Beispiel-PDF in `..\fm-discovery\screens\beispiel_qr_rechnung.pdf`.
- **Plan 4 Debitorenkontrolle** ✅ — `zahlungseingang` (manuell), Zahlung+Statuswechsel transaktional, offene Posten, Kontokorrent-Saldo, REST. **39 Tests grün.**

## Nächste Schritte (für neue Session)
1. **Plan 5 Migration** aus FileMaker-Export (auftraggeber/konto/mwst_satz/projekt), **Zähler-Startwert** (`zaehler.rechnung_lfd_nr`) = FileMaker-Max der Rechnungsnummer setzen, Summen-Validierung gegen FileMaker-Report. Rohdaten in `..\fm-discovery\export\`.
2. **Plan 6 Frontend-PWA** + Entra-ID-Auth (echte Token statt Header-Platzhalter `x-user-role`).
3. Danach: Swico/S1-String, PDF-Feinlayout, camt-Import (v2).

## Offene Punkte / To-verify
- `qrrPrefix` (`7610400` in `src/config/creditor.ts`) final gegen **SZKB-ISR-Vertrag** bestätigen (Golden deckt aktuellen Stand).
- **Swico/S1-String** (`additionalInformation`) für maschinenlesbare MWSt im QR-Teil.
- Rundungsregel 0.05 vs. 0.01 — aktuell 0.05, gegen Beleg bestätigt.
- npm-audit-Warnungen (transitive Deps) bei Bedarf adressieren.
- Auth: Entra-ID/MSAL echt verdrahten (Plan 6).

## So übernimmt eine neue Session
1. Memory `filemaker-ablosung-projekt.md` + dieses HANDOVER.md lesen.
2. Repo klonen/öffnen, `docker compose up -d`, `npm install`, `npm test` (muss grün sein).
3. Nächsten Plan schreiben/ausführen mit den Superpowers-Skills (writing-plans → executing-plans), Konventionen oben.

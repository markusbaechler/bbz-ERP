# Handover – bbz-ERP (Stand 2026-10-28)

Dieses Dokument erlaubt einer neuen Session oder Person, nahtlos weiterzubauen.

## Was das ist
Ablösung der FileMaker-Lösung „Projekte“ (`BBZ-AZ-SRVAPP01`) durch ein **Web-ERP für alle Geschäftsprozesse** des Bankenberatungszentrums bbz st.gallen ag:

- CRM
- Projektmanagement
- Seminarbetrieb
- SAQ-Zertifizierung
- Finanzen (QR-Rechnung, Debitoren, Mahnwesen)

Dazu kommen die Anbindungen an die **Homepage** (WordPress/WPForms/Zapier) und an **Moodle** (mybbz/cometas).

- v1 (Plan 1–4, Juli 2026): Finanz-Kern.
- v2 (diese Session): alle übrigen Module, Integrationen, Migration und Frontend.

## Wo alles liegt
| Was | Wo |
|---|---|
| Gesamt-Spec v2 (Prozesse, Module, API-Vertrag) | `docs/superpowers/specs/2026-10-28-erp-gesamtsystem-design.md` |
| Spec v1 (Finanz-Kern) + Pläne 1–4 | `docs/superpowers/specs/2026-07-26-…`, `docs/superpowers/plans/` |
| Geschäftsprozesse laut Website (belegt, mit Quellen) | `docs/analyse/WEBSITE-GESCHAEFTSPROZESSE.md` |
| FileMaker analysieren (DDR) / Abdeckung / Migration | `docs/filemaker-analyse/` (ANLEITUNG, FUNKTIONSUMFANG-STAND, MIGRATION) |
| Homepage- und Moodle-Anbindung, OpenAPI | `docs/integration/` |
| Alle Routen (generiert) | `docs/API-ROUTEN.md` (`npm run api:routen`) |
| Verwandte Repos | `crm-spa` (bisheriges CRM, SharePoint), `bbz-saq` (Zertifizierungs-Cockpit, Reporting KUBA) |

## Stack
TypeScript · Fastify 4 · PostgreSQL 16 (`pg`) · vitest · Vanilla-JS-PWA (`web/`) · `swissqrbill` + `pdfkit` · `jose` (Entra-ID-JWT) · `fast-xml-parser` (DDR) · `@fastify/static`. Ziel-Hosting: Azure (App Service + Azure Database for PostgreSQL, **Switzerland North**). Docker: `Dockerfile`, `docker-compose.prod.yml`.

## Lokal starten / testen
```bash
docker compose up -d          # Postgres auf localhost:5433 (bbz/bbz)
npm install
npm test                      # 67 Suiten / 489 Tests (DB noetig); Browser-Test des Widgets nur mit installiertem Playwright
npx tsc --noEmit
npm run migrate && npm run seed:demo
npm run dev                   # http://localhost:3000/app/
npm run worker                # Outbox (Moodle, Webhooks, Mail)
DATABASE_URL=postgres://bbz:bbz@localhost:5433/bbz_e2e npm run test:e2e   # Browser-Rundgang (42 Pruefungen, Screenshots)
```
- `seed:demo` legt nur synthetische Daten an (`*.example`-Domains) und bricht ohne Aenderung ab, wenn die Demo-Mitarbeitenden (ml/ph/sk) schon existieren.
- `test:e2e` verweigert DB-Namen ohne `test`/`web`/`e2e`/`demo` im Namen, weil es die Datenbank neu aufsetzt.
Wichtige Umgebungsvariablen: `.env.example`.
- In Produktion (`NODE_ENV=production`) ist `AUTH_MODE=dev` **gesperrt**; dort gilt `AUTH_MODE=entra`.

## Architektur-Konventionen (beibehalten)
- **TDD**, kleine Commits. Deutsch, „ss“ statt „ß“.
- DB-Zugriff nur über `src/repos/*`, Fachlogik DB-frei in `src/domain/*`.
- Repos akzeptieren `Db` (Pool oder PoolClient), damit sie in Transaktionen laufen.
- Fehler: `ValidationError` 400, `NotFoundError` 404, `ConflictError` 409. Abbildung über `src/server/http.ts`.
- Alles, was das System verlässt (Moodle, Webhooks, Mail), läuft über die **transaktionale Outbox** (`src/repos/outboxRepo.ts`, Worker `src/integrations/worker.ts`).
- Öffentliche Endpunkte: nur `/public/v1/*` (API-Schlüssel + Scope + Origin + Idempotenz). Sie nehmen keine internen IDs von aussen an und geben keine Personendaten heraus.
- Beträge `numeric(12,2)`, Datum als `YYYY-MM-DD`, Rappenrundung 0.05.

## Module (alle in `master`-Kandidat `claude/admiring-archimedes-2segqh`)
| Modul | Kern-Dateien | Status |
|---|---|---|
| Personal/Ressourcen | `mitarbeitendeRepo`, `referentRepo`, `einsatzRepo` (Advisory-Lock gegen Überbuchung) | ✅ |
| CRM | `organisationRepo`, `kontaktRepo`, `aktivitaetRepo`, `verkaufschanceRepo`, `anfrageRepo`, `crmAuswertungRepo`, `routes/crm.ts` | ✅ |
| Projektmanagement | `projektRepo`, `phaseRepo`, `meilensteinRepo`, `aufgabeRepo`, `zeiterfassungRepo`, `pmAuswertungRepo`, `domain/cockpit.ts`, `routes/pm.ts` | ✅ |
| Bildung | `kursangebotRepo`, `durchfuehrungRepo`, `anmeldungRepo` (`meldeAn` mit Zeilensperre), `lernnachweisRepo`, `bildungVerrechnungRepo`, `routes/bildung.ts` | ✅ |
| SAQ | `saqRepo` (KUBA-Modell), `domain/saq.ts`, `routes/saq.ts`, KUBA-Export | ✅ |
| Finanzen | `rechnungRepo` (Festschreibung, Storno mit Freigabe), `debitorRepo`, `mahnungRepo`, QR/PDF | ✅ |
| Integration | `routes/public.ts`, `publicSchutz.ts`, `integrations/{formulare,webhooks,mail,mailVorlagen,worker}.ts`, `integrations/moodle/*`, `routes/integration.ts`, `widget/bbz-kurse.js` | ✅ |
| Auth | `authHook.ts` (dev/entra) | ✅ |
| Migration | `tools/fm-analyse` (DDR, SaveAsXML, Data API), `tools/fm-import` (Daten), `tools/kuba-import` (SAQ-Historie aus Reporting_KUBA.xlsx, `docs/analyse/KUBA-IMPORT.md`) | ✅ |
| Frontend | `web/` (Vanilla-JS-PWA unter `/app/`, ohne Build): Cockpit, CRM (Pipeline, 360°), Projekte (Gantt, Kanban), Zeit, Bildung, SAQ (inkl. KUBA-Export), Finanzen, Ressourcen-Heatmap, Admin; Stammdaten via `routes/stammdaten.ts` (`/me`, `/konto`, `/mwst-satz`) | ✅ (E2E `test/e2e/smoke.mjs`) |

## Sicherheit (Review 28.10.2026, alle Befunde behoben, Tests: `test/sicherheit.test.ts`)
- Die öffentliche API läuft pro Request auf **einer** DB-Verbindung (Idempotenz-Sperre + Fachlogik + Savepoint). Pool-Timeouts sind gesetzt (`PG_*`).
- Neutrale Antworten (kein Teilnahme-Orakel). Bestehende Kontakte werden nie aus anonymen Eingaben geändert. Steuerzeichen → 400. Generischer 500-Handler.
- Rate-Limit je Schlüssel **und** IP (`TRUST_PROXY` hinter Azure setzen).
- Entra-oid-Bindung wird erzwungen. Webhooks: kein SSRF (interne IPs, DNS, Redirects).
- Storno erzeugt einen **Storno-Beleg (Gutschrift)** mit eigener lückenloser Nummer und gespiegelten Beträgen.

## Offene Punkte / nächste Schritte
1. **FileMaker direkt analysieren**: DDR liefern (Werkzeuge → Datenbank-Designreport → XML, dann `npm run fm:analyse -- <Ordner>`) **oder** ohne Oberfläche über die Data API des Servers (`fm-analyse.ps1 -Server … -Datenbank Projekte -Benutzer …`, Konto mit `fmrest`). Danach die Lücken aus Kapitel 9 schliessen. Stand: `docs/filemaker-analyse/FUNKTIONSUMFANG-STAND.md` §3. Gewählter Weg: lokale Session mit Computer Use (`docs/filemaker-analyse/LOKALE-SESSION.md`).
2. **Echte Exporte migrieren** gemäss `docs/filemaker-analyse/MIGRATION.md`: Probelauf, Summenabgleich, `--zaehler-start` = nächste FM-RgNr.
3. **Moodle (cometas)**: Web-Service-Token und Funktionsliste beantragen. Prüfen, ob die Face-to-Face-Signups per Web Service verfügbar sind (`/integration/moodle/status`).
4. **Zapier**: Die Zaps von SharePoint auf `/public/v1/formulare/<formular>` umstellen und die Feldnamen gegen das Mapping prüfen (`src/integrations/formulare.ts`, `ALIASE`).
5. **Entra ID**: App-Registrierung für API (Audience) und PWA (SPA) anlegen und die App-Rolle `bbz.admin` vergeben. In `web/config.js` `authMode: 'entra'` setzen.
6. **KUBA-Import** mit der echten `Reporting_KUBA.xlsx` als Probelauf ausführen (`npm run kuba:import -- --datei …`). Status je Profil mit dem bbz-saq-Cockpit abgleichen. Offene Fragen:
   - Schreibweise der Expertennamen
   - Wie Passerelle und Wiederholung in KUBA markiert sind
   - Ob nicht zugeordnete Banken angelegt oder nur als Alias geführt werden
7. Mit Fachseite verifizieren:
   - SAQ-Bestehensgrenze: Die Website sagt „> 70 %“, KUBA „ab 70 %“; umgesetzt ist ≥ 70 %.
   - Mahnfristen der Stufen 2/3 [Hypothese].
   - QRR-Präfix gegen den SZKB-ISR-Vertrag.
   - Annullationsstaffeln für SAQ und Projekte (aktuell nur „öffentlich“ produktiv).
8. v2.1:
   - camt.054-Import
   - Rückerstattung von Zahlungen auf stornierte Rechnungen (heute nur im Audit-Log)
   - Preisregeln für Bankengruppen und Staffelpreise
   - `rechnung.durchfuehrung_id`
   - Briefvorlagen-Editor (Serienbriefe)
   - Captcha im Widget
   - Rate-Limit verteilt (Redis), wenn mehrere Instanzen laufen
   - bbz-saq-Cockpit auf `GET /saq/export/kuba` umstellen statt Excel

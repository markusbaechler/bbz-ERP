# Durchstich-Nachweis (Plan 6)

Stand: 2026-07-28. Nachweis, dass die im Plan beschriebene Kette — Projekt suchen,
Rechnung erfassen, Zähler setzen, festschreiben, PDF öffnen — **ausschliesslich im
Browser** durchläuft, ohne Terminal-Eingriff zwischen dem Start des Servers und der
fertigen PDF.

## Ausgangslage (Terminal, Setup — nicht Teil der Kette)

Auf einer frisch zurückgesetzten Datenbank (`npm test` leert `bbz_test`, danach die
drei Importe):

```bash
export DATABASE_URL="postgres://bbz:bbz@localhost:5433/bbz_test"
npm run migrate:fm -- --konten=../fm-discovery/info/kontoplan_erfolgsrechnung.csv --apply
npm run migrate:fm -- --projekte=../fm-discovery/export/export_daten.csv --apply
npm run migrate:fm -- --adressen=../fm-discovery/export/adressen_export.csv --apply
npm run dev
```

Ergebnis: 177 Konten, 151 Projekte, 49 zugeordnete Auftraggeber-Adressen. Der
Rechnungszähler steht danach bei **0** (Untergrenze 31491) — die Migration setzt
ihn nie automatisch (Absicht, s. `HANDOVER.md`).

## Die Kette (ab hier nur Browser)

1. **`#/projekte`, Suche „Urner"** — Feld gefüllt, Liste filtert clientseitig auf
   4 Treffer der „Urner Kantonalbank". Geöffnet: **5934.26 — Lehrgang
   Bankfachgrundbildung ZUNO 2026**. Adresse vollständig hinterlegt (Postfach,
   6460 Altdorf).
2. **„Neue Rechnung"** — Entwurf angelegt, Status `offen_prov`, MWSt exkl.
   Sofort sichtbar: Sperrstreifen oben „Rechnungszähler steht auf 0, Untergrenze
   31491. Festschreiben ist gesperrt, bis der FileMaker-Höchststand gesetzt ist."
   und auf der Rechnung selbst dieselbe Begründung unter dem (deaktivierten)
   Festschreiben-Button.
3. **Position erfasst**: „Durchführung Bankfachgrundbildung", 33.5 Std à 230.00,
   MWSt 8.1 %. Live-Summen erschienen sofort: Netto 7'705.00, MWSt 624.10,
   Rechnungsbetrag 8'329.10.
4. **Festschreiben-Button deaktiviert**, Begründung sichtbar: „Festschreiben
   gesperrt: der Rechnungszähler steht auf 0, Untergrenze 31491. Unter „System"
   setzen." — genau der geforderte Sperrgrund, kein generischer Fehler.
5. **`#/system`** über die Kopfnavigation angesteuert. Zustand vor dem Setzen:
   Stand 0, Untergrenze 31491, Festschreiben **gesperrt** (Ocker), Gesetzt am/durch
   „—". Feld „Neuer Stand" ausgefüllt mit `33214`, „Zähler setzen" geklickt.
   Ergebnis **ohne Neuladen der Seite**: Titel wechselt auf `33214`, Festschreiben
   zeigt jetzt „möglich" (Grün/`--bezahlt`), Gesetzt am `28.7.2026, 22:57:17`,
   Gesetzt durch `REST x-user-role=admin`, Meldung „Zähler steht jetzt auf 33214."
   Der Sperrstreifen verschwand.
6. **Zurück zur Rechnung** (URL erneut aufgerufen). Festschreiben-Button jetzt
   aktiv, kein Sperrgrund mehr. Klick → Bestätigungskasten: „Es wird eine
   Rechnungsnummer **unwiderruflich** vergeben. Die Rechnung ist danach nicht mehr
   änderbar — Korrekturen nur über Storno und Neuerfassung." samt Betrag
   8'329.10 und den zwei Buttons „Abbrechen" / „Endgültig festschreiben". Auf
   „Endgültig festschreiben" geklickt.
   Ergebnis: Titel „5934.26 — 33215 ph", Status `abgerechnet`, Buttons „PDF
   öffnen" / „Zurück zum Projekt".
7. **„PDF öffnen"** (öffnet in neuem Tab, `target="_blank"`, keine
   Adressleisten-Eingabe nötig). PDF zeigt Rechnungs-Nr. **5934.26 - 33215 ph**,
   Datum 2026-07-28, die Position (33.5 Std à 230.00, 8.1 %, 7705.00), „Netto
   7705.00 à 8.1% = MWSt 624.10", „Rechnungsbetrag: CHF 8329.10" und den
   QR-Zahlteil.

## Ergebnis

- **Zugewiesene Rechnungsnummer:** `5934.26 - 33215 ph` (laufende Nummer 33215 —
  der Zähler wurde auf 33214 gesetzt, `festschreiben` vergibt den nächsten Stand).
- **Die drei Summen:** Total netto **CHF 7'705.00** · Total MWSt **CHF 624.10** ·
  Rechnungsbetrag **CHF 8'329.10**.
- **Terminal-Eingriff während der Kette (Schritte 1–7): keiner.** Jeder Schritt
  — Suche, Positionserfassung, Zählerabfrage und -setzung, die zweistufige
  Festschreib-Bestätigung, das Öffnen des PDF — lief allein über Klicks und
  Eingaben im Browser. Das einzige, was ausserhalb des Browsers geschah, war das
  in Schritt „Ausgangslage" beschriebene Zurücksetzen/Neu-Importieren der
  Datenbank und der Start von `npm run dev` — beides ausdrücklich Setup, nicht
  Teil der im Plan verlangten Kette.
- Die Browser-Konsole zeigte während der Kette keine Fehler oder unbehandelten
  Promise-Ablehnungen.

## Werkzeug-Hinweis

Die Browser-Automatisierung (Chrome-DevTools-Protokoll) hing beim ersten
`screenshot` nach Klicks gelegentlich für ~30s, bevor der zweite Versuch sofort
gelang — ein Auffälligkeit des Automatisierungs-Tools, nicht der App: die Seite
selbst reagierte bei jedem Zugriff sofort und korrekt. `form_input` (Werte
direkt setzen statt Zeichen zu tippen) mündete zuverlässig in dieselben
Formularwerte, die ein tippender Mensch erzeugt hätte, weil die App die Felder
erst beim Klick auf „Hinzufügen"/„Zähler setzen" ausliest.

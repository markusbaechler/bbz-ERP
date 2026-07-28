# Design-Spec: Frontend-Durchstich Projekte & Verrechnung

**Datum:** 2026-07-28
**Status:** Entwurf zur Freigabe
**Kontext:** Erster Teil von Plan 6. Grundlage: `2026-07-26-projekt-verrechnung-debitoren-design.md` (v1-Spec) und der abgeschlossene Datenbestand aus Plan 5 (151 Projekte, 49 Auftraggeber, 177 Konten, Jahrgang 2026).

---

## 1. Zweck

Eine klickbare Kette **Projektliste → Projektdetail → Rechnung erfassen → festschreiben → QR-PDF**, lokal betrieben, auf den echten migrierten Daten.

Der Zweck ist nicht Produktivbetrieb. Er ist, eine Frage zu beantworten, die sich am Datenmodell allein nicht beantworten lässt: **Stimmt das Modell, und trägt der Ablauf?** Bisher ist die Anwendung ausschliesslich über Tests und CLI-Ausgaben belegt. Ein Bedienfehler im Modell — eine fehlende Angabe bei der Erfassung, eine Kennzahl, die niemand sucht, ein Weg, den man dreimal gehen muss — wird erst sichtbar, wenn man ihn klickt.

Daraus folgt der Zuschnitt: so schmal wie möglich, aber **vollständig bis zum PDF**. Eine halbe Kette beantwortet die Frage nicht.

## 2. Abgrenzung

### In diesem Schnitt
- Vier Screens: Projektliste, Projektdetail, Rechnungserfassung, Systemzustand
- Zwei fehlende API-Endpunkte (§5)
- Schweizer Zahlen-, Datums- und Betragsformate
- Sichtbare Behandlung der beiden Vorbedingungen: Zählerstand und unvollständige Debitor-Adresse

### Bewusst nicht
- **Debitoren, offene Posten, Zahlungseingänge** — eigener Schnitt; die API steht bereits
- **Stammdatenpflege** (Auftraggeber, Konten, MWSt-Sätze) — bis auf das Nachtragen einer Adresse, das aus dem Projektdetail heraus erreichbar sein muss, weil es dort blockiert
- **Übernahme von Positionen aus Projektschritten** — setzt die Migration von Schritten und Seminaren voraus (Nutzer-Entscheid: danach, als eigener Schritt)
- **Entra-ID/MSAL** — eigener Schnitt (§6)
- **PWA und Offline-Betrieb.** Die v1-Spec nennt PWA. Für diesen Schnitt ist es YAGNI: jede Aktion braucht die Datenbank, und Rechnungsstellung ohne Server ist keine sinnvolle Offline-Fähigkeit. Kommt zurück, sobald ein Anwendungsfall im Aussendienst auftritt.
- **Serverseitige Suche und Paginierung** — siehe die notierte Grenze in §4.1

## 3. Architektur

### 3.1 Auslieferung
Der bestehende Fastify-Server liefert `public/` als statische Dateien aus. Ein Ursprung, kein CORS, kein zweiter Prozess: `npm run dev` startet weiterhin alles.

### 3.2 Aufbau

```
public/
  index.html          Grundgeruest, Einstiegspunkt
  app.js              Hash-Router, globales Fehlerbanner
  api.js              fetch-Wrapper, Fehlermapping, Rollen-Header
  screens/
    projekte.js       Liste, Filter, Suche
    projekt.js        Kopfdaten + Rechnungen des Projekts
    rechnung.js       Erfassung, Positionen, Summen, Festschreibung
    system.js         Zaehlerstand und Sperre
  ui/
    tabelle.js        dichte Tabelle mit Sortierung
    feld.js           Formularfeld inkl. Fehlerzustand
    format.js         Franken, Datum, Prozent (de-CH)
    zustand.js        Laden / leer / Fehler
  stil.css
```

**Vanilla ES-Module, kein Build.** Kein Bundler, kein Transpiler, keine `node_modules` im Frontend: Datei speichern, Seite neu laden.

Die v1-Spec verlangt Konsistenz zu `crm-spa`. Übernommen wird das Muster (framework-freies JavaScript, statische Auslieferung), **nicht die Dateigrössen**: `crm-spa` hat 399 KB in einer `app.js` und 157 KB in einer `index.html`. Dateien dieser Grösse machen Änderungen unzuverlässig — für einen Menschen wie für ein Modell. Jede Datei hier bleibt klein genug, um sie am Stück zu lesen.

### 3.3 Zustand
Kein Zustandsverwaltungs-Framework. Jeder Screen lädt beim Betreten, was er braucht, und hält es lokal. Geteilt wird nur eine Handvoll selten wechselnder Nachschlagedaten (Auftraggeber, Konten, MWSt-Sätze) in einem kleinen Modul mit einfacher Zwischenspeicherung.

### 3.4 Auth in diesem Schnitt
`api.js` schickt den Platzhalter-Header `x-user-role: admin`, den der Server heute schon auswertet. **Genau eine Stelle im Code**, mit Kommentar, damit der Austausch gegen echte Token ein Eingriff an einer Stelle bleibt.

## 4. Die Screens

### 4.1 Projektliste
Spalten: Nummer, Name, Auftraggeber, Bereich, Budget CHF, abgerechnet, offen. Filter nach Jahr; Volltextsuche über Nummer, Name und Auftraggeber im Browser. Sortierung je Spalte.

**„abgerechnet" und „offen" sind FileMaker-Stände**, nicht Live-Werte. Sie stammen aus `fm_abgerechnet` und `fm_offen_prov` und wurden zum Zeitpunkt des Exports eingefroren; eine in dieser Anwendung erfasste Rechnung verändert sie **nicht**. Die Spalten werden deshalb sichtbar als Stand aus FileMaker gekennzeichnet. Live berechnete Werte kommen mit dem Debitoren-Schnitt, der die Rechnungen des neuen Systems aggregiert. Diese Kennzeichnung ist kein Schönheitsfehler, sondern verhindert, dass jemand einer Zahl vertraut, die stillsteht.

**Bekannte Grenze:** Filtern und Suchen im Browser trägt bei 151 Zeilen. Beim Vollexport (~4967 Projekte) trägt es nicht mehr. Serverseitige Suche wird bewusst **nicht** jetzt gebaut — sie wäre Spekulation über ein Verhalten, das sich am echten Vollbestand anders zeigen kann. Die Grenze steht in der Doku und wird angegangen, wenn der Vollexport da ist.

### 4.2 Projektdetail
Kopfdaten: Auftraggeber mit vollständiger Adresse, Ansprechperson, Bereich, Ertrags- und Aufwandskonto, Budget, Projektleitung, Beschrieb. Darunter die Rechnungen des Projekts mit Nummer, Datum, Betrag und Status.

**Fehlt dem Auftraggeber die Adresse**, steht das hier als Hinweis mit direktem Weg zum Nachtragen — nicht erst als Fehlermeldung nach dem Klick auf „Festschreiben". Der Nachtrag ruft `PUT /auftraggeber/:id`; das Kennzeichen `adresse_unvollstaendig` löscht sich dabei serverseitig aus den Daten heraus.

### 4.3 Rechnungserfassung
Kopf: Datum, Betreff, MWSt-Modus (exkl./inkl.). Positionstabelle: Beschreibung, Menge, Einheit, Einzelpreis, MWSt-Satz, Betrag.

Die Summen rechnen live mit, **aufgeschlüsselt je MWSt-Satz**, mit Rappenrundung auf 0.05 — dieselbe Regel wie im Server (`src/domain/mwst.ts`). Der Benutzer sieht das Ergebnis, bevor er festschreibt.

**Festschreiben** ist die einzige irreversible Aktion der Anwendung. Sie bekommt eine Bestätigung, die ausspricht, was geschieht: eine Rechnungsnummer wird unwiderruflich vergeben, die Rechnung wird unveränderlich. Ist der Zähler noch gesperrt, ist die Aktion von vornherein inaktiv, mit Nennung des Stands, der Untergrenze und des Befehls — statt einer Fehlermeldung nach dem Klick.

Danach: PDF öffnen (`GET /rechnung/:id/pdf`).

### 4.4 Systemzustand
Ein kleiner Screen für den Rechnungszähler: aktueller Stand, Untergrenze, ob gesperrt, wer wann gesetzt hat. Setzen über `PUT /zaehler/rechnung`.

Klein, aber notwendig: solange der Zähler nicht gesetzt ist, funktioniert die Kernkette nicht, und der Grund muss ohne Terminal auffindbar sein.

## 5. API-Ergänzungen

Beim Entwurf sind zwei Lücken aufgefallen:

**`GET /projekt/:id/rechnungen`** — existiert nicht. `GET /projekt/:id` liefert nur das Projekt; es gibt keinen Weg, die Rechnungen eines Projekts zu holen. Liefert die Rechnungen absteigend nach Datum, je mit `id`, `nummer`, `datum`, `status`, `totalBrutto`.

**`GET /projekt` liefert nur `auftraggeberId`**, nicht den Namen. Ohne Erweiterung bräuchte die Liste 151 Einzelabfragen oder eine Verknüpfung im Browser. Die Listenantwort wird um `auftraggeberName` erweitert — über einen Join im Repository, keine N+1-Abfragen. Mehr nicht: die Kontonummer zeigt die Liste nicht, sie gehört ins Detail.

Beide folgen den bestehenden Mustern: Zugriff nur über `src/repos/*`, Fehlermapping wie in den vorhandenen Routen, Tests gegen die echte Datenbank.

## 6. Was danach kommt

Dieser Schnitt ist der erste von mehreren. In wahrscheinlicher Reihenfolge:

1. **Schritte und Seminare migrieren** + Übernahme-Knopf in der Erfassung
2. **Debitoren-Screens** (offene Posten, Zahlungseingang, Kontokorrent-Saldo) — API steht
3. **Entra-ID/MSAL** statt des Rollen-Headers, mit Rollen aus dem Verzeichnis
4. **Stammdatenpflege** und serverseitige Suche, sobald der Vollexport da ist

## 7. Gestaltung

Für ein Finanzwerkzeug heisst „gestaltet" nicht hübsch, sondern **lesbar unter Dichte**. Die Anwendung wird stundenlang benutzt; sie muss Zahlen vergleichbar machen und Zustände auf einen Blick unterscheidbar.

- **Beträge rechtsbündig, in Tabellenziffern.** Bei sechsstelligen Budgets neben zweistelligen Tagessätzen entscheidet das über Erkennbarkeit.
- **Schweizer Formate durchgehend:** `4'435'265.00`, `27.07.2026`, `8.1 %`.
- **Eine Akzentfarbe, und die trägt ausschliesslich den Status.** Fünf Zustände müssen auf einen Blick unterscheidbar sein: `offen_prov`, `def_vereinbart`, `abgerechnet`, `bezahlt`, `storniert`.
- **Visuelles Gewicht folgt dem Risiko.** „Festschreiben" ist der einzige Knopf mit voller Farbe; alles andere ist zurückhaltend.
- **Gesperrte Zustände erklären sich an Ort und Stelle**, nicht in einer Fehlermeldung danach.
- **Keine Animation, keine Ladespinner-Choreografie.**

Die Umsetzung folgt der `frontend-design`-Skill; die Regeln oben sind die Randbedingungen, nicht das Ergebnis.

## 8. Fehler und Zustände

Jeder Screen kennt vier Zustände: **lädt, leer, Fehler, Daten**. Alle vier werden gebaut, nicht nur der letzte.

Der `api.js`-Wrapper übersetzt die typisierten Serverfehler in deutsche Meldungen:

| Status | Bedeutung | Darstellung |
|---|---|---|
| 400 | `ValidationError` | am betroffenen Feld, sonst über der Aktion |
| 403 | Rolle reicht nicht | über der Aktion |
| 404 | nicht gefunden | Screen-Ebene |
| 5xx / Netzwerk | unerwartet | globales Banner, Rohmeldung einsehbar |

Die beiden Vorbedingungen — gesperrter Zähler, fehlende Debitor-Adresse — sind **keine Fehler, sondern Zustände**. Sie werden angezeigt, bevor gehandelt wird.

## 9. Tests

**Backend-Ergänzungen** (§5): wie alles bisher — Test zuerst, gegen die echte Datenbank, keine Mocks.

**Rechenlogik im Browser:** Summen, Rappenrundung und MWSt je Satz bekommen echte Unit-Tests und **müssen dieselben Ergebnisse liefern wie der Server**. Ein Test vergleicht beide Implementierungen an denselben Eingaben, damit die Anzeige nicht von der Festschreibung abweichen kann.

**Kein Browser-Automatisierungs-Setup.** Für vier Screens kostet es mehr, als es trägt. Stattdessen wird der Durchstich einmal von Hand gegen die migrierten Daten gefahren und dokumentiert — mit den echten Zahlen, wie beim Migrations-Nachweis.

**Abnahmekriterium:** aus der laufenden Anwendung heraus entsteht für ein migriertes Projekt eine festgeschriebene Rechnung mit korrekter Nummer und ein QR-PDF, ohne Terminal.

## 10. Offene Punkte

- Die Kontobezeichnungen tragen im Text noch `7.7%` bzw. `2.5%`, obwohl die Sätze seit 2024 bei 8.1 % bzw. 2.6 % liegen. Wortwahl des Kunden aus `Kontoplan 2024.xlsx`, unverändert übernommen — in der Oberfläche sichtbar.
- Der Kontotyp wird aus der führenden Ziffer abgeleitet (`3` = Ertrag, sonst Aufwand). Dadurch stehen `8000 Ausserordentlicher Ertrag` und `6810 Finanzertrag` als Aufwand. Beide sind in Projekten unbenutzt; eine feinere Regel müsste der Kunde vorgeben.
- Zwei der 151 Projekte tragen im Export gar keine Kontonummer und bleiben ohne Kontierung.
- `20577` (bbz st.gallen ag) hat keine Adresse und ist damit nicht fakturierbar — im Durchstich der Anschauungsfall für den gesperrten Zustand.

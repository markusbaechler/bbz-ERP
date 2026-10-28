# Historischer SAQ-Import aus Reporting_KUBA.xlsx

Werkzeug: `tools/kuba-import` (Lesen und Normalisieren: `kuba.ts`, Import: `import.ts`, CLI: `cli.ts`), SQL in `src/repos/kubaImportRepo.ts`, Tests `test/kubaParse.test.ts` und `test/kubaImport.test.ts` mit einer synthetischen Arbeitsmappe (`test/kubaFixture.ts`, erfundene Namen).

Fachliche Autorität für Aufbau und Regeln der Datei ist das Cockpit **bbz-saq** (`config.js`, `store.js`, `glossary.js`). Die Regeln sind nach TypeScript portiert, damit ERP und Cockpit dasselbe zählen. Zielmodell: Spec v2 §5.4b (`saq_fall`, `saq_pruefung`, `zertifizierung`).

## 1. Ablauf

```bash
npm run migrate
npm run kuba:import -- --datei "C:\Daten\Reporting_KUBA.xlsx"                 # Probelauf (Standard)
npm run kuba:import -- --datei "C:\Daten\Reporting_KUBA.xlsx" --ausfuehren    # Import
```

- **Probelauf zuerst.** Er führt den kompletten Import in einer Transaktion aus, inklusive aller DB-Constraints, und rollt danach zurück.
- Ein **Savepoint je Vorgang**: Ein Fehler verwirft nur diesen Vorgang. Er erscheint im Bericht unter «Nicht importierte Vorgänge» und als Fehler im Data-Quality-Log.
- `--stichtag YYYY-MM-DD` (Standard: heute, Europe/Zurich) legt fest, was «vergangen» oder «in der Zukunft» heisst. Davon hängen die Hinweise «Datum vergangen, aber kein Ergebnis» und der Status historischer Zertifikate (`aktiv`/`abgelaufen`) ab.
- Der Bericht **`KUBA-IMPORT-BERICHT.md`** wird neben der Excel-Datei abgelegt. Er enthält Zähler (Zeilen je Sheet, Vorgänge, zusammengeführte Duplikate, Personen neu/gefunden, Banken zugeordnet/nicht zugeordnet, Runs, Zertifikate, Experten), **Status je Profil** (KUBA-Status wie im Cockpit neben dem ERP-Status, zum Abgleich), die Liste der nicht zugeordneten Banken, die nicht importierten Vorgänge und das vollständige **Data-Quality-Log** (Sheet, Zeile, Header, Rohwert, Stufe, Grund).
- **Der Bericht enthält Personendaten.** Er gehört nicht ins Repo und wird nur intern weitergegeben, genau wie die Excel-Datei selbst.
- Jeder ausgeführte Lauf wird in `integration_lauf` (Typ `kuba.import`, nur Zähler) protokolliert. Jeder angelegte oder ergänzte Fall erhält einen Eintrag im `audit_log` (Aktion `saq.kuba_import`, Benutzer `kuba-import`).
- Ein Strukturfehler bricht ab, bevor die DB berührt wird. Strukturfehler sind: ein fehlendes Sheet, ein fehlender Pflicht-Header oder ein mehrdeutiger Header.

## 2. Datei lesen (wie bbz-saq)

- Gelesen werden nur die Sheets **«First Certification»** und **«Ausgestellte Zertifikate»**. Der Header steht in **Zeile 10**, die Daten beginnen in Zeile 11. Andere Sheets werden nicht geparst.
- Spalten werden **ausschliesslich über den Header-Namen** gemappt (Varianten `… Passed` oder `… yes`, Leerraum und Gross-/Kleinschreibung egal). Die beiden Sheets sind nicht spaltenidentisch.
- Pflicht-Header in beiden Sheets: Last Name, First Name, Role, Employer, Certificate Program, Certificate Language, Birth Date, WE/OE All, WE1–6 und OE1–2 je Passed sowie RUN1–3 je Passed, Date, Score und Result. Im Sheet «Ausgestellte Zertifikate» ist zusätzlich Certificate Start Date Pflicht. Optional sind Communication Language, Certificate Number, Certificate End Date, `… RUN{r} Location` und `OE… RUN{r} Expert 1/2`.
- Leere Zeilen werden übersprungen. Als leer gilt eine Zeile ohne Inhalt in einer gemappten Spalte; Hilfsspalten wie eine Nummerierung zählen nicht.
- Datumszellen liest das Werkzeug als Serienzahl mit Datumsformat und rechnet sie zeitzonenfrei um. Die SheetJS-Date-Objekte werden bewusst nicht verwendet: Sie arbeiten in der lokalen Zeitzone und verschieben Daten um Minuten oder Tage.
- VSS/VSM stammen aus einem Threaded Comment auf Zelle `B{Zeile}` und landen in `saq_fall.kennzeichnung`, z. B. «VSS, VSM».

## 3. Normalisierung und Data-Quality-Log

Jede nicht interpretierbare Zelle erzeugt einen Eintrag im Log, nie ein stilles Überspringen. Die Stufen sind dieselben wie in bbz-saq: **fehler** (Wert wird ignoriert), **hinweis** (interpretiert, abgeleitet oder auffällig) und **nicht-ausgewertet** (Score).

| Feld | Regel |
|---|---|
| Passed | `yes/PASSED/fulfilled` → bestanden, `no/FAILED` → nicht bestanden, Gross-/Kleinschreibung egal; leer → offen; sonst Fehler (auch Boolean oder Zahl) |
| Profil | PK, IK, AFFL, CWMA, KMU, CCoB sowie die Aliase `Affluent/AFF/AF/Affl → AFFL`, `CCOB → CCoB`, `PK FRZ → PK`; unbekannt → Fehler, **Vorgang wird nicht importiert** |
| Sprache | DE/FR/IT/EN sowie die Kürzel D/F/I/E. Ist die Certificate Language leer oder unlesbar, gilt die Reihenfolge: Programm (`PK FRZ` → FR), dann Communication Language, dann DE. Jede Ableitung wird als Hinweis geloggt |
| Result | Zahl 0–1 = Anteil; Zahl > 1 bis 100 = Prozent (Hinweis); Text «89.00%»; sonst Fehler. Im ERP als `resultat_prozent` (0–100, 2 Dezimalen) |
| Score | ganze Zahl von 0 bis 9999, sonst «nicht ausgewertet» (z. B. `#N/A`, verrutschte Zellen) |
| Datum | Datumszelle; Excel-Serienzahl ohne Format (Hinweis); Text `dd.mm.yy(yy)[ / hh:mm]`; Jahr 2000–2100 (Geburtsdatum 1920–2010); sonst Fehler |
| Employer | Alias-Map aus bbz-saq (`src/config/bankAliase.ts`), sonst Rohwert; kein Log-Eintrag |
| Experte | Name, Leerraum vereinheitlicht; Zahl → Fehler; Experte 1 = Experte 2 → Hinweis, Experte 2 entfällt |

Konsistenzhinweise wie im Cockpit:
- Datum vergangen, aber kein Ergebnis.
- Ergebnis erfasst, aber Datum in der Zukunft.
- Passed und Resultat widersprechen sich (Grenze 70 %).
- Mündlich erfasst, aber schriftlich nicht bestanden.
- Run in einem Teil ausserhalb der Profilvorgabe.
- Alle Pflichtteile bestanden, aber Gesamtergebnis leer.
- Geburtsdatum fehlt.
- Duplikat zusammengeführt.
- Profilkonflikt.

**Vorgang und Duplikat:** Ein Vorgang ist eine Person × ein Profil. Der Personenschlüssel besteht aus Nachname, Vorname und Geburtsdatum, normalisiert (ohne Akzente, ss statt ß) und bewusst ohne Arbeitgeber. Zeilen derselben Person mit gleichem Profil und ohne widersprüchliche Runs werden **zusammengeführt**: Lücken werden aufgefüllt, nie überschrieben. Behalten wird die Zeile mit den meisten absolvierten Runs, bei Gleichstand die aus «Ausgestellte Zertifikate». Widersprüchliche Zeilen bleiben eigene Vorgänge (Hinweis «Wiederholung?»).

## 4. Abbildung im ERP

| KUBA | ERP |
|---|---|
| Vorgang | `saq_fall`, `kuba_herkunft` = «Sheet:Zeile», bei Zusammenführung «First Certification:12; Ausgestellte Zertifikate:4»; `variante` erstzertifizierung, `umfang` gesamtpaket; `bemerkung` «Historischer Import aus Reporting KUBA» |
| Last/First Name, Birth Date | `kontakt` (Abgleich siehe unten) |
| Employer | `saq_fall.organisation_id` über `findeOrganisationPerName` (inkl. Aliase). Unbekannte Banken werden **nicht angelegt**. Sie erscheinen im Bericht und in `saq_fall.bemerkung` («Arbeitgeber laut KUBA: …») |
| Role | `saq_fall.rolle` |
| Certificate Language | `saq_fall.sprache` (Ableitung siehe oben) |
| WE{1–6}/OE{1–2} RUN{1–3} | `saq_pruefung` (art, teil, run), **nur mit Datum** (`datum` ist Pflicht). Ein Run mit Ergebnis ohne Datum wird nicht übernommen (Hinweis). Ein Run nur mit Datum wird als geplanter oder ausstehender Run übernommen (`bestanden` null). Result/Score = 0 ohne Passed-Wert gelten als Formelvorgabe und nicht als Resultat. Ort → `ort`; «Remote/Online» → zusätzlich `remote` |
| OE… Expert 1/2 | `experte1_id/experte2_id` → `referent` per Anzeigename. Neue Experten werden als minimaler CRM-Kontakt angelegt (ganzer Name als Nachname, Bemerkung «aus KUBA») und als externer Referent (Fachgebiet `SAQ-Pruefung`) |
| Certificate Number/Start/End | `zertifizierung` (Typ «SAQ Kundenberater Bank», Profil, Sprache, Nummer, ausgestellt = Start, gültig bis = End Date oder Start + 3 Jahre); Status `abgelaufen`, wenn das Ende vor dem Stichtag liegt |

**Status** (`saq_fall.status`), abgeleitet wie in KUBA aus WE All und OE All:
- WE und OE bestanden mit Zertifikat → `zertifiziert`. Als Zertifikat gilt eine Zeile aus «Ausgestellte Zertifikate» oder eine Zeile mit Certificate Number/Start Date; ein Startdatum muss vorhanden sein.
- WE und OE bestanden ohne Startdatum → `bestanden` (Hinweis «nachtragen»).
- WE oder OE nicht bestanden → `nicht_bestanden`.
- Sonst offen: WE bestanden → `schriftlich_bestanden`; mit mindestens einem übernommenen Run → `in_pruefung`; sonst → `angemeldet`.

Im Sheet «Ausgestellte Zertifikate» gelten leere Gesamtergebnisse als bestanden (Hinweis).

**Personenabgleich** (KUBA hat keine E-Mail-Spalte):
- Mit Geburtsdatum: Kontakt mit gleichem normalisiertem Namen **und** gleichem Geburtsdatum.
- Ohne Geburtsdatum: nur ein eindeutiger gleichnamiger Kontakt, der selbst kein Geburtsdatum hat.
- Sonst wird ein neuer Kontakt angelegt (Bemerkung «aus KUBA-Import (Sheet:Zeile)», Interesse Zertifizierung). Gibt es einen gleichnamigen Kontakt ohne Geburtsdatum (z. B. aus FileMaker), wird er **nicht** verwendet. Dafür erscheint der Hinweis «Dublette prüfen» und der Zähler «mögliche Dubletten» im Bericht.
- Bestehende Kontakte werden nur ergänzt (Organisation, Geburtsdatum), nie überschrieben.

**Idempotenz:** Ein erneuter Lauf legt nichts doppelt an. Der bestehende Fall wird so gesucht:
1. Über `kuba_herkunft`, sofern dieselbe «Sheet:Zeile», dasselbe Profil und derselbe Name vorliegen. Diese Zuordnung wird vor dem Lauf für alle Zeilen reserviert.
2. Sonst über Person und Profil ohne widersprüchliche Runs; so wird auch eine Homepage-Anmeldung ohne Runs gefunden.
3. Sonst, wenn die Datei genau eine Zeile und das ERP genau einen freien Fall für Person und Profil hat, über diesen Fall. Die Abweichungen werden gemeldet.

Für bestehende Fälle gilt:
- Fehlende Runs werden angelegt, leere Felder bestehender Runs ergänzt. Weicht ein Run in Datum oder Ergebnis ab, gilt der Hinweis «ERP-Wert bleibt».
- Der Status geht **nur vorwärts**. Offene Fälle steigen auf, abgeschlossene bleiben unverändert; einzige Ausnahme ist `bestanden` → `zertifiziert`.
- `kuba_herkunft` wird auf die aktuelle Fundstelle gesetzt.

**Warum direkte Inserts statt `createSaqFall`/`planePruefung`/`erfasseResultat`:** Historische Daten verletzen die heutigen Ablaufregeln: RUN2 neben bestandenem RUN1, mündlich ohne Arbeitgeberbestätigung oder ohne bestandene schriftliche Prüfung, Teile ausserhalb der Profilvorgabe, abgeschlossene Status. Ausserdem würde `createSaqFall` das Ereignis `saq.angemeldet` in die Outbox schreiben und damit Webhooks und Moodle auslösen. Kontakte, Referenten und die Bankzuordnung laufen über die bestehenden Repos.

## 5. Abweichungen von der Semantik in bbz-saq

- **Sprache:** Ist die Certificate Language *unlesbar* (nicht nur leer), nimmt das ERP ebenfalls die Ableitung vor (Programm oder Communication Language), sonst DE. Der Grund: `saq_fall.sprache` ist Pflicht. Im Cockpit bliebe die Sprache leer.
- **Status «nicht erfasst»** (Gesamtergebnis unlesbar) gibt es im ERP nicht. Der Fall bleibt offen (`in_pruefung`/`angemeldet`), der Fehler steht im Log.
- **`schriftlich_bestanden`:** Das Cockpit kennt nur «offen». Das ERP unterscheidet WE bestanden und OE offen wie `berechneStatus` und zählt das in der Statustabelle getrennt. Die KUBA-Spalten des Berichts zeigen die Cockpit-Sicht.
- **Runs ohne Datum** zählen im Cockpit als Versuch, im ERP fehlen sie (Hinweis im Log).
- **Personenabgleich ohne Geburtsdatum** ist im ERP strenger als im Cockpit: Gleichnamige Kontakte mit Geburtsdatum werden nicht verwendet.
- **Passiv** (offen, älter als 365 Tage) berechnet das ERP zur Laufzeit (`istPassiv`) und speichert es nicht.

## 6. Offene Fragen

1. Wie sind Expertennamen in KUBA geschrieben, «Vorname Nachname» oder «Nachname Vorname»? Davon hängt ab, ob der Import Vor- und Nachname trennen kann. Heute steht der ganze Name im Nachnamen.
2. Passerelle und Wiederholung: Wie sind sie in KUBA erfasst? Heute importiert das Werkzeug alles als `erstzertifizierung`. Profilkonflikte (Wiederholung?) werden nur gemeldet.
3. Haben zwei Profile derselben Person dasselbe Zertifikatsdatum, verhindert `unique (kontakt_id, typ, ausgestellt_am)` das zweite Zertifikat (Fehler im Log, Status `bestanden`). Soll `typ` das Profil enthalten?
4. Sollen Banken aus der Liste «ohne CRM-Organisation» nach Prüfung angelegt werden, oder genügt ein Alias in `bankAliase.ts` (eine Liste für Cockpit und ERP)?
5. Arbeitgeberbestätigung und Rechnungsempfänger fehlen in KUBA. Sollen sie bei historischen Fällen leer bleiben?

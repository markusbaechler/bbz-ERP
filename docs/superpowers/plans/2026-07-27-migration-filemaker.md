# Migration FileMaker → Postgres — Implementation Plan (Plan 5 von 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bestandsdaten aus den FileMaker-Exporten (Kontenplan, MWSt-Sätze, Auftraggeber, Projekte) idempotent nach Postgres übernehmen, den Rechnungszähler kontrolliert setzen und die Übernahme über einen Summenabgleich gegen die FileMaker-Zahlen belegen.

**Architecture:** Ein `src/migration/`-Modul mit reinen, DB-freien Bausteinen (CSV-Parser → FM-Feldnormalisierung → Parent/Child-Gruppierung) und darüber Import-Schritten, die ausschliesslich über `src/repos/*` schreiben. Ein CLI (`src/migration/run.ts`) fährt die Schritte, ist **standardmässig Dry-Run** und erzeugt in beiden Modi einen Markdown-Report mit Summenvergleich und Warnungen. Idempotenz über die fachlichen Schlüssel (`konto.nummer`, `mwst_satz(satz, gueltig_ab)`, `auftraggeber.nummer`, `projekt(stammnummer, jahr)`) — ein zweiter Lauf aktualisiert, statt zu duplizieren.

**Tech Stack:** wie Plan 1–4 (TypeScript, Fastify, `pg`, vitest). **Keine neue Laufzeit-Abhängigkeit** — der CSV-Parser ist selbst geschrieben (~40 Zeilen), weil die FileMaker-Exporte nur ein eng umrissenes Format haben (`;`-getrennt, UTF-8 mit BOM, Zeilenumbrüche in gequoteten Feldern).

## Global Constraints

- **TDD, bite-sized:** Test → rot → Implementierung → grün → Commit. Ein Commit je Task.
- **Ein Branch + PR je Plan:** `plan5-migration-filemaker`, Basis `master`.
- **Aller DB-Zugriff nur über `src/repos/*`.** Migrations-Module enthalten keine SQL-Strings. (Konvention Plan 1–4)
- Beträge `numeric(12,2)`; DATE als String `YYYY-MM-DD` (TZ-sicher, Type-Parser in `pool.ts`).
- Deutsch, **„ss" statt „ß"**. Commit-Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Migration erfindet keine Daten.** Fehlende oder nicht auflösbare Werte werden `null` gesetzt und im Report gemeldet — nie geraten, nie mit Platzhaltern gefüllt.
- **Der Rechnungszähler wird nie aus einem Export abgeleitet.** Er wird nur über einen explizit übergebenen Wert gesetzt und darf nur steigen. (Begründung: Befund B2 unten)
- Quelldateien liegen **ausserhalb** des Repos in `..\fm-discovery\export\` und werden **nicht** eingecheckt (Personen-/Bankdaten).

---

## Befunde aus der Datenanalyse (2026-07-27)

Diese Befunde sind die Grundlage der Task-Zuschnitte. Sie stammen aus einer Auswertung der echten Exportdateien.

**B1 — `export_daten.csv` (Projekte):** 1197 Zeilen, davon **151 Parent-Zeilen** (Zeile mit gefüllter `Projekt_Nr.`); Folgezeilen ohne `Projekt_Nr.` sind Kindzeilen (Faktura/Schritte/Seminare) desselben Projekts. Enthält **nur Jahr 2026** — nicht die ~4967 Projekte des Gesamtbestands. Sollwerte für die Validierung: **151 Projekte**, **49 Auftraggeber-Nummern** (48 Namen, keine Nummer-/Namenskonflikte), Σ `Budget CHF` = **4'435'265.00**, Σ `offen_prov.` = **2'048'973.45**, Σ `abgerechnet` = **2'401'554.55**.

**B2 — Rechnungszähler ist aus den Exporten NICHT ableitbar (Blocker):** `Faktura_Export2.xlsx` enthält 9792 Rechnungen von 2000 bis **26.06.2025**, höchste `Rechnung Nr.` = **31491**. Der echte Beleg aus dem laufenden System (`screens/fm test rechnung.pdf`, Juli 2026) trägt aber Rg-Nr **33214**. Der Export ist also veraltet; ein daraus abgeleiteter Zählerstand würde **bereits vergebene Rechnungsnummern erneut ausgeben** — Verstoss gegen die Lückenlosigkeits-/Unveränderlichkeitsregel (Spec §6.1). `Faktura_Export.xlsx` ist zusätzlich abgebrochen (nur 2000–2008). Deshalb: Zählerwert nur per `--rechnung-max=<n>`, Task 7.

**B3 — Auftraggeber-Adressen fehlen in beiden Exporten (Blocker für QR):** `export_daten.csv` hat keine Adressfelder. Der Adressblock in `Faktura_Export2` hängt an `Bank_Nr.`, was eine **andere Nummernkreis-Tabelle** ist als `Auftraggeber_Nr.` der Projekte: nur 13 von 49 Nummern überschneiden sich, und dort widersprechen sich die Namen (Nr. 1069 = „Urner Kantonalbank" in Projekten, „BMW Christian Jakob AG" in Faktura). Die Adressen **dürfen nicht** aus der Faktura gejoint werden. Auftraggeber werden deshalb ohne Adresse importiert und mit `adresse_unvollstaendig = true` markiert; ein separater Adressen-Export aus FileMaker ist nachzuziehen.

**B4 — Kontonummern mit Ausreissern:** Ertrag `3010, 3011, 3100, 3101, 3102, 3200, 3204, 3700`, Aufwand `5000, 5100, 5200`. Zusätzlich vier fünfstellige Werte `31001, 31021, 32001, 32041` (= vierstelliges Konto mit angehängter `1`, Ursache unbekannt, 9 Projekte / CHF 227'500 Budget betroffen). Diese werden **nicht** stillschweigend umgebogen: Projekt wird importiert, `ertragskonto_id` bleibt `null`, Report meldet es zur Klärung.

**B5 — Feldformate:** Datum `dd.mm.yyyy`; Zahlen bereits dezimalpunkt-normalisiert (`8329.1`), können aber Apostroph-Tausendertrenner enthalten; `Bereich`, `Beschrieb` und `Auftraggeber` sind **mehrzeilig**; `Bereich` enthält in einem Fall die Zahl `3204` statt eines Bereichs (Fehleingabe → verwerfen).

---

## Dateistruktur

```
db/migrations/007_migration_felder.sql   # Zusatzfelder projekt/auftraggeber + Unique-Index mwst_satz
src/domain/types.ts                      # +MigrationProjektInput, Auftraggeber erweitert   (Modify)
src/migration/csv.ts                     # CSV-Parser (RFC4180, ';', BOM, Umbrueche in Feldern)
src/migration/normalize.ts               # FM-Feldnormalisierung (Datum, Zahl, Projektnr., Name, Bereich)
src/migration/gruppen.ts                 # Parent/Child-Gruppierung des Projekt-Exports
src/migration/stammdaten.ts              # Kontenplan + MWSt-Saetze (idempotent)
src/migration/auftraggeber.ts            # Auftraggeber-Import (dedupliziert)
src/migration/projekte.ts                # Projekt-Import (Kontierung, Validierung)
src/migration/report.ts                  # ImportReport-Typ + Markdown-Formatierung
src/migration/run.ts                     # CLI: Dry-Run/Apply, Summenabgleich, Zaehler
src/repos/kontoRepo.ts                   # +findKontoByNummer, +upsertKonto                 (Modify)
src/repos/mwstSatzRepo.ts                # +upsertMwstSatz                                  (Modify)
src/repos/auftraggeberRepo.ts            # +findAuftraggeberByNummer, +upsertAuftraggeberAusMigration (Modify)
src/repos/projektRepo.ts                 # +upsertProjektAusMigration, +projektSummen       (Modify)
src/repos/zaehlerRepo.ts                 # getZaehler / setzeRechnungZaehler
test/fixtures/projekte_mini.csv          # 3 Projekte + Kindzeilen, aus echten Strukturen nachgebaut
test/migrationCsv.test.ts
test/migrationNormalize.test.ts
test/migrationGruppen.test.ts
test/migrationStammdaten.test.ts
test/migrationAuftraggeber.test.ts
test/migrationProjekte.test.ts
test/migrationZaehler.test.ts
test/migrationEchtdaten.test.ts          # optional, skippt ohne ..\fm-discovery\export\
```

---

## Task 1: CSV-Parser + FM-Feldnormalisierung

Reine Funktionen, keine DB — schnelle Tests, Fundament für alles Weitere.

**Files:**
- Create: `src/migration/csv.ts`, `src/migration/normalize.ts`, `test/migrationCsv.test.ts`, `test/migrationNormalize.test.ts`

**Interfaces:**
- Consumes: nichts (reines TypeScript)
- Produces:
  - `parseCsv(text: string, sep?: string): string[][]` — RFC4180: gequotete Felder, `""` als Escape, Zeilenumbrüche innerhalb von Quotes, BOM wird entfernt, `\r` verworfen. Default-Separator `';'`.
  - `csvRecords(text: string, sep?: string): { header: string[]; records: Array<Record<string, string>> }` — erste Zeile = Header; Zeilen mit abweichender Feldzahl werden **nicht** verworfen, fehlende Felder sind `''`.
  - `fmText(v: string | undefined): string | null` — trimmt, `''` → `null`
  - `fmZahl(v: string | undefined): number | null` — entfernt `'`, `’`, Leerzeichen; Komma als Dezimaltrenner wenn kein Punkt vorhanden; nicht-numerisch → `null`
  - `fmDatum(v: string | undefined): string | null` — `'23.07.2026'` → `'2026-07-23'`; alles andere → `null`
  - `fmProjektNummer(v: string): { stammnummer: number; jahr: number }` — `'6231.26'` → `{ stammnummer: 6231, jahr: 2026 }`; Jahres-Pivot: `nn <= 89` → `2000+nn`, sonst `1900+nn`; wirft `ValidationError` bei anderem Format
  - `fmName(v: string): { name: string; zusatz: string | null }` — mehrzeilig: erste Zeile = `name`, Rest (mit `\n` verbunden) = `zusatz`
  - `fmBereich(v: string | undefined): string | null` — erste Zeile; rein numerische Werte → `null` (Fehleingabe, Befund B5)

- [ ] **Step 1: Failing tests schreiben** — `test/migrationCsv.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseCsv, csvRecords } from '../src/migration/csv';

describe('parseCsv', () => {
  it('trennt an ; und entfernt das BOM', () => {
    expect(parseCsv('﻿a;b\n1;2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('haelt Zeilenumbrueche innerhalb gequoteter Felder zusammen', () => {
    const rows = parseCsv('a;b\n"Zeile 1\nZeile 2";x\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('Zeile 1\nZeile 2');
    expect(rows[1][1]).toBe('x');
  });

  it('entschluesselt doppelte Anfuehrungszeichen', () => {
    expect(parseCsv('a\n"er sagte ""hallo"""\n')[1][0]).toBe('er sagte "hallo"');
  });

  it('verwirft \\r und behaelt leere Felder', () => {
    expect(parseCsv('a;b;c\r\n1;;3\r\n')[1]).toEqual(['1', '', '3']);
  });
});

describe('csvRecords', () => {
  it('bildet Records ueber die Kopfzeile', () => {
    const { header, records } = csvRecords('Projekt_Nr.;Jahr\n6231.26;2026\n');
    expect(header).toEqual(['Projekt_Nr.', 'Jahr']);
    expect(records).toEqual([{ 'Projekt_Nr.': '6231.26', Jahr: '2026' }]);
  });

  it('fuellt fehlende Felder mit Leerstring', () => {
    const { records } = csvRecords('a;b;c\n1;2\n');
    expect(records[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
```

`test/migrationNormalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmText, fmZahl, fmDatum, fmProjektNummer, fmName, fmBereich } from '../src/migration/normalize';
import { ValidationError } from '../src/domain/errors';

describe('fmText', () => {
  it('trimmt und macht aus Leer null', () => {
    expect(fmText('  Urner Kantonalbank ')).toBe('Urner Kantonalbank');
    expect(fmText('   ')).toBeNull();
    expect(fmText(undefined)).toBeNull();
  });
});

describe('fmZahl', () => {
  it('liest die Formate des Exports', () => {
    expect(fmZahl('8329.1')).toBe(8329.1);
    expect(fmZahl('24600')).toBe(24600);
    expect(fmZahl('2.5')).toBe(2.5);
    expect(fmZahl('0')).toBe(0);
  });
  it('entfernt Tausendertrenner und akzeptiert Komma-Dezimal', () => {
    expect(fmZahl("1'234.50")).toBe(1234.5);
    expect(fmZahl('1’234.50')).toBe(1234.5);
    expect(fmZahl('1234,50')).toBe(1234.5);
  });
  it('gibt null fuer Leeres und Nicht-Zahlen', () => {
    expect(fmZahl('')).toBeNull();
    expect(fmZahl(undefined)).toBeNull();
    expect(fmZahl('Fr.')).toBeNull();
  });
});

describe('fmDatum', () => {
  it('wandelt dd.mm.yyyy nach ISO', () => {
    expect(fmDatum('23.07.2026')).toBe('2026-07-23');
    expect(fmDatum('01.01.2000')).toBe('2000-01-01');
  });
  it('gibt null bei Leer oder unbekanntem Format', () => {
    expect(fmDatum('')).toBeNull();
    expect(fmDatum('2026-07-23')).toBeNull();
  });
});

describe('fmProjektNummer', () => {
  it('zerlegt Stammnummer und Jahr', () => {
    expect(fmProjektNummer('6231.26')).toEqual({ stammnummer: 6231, jahr: 2026 });
    expect(fmProjektNummer('1285.01')).toEqual({ stammnummer: 1285, jahr: 2001 });
    expect(fmProjektNummer('99.95')).toEqual({ stammnummer: 99, jahr: 1995 });
  });
  it('wirft bei unbekanntem Format', () => {
    expect(() => fmProjektNummer('6231')).toThrow(ValidationError);
    expect(() => fmProjektNummer('')).toThrow(ValidationError);
  });
});

describe('fmName', () => {
  it('trennt mehrzeilige Namen in Name und Zusatz', () => {
    expect(fmName('Universität St. Gallen\nInstitut für Banken und Finanzen'))
      .toEqual({ name: 'Universität St. Gallen', zusatz: 'Institut für Banken und Finanzen' });
    expect(fmName('Urner Kantonalbank')).toEqual({ name: 'Urner Kantonalbank', zusatz: null });
  });
});

describe('fmBereich', () => {
  it('nimmt die erste Zeile', () => {
    expect(fmBereich('Kundenberaterausbildung\nIGK\nBanking')).toBe('Kundenberaterausbildung');
  });
  it('verwirft rein numerische Fehleingaben', () => {
    expect(fmBereich('3204')).toBeNull();
    expect(fmBereich('')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationCsv migrationNormalize` → FAIL („Cannot find module '../src/migration/csv'").

- [ ] **Step 3: Implementieren**

`src/migration/csv.ts`:
```ts
// Minimaler RFC4180-Parser fuer die FileMaker-Exporte: ';'-getrennt, UTF-8 mit BOM,
// Zeilenumbrueche innerhalb gequoteter Felder (mehrzeilige Beschrieb-/Adressfelder).
export function parseCsv(text: string, sep = ';'): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function csvRecords(text: string, sep = ';'): { header: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(text, sep);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ''; });
    return rec;
  });
  return { header, records };
}
```

`src/migration/normalize.ts`:
```ts
import { ValidationError } from '../domain/errors';

export function fmText(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export function fmZahl(v: string | undefined): number | null {
  let t = (v ?? '').trim();
  if (t === '') return null;
  t = t.replace(/['’\s]/g, '');
  if (!t.includes('.') && t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fmDatum(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// '6231.26' -> Stammnummer 6231, Jahr 2026. Pivot 89: Werte darueber gelten als 19xx.
export function fmProjektNummer(v: string): { stammnummer: number; jahr: number } {
  const t = (v ?? '').trim();
  const m = /^(\d{1,5})\.(\d{2})$/.exec(t);
  if (!m) throw new ValidationError(`Projekt_Nr. "${v}" hat nicht das Format <Stammnummer>.<JJ>`);
  const jj = Number(m[2]);
  return { stammnummer: Number(m[1]), jahr: jj <= 89 ? 2000 + jj : 1900 + jj };
}

export function fmName(v: string): { name: string; zusatz: string | null } {
  const zeilen = (v ?? '').split('\n').map((z) => z.trim()).filter((z) => z !== '');
  return { name: zeilen[0] ?? '', zusatz: zeilen.length > 1 ? zeilen.slice(1).join('\n') : null };
}

// Bereich ist mehrzeilig; ein Datensatz enthaelt faelschlich eine Kontonummer (Befund B5).
export function fmBereich(v: string | undefined): string | null {
  const erste = fmText((v ?? '').split('\n')[0]);
  if (erste === null) return null;
  return /^\d+$/.test(erste) ? null : erste;
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationCsv migrationNormalize` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): CSV-Parser und FileMaker-Feldnormalisierung"
```

---

## Task 2: Parent/Child-Gruppierung des Projekt-Exports

Der Export liefert je Projekt eine Parent-Zeile und danach Kindzeilen (Faktura/Schritte/Seminare) mit leeren Parent-Feldern (Befund B1). Diese Struktur wird hier in Gruppen aufgelöst.

**Files:**
- Create: `src/migration/gruppen.ts`, `test/fixtures/projekte_mini.csv`, `test/migrationGruppen.test.ts`

**Interfaces:**
- Consumes: `csvRecords` (Task 1), `ValidationError`
- Produces:
  - `type ProjektGruppe = { projekt: Record<string, string>; kinder: Array<Record<string, string>> }`
  - `gruppiereProjekte(records: Array<Record<string, string>>, schluessel?: string): ProjektGruppe[]` — Default-Schlüssel `'Projekt_Nr.'`; eine Zeile mit gefülltem Schlüssel eröffnet eine Gruppe, alle folgenden ohne gehören dazu; Kindzeile vor der ersten Parent-Zeile → `ValidationError`.

- [ ] **Step 1: Failing test** — zuerst die Fixture `test/fixtures/projekte_mini.csv` anlegen (Spaltennamen exakt wie im echten Export, gekürzt auf die im Import verwendeten Spalten):

```csv
Projekt_Nr.;Jahr;Projekt_Name;Projekt_Kürzel;Bereich;Beschrieb;Auftraggeber;Auftraggeber_Nr.;Ansprechperson;Konto;Aufw. Konto;Budget CHF;Budget Tage;Aufw. Budget CHF;offen_prov.;abgerechnet;alte_Projekt_Nr;Referent intern;MWSt;Erstellt durch;geändert durch;Faktura::Erfassungsdatum;Faktura::Total_Summe Übersicht
1285.26;2026;Connect KB (ehem.) WOB;WOB;"IGK
Managementausbildung";"Budget global: Fr. 24'600.00";Connect KB (ehem.) WOB;1285;Susan Rufer;3010;5000;24600;2.5;3000;24600;;1285.25;sr;;s.haeusler;s.haeusler;;
;;;;;;;;;;;;;;;;;;;;;23.03.2026;4740
;;;;;;;;;;;;;;;;;;;;;28.04.2026;1580
4991.26;2026;Fachforum Hypothekenmanagement;FHU;3204;;"Universität St. Gallen
Institut für Banken und Finanzen";1260;Urs F. Basler;31001;;11250;1;;0;11250;4991.25;pw;exkl.;p.meier;m.lippuner;;
6231.26;2026;Ausgaben/Einnahmen bbz ohne Projektbezug;;;;bbz st.gallen ag;20577;Marco Lippuner;;;;;;;7705;6231.25;ml;;p.meier;m.lippuner;23.07.2026;8329.1
```

`test/migrationGruppen.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { ValidationError } from '../src/domain/errors';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');

describe('gruppiereProjekte', () => {
  it('bildet je Parent-Zeile eine Gruppe mit ihren Kindzeilen', () => {
    const { records } = csvRecords(readFileSync(fixture, 'utf8'));
    const gruppen = gruppiereProjekte(records);
    expect(gruppen).toHaveLength(3);
    expect(gruppen.map((g) => g.projekt['Projekt_Nr.'])).toEqual(['1285.26', '4991.26', '6231.26']);
    expect(gruppen[0].kinder).toHaveLength(2);
    expect(gruppen[0].kinder[0]['Faktura::Erfassungsdatum']).toBe('23.03.2026');
    expect(gruppen[1].kinder).toHaveLength(0);
  });

  it('behaelt mehrzeilige Felder der Parent-Zeile', () => {
    const { records } = csvRecords(readFileSync(fixture, 'utf8'));
    const g = gruppiereProjekte(records);
    expect(g[0].projekt['Bereich']).toBe('IGK\nManagementausbildung');
    expect(g[1].projekt['Auftraggeber']).toBe('Universität St. Gallen\nInstitut für Banken und Finanzen');
  });

  it('wirft, wenn eine Kindzeile vor der ersten Parent-Zeile steht', () => {
    expect(() => gruppiereProjekte([{ 'Projekt_Nr.': '', Jahr: '2026' }])).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationGruppen` → FAIL.

- [ ] **Step 3: Implementieren** — `src/migration/gruppen.ts`

```ts
import { ValidationError } from '../domain/errors';

export type ProjektGruppe = {
  projekt: Record<string, string>;
  kinder: Array<Record<string, string>>;
};

// Der FileMaker-Export wiederholt die Projektfelder nicht: eine Zeile mit gefuellter
// Projekt_Nr. eroeffnet ein Projekt, alle folgenden Zeilen ohne gehoeren als
// Kindzeilen (Faktura/Schritte/Seminare) dazu.
export function gruppiereProjekte(
  records: Array<Record<string, string>>,
  schluessel = 'Projekt_Nr.',
): ProjektGruppe[] {
  const gruppen: ProjektGruppe[] = [];
  for (const rec of records) {
    const key = (rec[schluessel] ?? '').trim();
    if (key !== '') {
      gruppen.push({ projekt: rec, kinder: [] });
    } else {
      const aktuell = gruppen[gruppen.length - 1];
      if (!aktuell) throw new ValidationError(`Kindzeile ohne vorangehende Zeile mit ${schluessel}`);
      aktuell.kinder.push(rec);
    }
  }
  return gruppen;
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationGruppen` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): Parent/Child-Gruppierung des Projekt-Exports"
```

---

## Task 3: Schema-Erweiterung + Repo-Funktionen für den Import

Die Migration braucht Felder, die v1 bisher nicht hatte (Spec §4.2: `alte_projekt_nr`, Aufwand, Audit) und die FM-Summen zur Validierung. Dazu Lookup-/Upsert-Funktionen in den Repos — Migrations-Module dürfen kein SQL enthalten.

**Files:**
- Create: `db/migrations/007_migration_felder.sql`, `src/repos/zaehlerRepo.ts`, `test/migrationRepos.test.ts`
- Modify: `src/domain/types.ts`, `src/repos/kontoRepo.ts`, `src/repos/mwstSatzRepo.ts`, `src/repos/auftraggeberRepo.ts`, `src/repos/projektRepo.ts`

**Interfaces:**
- Consumes: `Konto`, `MwstSatz`, `Auftraggeber`, `Projekt`, `NotFoundError`, `ValidationError`
- Produces:
  - `Auftraggeber` erhält `zusatz: string | null` und `adresseUnvollstaendig: boolean`
  - `type MigrationProjektInput = { stammnummer: number; jahr: number; name: string; auftraggeberId: string; kuerzel: string | null; bereich: string | null; beschrieb: string | null; ansprechperson: string | null; ertragskontoId: string | null; aufwandKontoId: string | null; budgetChf: number | null; budgetTage: number | null; aufwandBudgetChf: number | null; fmOffenProv: number | null; fmAbgerechnet: number | null; alteProjektNr: string | null; projektleitungKuerzel: string | null; mwstModus: 'exkl' | 'inkl'; erstelltDurch: string | null; geaendertDurch: string | null }`
  - `findKontoByNummer(pool, nummer: string): Promise<Konto | null>`
  - `upsertKonto(pool, input: { nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }): Promise<{ konto: Konto; neu: boolean }>`
  - `upsertMwstSatz(pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string | null }): Promise<{ mwstSatz: MwstSatz; neu: boolean }>`
  - `findAuftraggeberByNummer(pool, nummer: string): Promise<Auftraggeber | null>`
  - `upsertAuftraggeberAusMigration(pool, input: { nummer: string; name: string; zusatz?: string | null; ansprechperson?: string | null }): Promise<{ auftraggeber: Auftraggeber; neu: boolean }>` — legt ohne Adresse an (`strasse/plz/ort` = `''`) und setzt `adresse_unvollstaendig = true`; überschreibt eine bereits erfasste Adresse **nicht**
  - `upsertProjektAusMigration(pool, input: MigrationProjektInput): Promise<{ projekt: Projekt; neu: boolean }>`
  - `projektSummen(pool, jahr: number): Promise<{ anzahl: number; budgetChf: number; offenProv: number; abgerechnet: number }>`
  - `getZaehler(pool, name: string): Promise<number>`
  - `setzeRechnungZaehler(pool, wert: number): Promise<number>` — setzt `zaehler.rechnung_lfd_nr`; wirft `ValidationError`, wenn `wert` kleiner als der aktuelle Stand ist (Zähler darf nur steigen)

- [ ] **Step 1: Failing test** — `test/migrationRepos.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { findKontoByNummer, upsertKonto } from '../src/repos/kontoRepo';
import { upsertMwstSatz, findGueltigenSatz } from '../src/repos/mwstSatzRepo';
import { findAuftraggeberByNummer, upsertAuftraggeberAusMigration, createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { upsertProjektAusMigration, projektSummen, getJahresverlauf } from '../src/repos/projektRepo';
import { getZaehler, setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import { ValidationError } from '../src/domain/errors';
import type { MigrationProjektInput } from '../src/domain/types';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('konto-Upsert', () => {
  it('legt an und ist beim zweiten Lauf idempotent', async () => {
    const a = await upsertKonto(getPool(), { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' });
    expect(a.neu).toBe(true);
    const b = await upsertKonto(getPool(), { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' });
    expect(b.neu).toBe(false);
    expect(b.konto.id).toBe(a.konto.id);
    expect((await findKontoByNummer(getPool(), '3100'))?.id).toBe(a.konto.id);
    expect(await findKontoByNummer(getPool(), '9999')).toBeNull();
  });
});

describe('mwst_satz-Upsert', () => {
  it('ist idempotent ueber Satz und Gueltigkeitsbeginn', async () => {
    const a = await upsertMwstSatz(getPool(), { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01' });
    const b = await upsertMwstSatz(getPool(), { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01' });
    expect(a.neu).toBe(true);
    expect(b.neu).toBe(false);
    expect((await findGueltigenSatz(getPool(), 8.1, '2026-07-23')).id).toBe(a.mwstSatz.id);
  });

  it('erlaubt denselben Satz in zwei Perioden', async () => {
    await upsertMwstSatz(getPool(), { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' });
    await upsertMwstSatz(getPool(), { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2024-01-01' });
    expect((await findGueltigenSatz(getPool(), 3.8, '2015-06-01')).gueltigBis).toBe('2017-12-31');
    expect((await findGueltigenSatz(getPool(), 3.8, '2026-06-01')).gueltigBis).toBeNull();
  });
});

describe('auftraggeber-Upsert aus Migration', () => {
  it('legt ohne Adresse an und markiert sie als unvollstaendig', async () => {
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1069', name: 'Urner Kantonalbank', ansprechperson: 'Peter Muster' });
    expect(r.neu).toBe(true);
    expect(r.auftraggeber.adresseUnvollstaendig).toBe(true);
    expect(r.auftraggeber.strasse).toBe('');
    expect((await findAuftraggeberByNummer(getPool(), '1069'))?.name).toBe('Urner Kantonalbank');
  });

  it('uebernimmt den Zusatz mehrzeiliger Namen', async () => {
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1260', name: 'Universität St. Gallen', zusatz: 'Institut für Banken und Finanzen' });
    expect(r.auftraggeber.zusatz).toBe('Institut für Banken und Finanzen');
  });

  it('ueberschreibt eine bereits erfasste Adresse nicht', async () => {
    await createAuftraggeber(getPool(), { nummer: '1117', name: 'Schwyzer KB', strasse: 'Bahnhofstr. 3', plz: '6430', ort: 'Schwyz' });
    const r = await upsertAuftraggeberAusMigration(getPool(), { nummer: '1117', name: 'Schwyzer Kantonalbank' });
    expect(r.neu).toBe(false);
    expect(r.auftraggeber.name).toBe('Schwyzer Kantonalbank');
    expect(r.auftraggeber.strasse).toBe('Bahnhofstr. 3');
    expect(r.auftraggeber.adresseUnvollstaendig).toBe(false);
  });
});

describe('projekt-Upsert aus Migration', () => {
  const basis = (over: Partial<MigrationProjektInput> = {}): MigrationProjektInput => ({
    stammnummer: 6231, jahr: 2026, name: 'Ausgaben bbz', auftraggeberId: '', kuerzel: null,
    bereich: null, beschrieb: null, ansprechperson: null, ertragskontoId: null, aufwandKontoId: null,
    budgetChf: 1000, budgetTage: null, aufwandBudgetChf: null, fmOffenProv: 400, fmAbgerechnet: 600,
    alteProjektNr: '6231.25', projektleitungKuerzel: 'ml', mwstModus: 'exkl',
    erstelltDurch: 'p.meier', geaendertDurch: 'm.lippuner', ...over,
  });

  it('legt an, aktualisiert beim zweiten Lauf und haelt die Nummer stabil', async () => {
    const ag = await upsertAuftraggeberAusMigration(getPool(), { nummer: '20577', name: 'bbz st.gallen ag' });
    const a = await upsertProjektAusMigration(getPool(), basis({ auftraggeberId: ag.auftraggeber.id }));
    expect(a.neu).toBe(true);
    expect(a.projekt.nummer).toBe('6231.26');

    const b = await upsertProjektAusMigration(getPool(), basis({ auftraggeberId: ag.auftraggeber.id, name: 'Ausgaben bbz (neu)', budgetChf: 1500 }));
    expect(b.neu).toBe(false);
    expect(b.projekt.id).toBe(a.projekt.id);
    expect(b.projekt.name).toBe('Ausgaben bbz (neu)');
    expect(b.projekt.budgetChf).toBe(1500);
    expect(await getJahresverlauf(getPool(), 6231)).toHaveLength(1);
  });

  it('liefert die Jahressummen fuer den Abgleich', async () => {
    const s = await projektSummen(getPool(), 2026);
    expect(s.anzahl).toBe(1);
    expect(s.budgetChf).toBe(1500);
    expect(s.offenProv).toBe(400);
    expect(s.abgerechnet).toBe(600);
  });
});

describe('zaehlerRepo', () => {
  it('startet bei 0 und laesst sich hochsetzen', async () => {
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
    expect(await setzeRechnungZaehler(getPool(), 33214)).toBe(33214);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('verweigert das Zuruecksetzen', async () => {
    await expect(setzeRechnungZaehler(getPool(), 31491)).rejects.toBeInstanceOf(ValidationError);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationRepos` → FAIL.

- [ ] **Step 3: Implementieren**

`db/migrations/007_migration_felder.sql`:
```sql
alter table auftraggeber
  add column zusatz text,
  add column adresse_unvollstaendig boolean not null default false;

alter table projekt
  add column alte_projekt_nr text,
  add column ansprechperson text,
  add column beschrieb text,
  add column projektleitung_kuerzel text,
  add column aufwand_budget_chf numeric(12,2),
  add column aufwand_konto_id uuid references konto(id),
  add column fm_offen_prov numeric(12,2),      -- FileMaker-Stand "offen_prov.", nur Abgleich/Historie
  add column fm_abgerechnet numeric(12,2),     -- FileMaker-Stand "abgerechnet", nur Abgleich/Historie
  add column erstellt_durch text,
  add column geaendert_durch text;

-- Idempotenz-Schluessel des Stammdaten-Imports
create unique index mwst_satz_satz_ab_idx on mwst_satz(satz, gueltig_ab);
```

`src/domain/types.ts` — `Auftraggeber` um zwei Felder erweitern und den Migrations-Input ergänzen:
```ts
// im bestehenden Auftraggeber-Typ ergaenzen:
//   zusatz: string | null;
//   adresseUnvollstaendig: boolean;

export type MigrationProjektInput = {
  stammnummer: number; jahr: number; name: string; auftraggeberId: string;
  kuerzel: string | null; bereich: string | null; beschrieb: string | null; ansprechperson: string | null;
  ertragskontoId: string | null; aufwandKontoId: string | null;
  budgetChf: number | null; budgetTage: number | null; aufwandBudgetChf: number | null;
  fmOffenProv: number | null; fmAbgerechnet: number | null;
  alteProjektNr: string | null; projektleitungKuerzel: string | null;
  mwstModus: 'exkl' | 'inkl';
  erstelltDurch: string | null; geaendertDurch: string | null;
};
```

`src/repos/kontoRepo.ts` — anfügen:
```ts
export async function findKontoByNummer(pool: pg.Pool, nummer: string): Promise<Konto | null> {
  const r = await pool.query('select * from konto where nummer=$1', [nummer]);
  return r.rowCount ? map(r.rows[0]) : null;
}

export async function upsertKonto(pool: pg.Pool, input: { nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }): Promise<{ konto: Konto; neu: boolean }> {
  const r = await pool.query(
    `insert into konto(nummer,bezeichnung,typ) values ($1,$2,$3)
     on conflict (nummer) do update set bezeichnung=excluded.bezeichnung, typ=excluded.typ
     returning *, (xmax = 0) as neu`,
    [input.nummer, input.bezeichnung, input.typ]);
  return { konto: map(r.rows[0]), neu: r.rows[0].neu };
}
```

`src/repos/mwstSatzRepo.ts` — anfügen:
```ts
export async function upsertMwstSatz(pool: pg.Pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string | null }): Promise<{ mwstSatz: MwstSatz; neu: boolean }> {
  const r = await pool.query(
    `insert into mwst_satz(satz,bezeichnung,gueltig_ab,gueltig_bis) values ($1,$2,$3,$4)
     on conflict (satz, gueltig_ab) do update set bezeichnung=excluded.bezeichnung, gueltig_bis=excluded.gueltig_bis
     returning *, (xmax = 0) as neu`,
    [input.satz, input.bezeichnung, input.gueltigAb, input.gueltigBis ?? null]);
  return { mwstSatz: map(r.rows[0]), neu: r.rows[0].neu };
}
```

`src/repos/auftraggeberRepo.ts` — `map` um die neuen Felder erweitern und anfügen:
```ts
// in map() ergaenzen:  zusatz: r.zusatz, adresseUnvollstaendig: r.adresse_unvollstaendig,

export async function findAuftraggeberByNummer(pool: pg.Pool, nummer: string): Promise<Auftraggeber | null> {
  const r = await pool.query('select * from auftraggeber where nummer=$1', [nummer]);
  return r.rowCount ? map(r.rows[0]) : null;
}

// Import ohne Adresse: der FileMaker-Projektexport enthaelt keine Adressfelder (Befund B3).
// Bereits erfasste Adressen werden nie ueberschrieben.
export async function upsertAuftraggeberAusMigration(pool: pg.Pool, input: {
  nummer: string; name: string; zusatz?: string | null; ansprechperson?: string | null;
}): Promise<{ auftraggeber: Auftraggeber; neu: boolean }> {
  if (!input.nummer?.trim()) throw new ValidationError('nummer ist Pflicht');
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  const r = await pool.query(
    `insert into auftraggeber(nummer,name,zusatz,strasse,plz,ort,ansprechperson,adresse_unvollstaendig)
     values ($1,$2,$3,'','','',$4,true)
     on conflict (nummer) do update set
       name=excluded.name,
       zusatz=coalesce(excluded.zusatz, auftraggeber.zusatz),
       ansprechperson=coalesce(excluded.ansprechperson, auftraggeber.ansprechperson)
     returning *, (xmax = 0) as neu`,
    [input.nummer, input.name, input.zusatz ?? null, input.ansprechperson ?? null]);
  return { auftraggeber: map(r.rows[0]), neu: r.rows[0].neu };
}
```

`src/repos/projektRepo.ts` — `map` um `alteProjektNr` etc. **nicht** erweitern (der `Projekt`-Typ bleibt schlank); anfügen:
```ts
import type { MigrationProjektInput } from '../domain/types';

export async function upsertProjektAusMigration(pool: pg.Pool, input: MigrationProjektInput): Promise<{ projekt: Projekt; neu: boolean }> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.stammnummer}.${String(input.jahr).slice(-2)}`;
  const r = await pool.query(
    `insert into projekt(nummer,stammnummer,jahr,name,auftraggeber_id,ertragskonto_id,aufwand_konto_id,
                         kuerzel,bereich,beschrieb,ansprechperson,budget_chf,budget_tage,aufwand_budget_chf,
                         fm_offen_prov,fm_abgerechnet,alte_projekt_nr,projektleitung_kuerzel,mwst_modus,
                         erstellt_durch,geaendert_durch)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     on conflict (stammnummer, jahr) do update set
       name=excluded.name, auftraggeber_id=excluded.auftraggeber_id,
       ertragskonto_id=excluded.ertragskonto_id, aufwand_konto_id=excluded.aufwand_konto_id,
       kuerzel=excluded.kuerzel, bereich=excluded.bereich, beschrieb=excluded.beschrieb,
       ansprechperson=excluded.ansprechperson, budget_chf=excluded.budget_chf,
       budget_tage=excluded.budget_tage, aufwand_budget_chf=excluded.aufwand_budget_chf,
       fm_offen_prov=excluded.fm_offen_prov, fm_abgerechnet=excluded.fm_abgerechnet,
       alte_projekt_nr=excluded.alte_projekt_nr, projektleitung_kuerzel=excluded.projektleitung_kuerzel,
       mwst_modus=excluded.mwst_modus, geaendert_durch=excluded.geaendert_durch, geaendert_am=now()
     returning *, (xmax = 0) as neu`,
    [nummer, input.stammnummer, input.jahr, input.name, input.auftraggeberId,
     input.ertragskontoId, input.aufwandKontoId, input.kuerzel, input.bereich, input.beschrieb,
     input.ansprechperson, input.budgetChf, input.budgetTage, input.aufwandBudgetChf,
     input.fmOffenProv, input.fmAbgerechnet, input.alteProjektNr, input.projektleitungKuerzel,
     input.mwstModus, input.erstelltDurch, input.geaendertDurch]);
  return { projekt: map(r.rows[0]), neu: r.rows[0].neu };
}

export async function projektSummen(pool: pg.Pool, jahr: number): Promise<{ anzahl: number; budgetChf: number; offenProv: number; abgerechnet: number }> {
  const r = await pool.query(
    `select count(*)::int as anzahl,
            coalesce(sum(budget_chf),0)::numeric   as budget_chf,
            coalesce(sum(fm_offen_prov),0)::numeric as offen_prov,
            coalesce(sum(fm_abgerechnet),0)::numeric as abgerechnet
     from projekt where jahr=$1`, [jahr]);
  const row = r.rows[0];
  return { anzahl: row.anzahl, budgetChf: Number(row.budget_chf), offenProv: Number(row.offen_prov), abgerechnet: Number(row.abgerechnet) };
}
```

`src/repos/zaehlerRepo.ts`:
```ts
import type pg from 'pg';
import { ValidationError, NotFoundError } from '../domain/errors';

export async function getZaehler(pool: pg.Pool, name: string): Promise<number> {
  const r = await pool.query('select wert from zaehler where name=$1', [name]);
  if (!r.rowCount) throw new NotFoundError(`Zaehler ${name} nicht gefunden`);
  return Number(r.rows[0].wert);
}

// Der Zaehler darf nur steigen: ein Rueckwaertssetzen wuerde bereits vergebene
// Rechnungsnummern erneut ausgeben (Spec §6.1, Befund B2).
export async function setzeRechnungZaehler(pool: pg.Pool, wert: number): Promise<number> {
  if (!Number.isInteger(wert) || wert < 0) throw new ValidationError('Zaehlerwert muss eine nicht-negative Ganzzahl sein');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cur = await client.query(`select wert from zaehler where name='rechnung_lfd_nr' for update`);
    if (!cur.rowCount) throw new NotFoundError('Zaehler rechnung_lfd_nr nicht gefunden');
    const alt = Number(cur.rows[0].wert);
    if (wert < alt) throw new ValidationError(`Zaehler steht bereits auf ${alt}; ${wert} wuerde Nummern doppelt vergeben`);
    const upd = await client.query(`update zaehler set wert=$1 where name='rechnung_lfd_nr' returning wert`, [wert]);
    await client.query('commit');
    return Number(upd.rows[0].wert);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationRepos` → PASS; danach `npm test` (alle Suiten, prüft dass die erweiterten Repos nichts brechen) → PASS; `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): Schema-Zusatzfelder und Repo-Upserts fuer den Import"
```

---

## Task 4: Stammdaten-Import (Kontenplan + MWSt-Sätze)

**Files:**
- Create: `src/migration/stammdaten.ts`, `test/migrationStammdaten.test.ts`

**Interfaces:**
- Consumes: `upsertKonto`, `upsertMwstSatz`
- Produces:
  - `KONTENPLAN: ReadonlyArray<{ nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }>` — die 11 im Export belegten Konten (Befund B4)
  - `MWST_SAETZE: ReadonlyArray<{ satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string | null }>` — die Schweizer Satzhistorie, die alle 12 im Export vorkommenden Sätze abdeckt
  - `importStammdaten(pool): Promise<{ konten: { angelegt: number; vorhanden: number }; mwstSaetze: { angelegt: number; vorhanden: number } }>`

- [ ] **Step 1: Failing test** — `test/migrationStammdaten.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { importStammdaten, KONTENPLAN, MWST_SAETZE } from '../src/migration/stammdaten';
import { findKontoByNummer, listKonten } from '../src/repos/kontoRepo';
import { findGueltigenSatz } from '../src/repos/mwstSatzRepo';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('importStammdaten', () => {
  it('legt Kontenplan und Satzhistorie an', async () => {
    const r = await importStammdaten(getPool());
    expect(r.konten.angelegt).toBe(KONTENPLAN.length);
    expect(r.mwstSaetze.angelegt).toBe(MWST_SAETZE.length);
    expect((await findKontoByNummer(getPool(), '3100'))?.typ).toBe('Ertrag');
    expect((await findKontoByNummer(getPool(), '5000'))?.typ).toBe('Aufwand');
    expect(await listKonten(getPool())).toHaveLength(KONTENPLAN.length);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await importStammdaten(getPool());
    expect(r.konten.angelegt).toBe(0);
    expect(r.konten.vorhanden).toBe(KONTENPLAN.length);
    expect(r.mwstSaetze.angelegt).toBe(0);
    expect(await listKonten(getPool())).toHaveLength(KONTENPLAN.length);
  });

  it('deckt alle im Export vorkommenden MWSt-Saetze zum passenden Datum ab', async () => {
    expect((await findGueltigenSatz(getPool(), 8.1, '2026-07-23')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.7, '2020-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 7.6, '2005-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 8.0, '2015-05-01')).bezeichnung).toBe('Normal');
    expect((await findGueltigenSatz(getPool(), 2.6, '2026-01-01')).bezeichnung).toBe('Reduziert');
    expect((await findGueltigenSatz(getPool(), 0, '2026-01-01')).bezeichnung).toBe('Befreit/ausgenommen');
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationStammdaten` → FAIL.

- [ ] **Step 3: Implementieren** — `src/migration/stammdaten.ts`

```ts
import type pg from 'pg';
import { upsertKonto } from '../repos/kontoRepo';
import { upsertMwstSatz } from '../repos/mwstSatzRepo';

// Die im Projekt-Export belegten Konten (Befund B4).
// ACHTUNG: Die Bezeichnungen sind aus der Bereichs-Zuordnung des Exports abgeleitet
// und vor dem produktiven Lauf gegen den bbz-Kontenplan zu bestaetigen.
export const KONTENPLAN = [
  { nummer: '3010', bezeichnung: 'Ertrag Managementausbildung/IGK', typ: 'Ertrag' },
  { nummer: '3011', bezeichnung: 'Ertrag Leadership/Unternehmensentwicklung', typ: 'Ertrag' },
  { nummer: '3100', bezeichnung: 'Ertrag Banking', typ: 'Ertrag' },
  { nummer: '3101', bezeichnung: 'Ertrag Kundenberaterausbildung', typ: 'Ertrag' },
  { nummer: '3102', bezeichnung: 'Ertrag Banking (weitere)', typ: 'Ertrag' },
  { nummer: '3200', bezeichnung: 'Ertrag Lizenzierung', typ: 'Ertrag' },
  { nummer: '3204', bezeichnung: 'Ertrag Lizenzierung (weitere)', typ: 'Ertrag' },
  { nummer: '3700', bezeichnung: 'Uebriger Ertrag', typ: 'Ertrag' },
  { nummer: '5000', bezeichnung: 'Direkter Projektaufwand', typ: 'Aufwand' },
  { nummer: '5100', bezeichnung: 'Referentenaufwand', typ: 'Aufwand' },
  { nummer: '5200', bezeichnung: 'Uebriger Projektaufwand', typ: 'Aufwand' },
] as const satisfies ReadonlyArray<{ nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }>;

// Schweizer MWSt-Satzhistorie. Deckt alle 12 im Faktura-Export vorkommenden Saetze ab
// (0, 2, 2.4, 2.5, 2.6, 3.6, 3.7, 3.8, 7.6, 7.7, 8, 8.1) — noetig, damit historische
// Belege beim spaeteren Rechnungsimport ihren gueltigen Satz finden.
export const MWST_SAETZE = [
  { satz: 0.0, bezeichnung: 'Befreit/ausgenommen', gueltigAb: '1995-01-01', gueltigBis: null },
  { satz: 2.0, bezeichnung: 'Reduziert', gueltigAb: '1995-01-01', gueltigBis: '1998-12-31' },
  { satz: 2.4, bezeichnung: 'Reduziert', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 2.5, bezeichnung: 'Reduziert', gueltigAb: '2011-01-01', gueltigBis: '2023-12-31' },
  { satz: 2.6, bezeichnung: 'Reduziert', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 3.6, bezeichnung: 'Beherbergung', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 3.7, bezeichnung: 'Beherbergung', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 3.8, bezeichnung: 'Beherbergung', gueltigAb: '2024-01-01', gueltigBis: null },
  { satz: 7.6, bezeichnung: 'Normal', gueltigAb: '2001-01-01', gueltigBis: '2010-12-31' },
  { satz: 8.0, bezeichnung: 'Normal', gueltigAb: '2011-01-01', gueltigBis: '2017-12-31' },
  { satz: 7.7, bezeichnung: 'Normal', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' },
  { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01', gueltigBis: null },
] as const satisfies ReadonlyArray<{ satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string | null }>;

export async function importStammdaten(pool: pg.Pool): Promise<{
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
}> {
  const konten = { angelegt: 0, vorhanden: 0 };
  for (const k of KONTENPLAN) {
    const r = await upsertKonto(pool, { nummer: k.nummer, bezeichnung: k.bezeichnung, typ: k.typ });
    r.neu ? konten.angelegt++ : konten.vorhanden++;
  }
  const mwstSaetze = { angelegt: 0, vorhanden: 0 };
  for (const s of MWST_SAETZE) {
    const r = await upsertMwstSatz(pool, s);
    r.neu ? mwstSaetze.angelegt++ : mwstSaetze.vorhanden++;
  }
  return { konten, mwstSaetze };
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationStammdaten` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): Kontenplan und MWSt-Satzhistorie importieren"
```

---

## Task 5: Auftraggeber-Import

**Files:**
- Create: `src/migration/auftraggeber.ts`, `test/migrationAuftraggeber.test.ts`

**Interfaces:**
- Consumes: `ProjektGruppe`, `fmText`, `fmName`, `upsertAuftraggeberAusMigration`
- Produces:
  - `type AuftraggeberImportErgebnis = { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number; idNachNummer: Map<string, string>; warnungen: string[] }`
  - `importAuftraggeber(pool, gruppen: ProjektGruppe[]): Promise<AuftraggeberImportErgebnis>` — dedupliziert über `Auftraggeber_Nr.`; erste Namensvariante gewinnt, abweichende Folgevarianten erzeugen eine Warnung; Gruppen ohne `Auftraggeber_Nr.` oder ohne Namen werden übersprungen und gemeldet; `idNachNummer` liefert dem Projekt-Import die FK.

- [ ] **Step 1: Failing test** — `test/migrationAuftraggeber.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { importAuftraggeber } from '../src/migration/auftraggeber';
import { findAuftraggeberByNummer } from '../src/repos/auftraggeberRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');
const gruppen = () => gruppiereProjekte(csvRecords(readFileSync(fixture, 'utf8')).records);

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('importAuftraggeber', () => {
  it('legt je Nummer genau einen Auftraggeber an', async () => {
    const r = await importAuftraggeber(getPool(), gruppen());
    expect(r.gelesen).toBe(3);
    expect(r.neu).toBe(3);
    expect(r.ohneAdresse).toBe(3);
    expect(r.idNachNummer.size).toBe(3);
    expect((await findAuftraggeberByNummer(getPool(), '1285'))?.name).toBe('Connect KB (ehem.) WOB');
  });

  it('zerlegt mehrzeilige Namen in Name und Zusatz', async () => {
    const a = await findAuftraggeberByNummer(getPool(), '1260');
    expect(a?.name).toBe('Universität St. Gallen');
    expect(a?.zusatz).toBe('Institut für Banken und Finanzen');
    expect(a?.adresseUnvollstaendig).toBe(true);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await importAuftraggeber(getPool(), gruppen());
    expect(r.neu).toBe(0);
    expect(r.aktualisiert).toBe(3);
  });

  it('warnt bei abweichendem Namen zur gleichen Nummer und ueberspringt Zeilen ohne Nummer', async () => {
    const g = gruppen();
    g.push({ projekt: { 'Projekt_Nr.': '9999.26', Auftraggeber: 'Connect KB anders', 'Auftraggeber_Nr.': '1285' }, kinder: [] });
    g.push({ projekt: { 'Projekt_Nr.': '9998.26', Auftraggeber: 'Ohne Nummer', 'Auftraggeber_Nr.': '' }, kinder: [] });
    const r = await importAuftraggeber(getPool(), g);
    expect(r.warnungen.some((w) => w.includes('1285'))).toBe(true);
    expect(r.warnungen.some((w) => w.includes('9998.26'))).toBe(true);
    expect((await findAuftraggeberByNummer(getPool(), '1285'))?.name).toBe('Connect KB (ehem.) WOB');
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationAuftraggeber` → FAIL.

- [ ] **Step 3: Implementieren** — `src/migration/auftraggeber.ts`

```ts
import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import { fmText, fmName } from './normalize';
import { upsertAuftraggeberAusMigration } from '../repos/auftraggeberRepo';

export type AuftraggeberImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number;
  idNachNummer: Map<string, string>;
  warnungen: string[];
};

// Der Projekt-Export nennt Auftraggeber nur mit Nummer und Namen — keine Adresse (Befund B3).
// Deshalb wird hier bewusst ohne Adresse importiert und der Datensatz markiert.
export async function importAuftraggeber(pool: pg.Pool, gruppen: ProjektGruppe[]): Promise<AuftraggeberImportErgebnis> {
  const warnungen: string[] = [];
  const gesehen = new Map<string, { name: string; zusatz: string | null; ansprechperson: string | null }>();

  for (const g of gruppen) {
    const projektNr = fmText(g.projekt['Projekt_Nr.']) ?? '(ohne Nr.)';
    const nummer = fmText(g.projekt['Auftraggeber_Nr.']);
    const roh = fmText(g.projekt['Auftraggeber']);
    if (nummer === null || roh === null) {
      warnungen.push(`Projekt ${projektNr}: ohne Auftraggeber-Nummer oder -Name uebersprungen`);
      continue;
    }
    const { name, zusatz } = fmName(roh);
    const vorhanden = gesehen.get(nummer);
    if (!vorhanden) {
      gesehen.set(nummer, { name, zusatz, ansprechperson: fmText(g.projekt['Ansprechperson']) });
    } else if (vorhanden.name !== name) {
      warnungen.push(`Auftraggeber-Nr. ${nummer}: abweichende Namen "${vorhanden.name}" / "${name}" — erster gewinnt`);
    }
  }

  const ergebnis: AuftraggeberImportErgebnis = {
    gelesen: gesehen.size, neu: 0, aktualisiert: 0, ohneAdresse: 0,
    idNachNummer: new Map(), warnungen,
  };

  for (const [nummer, daten] of gesehen) {
    const r = await upsertAuftraggeberAusMigration(pool, { nummer, ...daten });
    r.neu ? ergebnis.neu++ : ergebnis.aktualisiert++;
    if (r.auftraggeber.adresseUnvollstaendig) ergebnis.ohneAdresse++;
    ergebnis.idNachNummer.set(nummer, r.auftraggeber.id);
  }
  return ergebnis;
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationAuftraggeber` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): Auftraggeber-Import mit Adress-Luecken-Report"
```

---

## Task 6: Projekt-Import

**Files:**
- Create: `src/migration/projekte.ts`, `test/migrationProjekte.test.ts`

**Interfaces:**
- Consumes: `ProjektGruppe`, `fmText`/`fmZahl`/`fmProjektNummer`/`fmBereich`, `findKontoByNummer`, `upsertProjektAusMigration`, `MigrationProjektInput`
- Produces:
  - `type ProjektImportErgebnis = { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number; csvSummen: { budgetChf: number; offenProv: number; abgerechnet: number }; warnungen: string[] }`
  - `importProjekte(pool, gruppen: ProjektGruppe[], idNachNummer: Map<string, string>): Promise<ProjektImportErgebnis>`
  - Regeln: unbekannte Kontonummer → `ertragskontoId`/`aufwandKontoId` bleibt `null` + Warnung (Befund B4); fehlender Auftraggeber-Mapping-Eintrag oder leerer Name → Projekt übersprungen + Warnung; `Jahr`-Spalte weicht von der Jahreszahl aus `Projekt_Nr.` ab → Warnung, Wert aus `Projekt_Nr.` gewinnt; `MWSt` beginnt mit `inkl` → `'inkl'`, sonst `'exkl'`. `csvSummen` summiert die CSV-Rohwerte der **importierten** Projekte für den Abgleich in Task 7.

- [ ] **Step 1: Failing test** — `test/migrationProjekte.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { csvRecords } from '../src/migration/csv';
import { gruppiereProjekte } from '../src/migration/gruppen';
import { importStammdaten } from '../src/migration/stammdaten';
import { importAuftraggeber } from '../src/migration/auftraggeber';
import { importProjekte } from '../src/migration/projekte';
import { listProjekte, projektSummen } from '../src/repos/projektRepo';
import { findKontoByNummer } from '../src/repos/kontoRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');
const gruppen = () => gruppiereProjekte(csvRecords(readFileSync(fixture, 'utf8')).records);

let idNachNummer: Map<string, string>;
beforeAll(async () => {
  await resetDb(getPool());
  await importStammdaten(getPool());
  idNachNummer = (await importAuftraggeber(getPool(), gruppen())).idNachNummer;
});
afterAll(async () => { await closePool(); });

describe('importProjekte', () => {
  it('importiert alle Projekte der Fixture', async () => {
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.gelesen).toBe(3);
    expect(r.neu).toBe(3);
    expect(r.uebersprungen).toBe(0);
    const p = await listProjekte(getPool(), { jahr: 2026 });
    expect(p.map((x) => x.nummer).sort()).toEqual(['1285.26', '4991.26', '6231.26']);
  });

  it('uebernimmt Felder und Kontierung', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '1285.26')!;
    expect(p.stammnummer).toBe(1285);
    expect(p.name).toBe('Connect KB (ehem.) WOB');
    expect(p.kuerzel).toBe('WOB');
    expect(p.bereich).toBe('IGK');            // erste Zeile des mehrzeiligen Felds
    expect(p.budgetChf).toBe(24600);
    expect(p.budgetTage).toBe(2.5);
    expect(p.ertragskontoId).toBe((await findKontoByNummer(getPool(), '3010'))!.id);
  });

  it('laesst unbekannte Kontonummern offen und warnt', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '4991.26')!;
    expect(p.ertragskontoId).toBeNull();      // 31001 ist nicht im Kontenplan (Befund B4)
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.warnungen.some((w) => w.includes('31001'))).toBe(true);
    expect(r.aktualisiert).toBe(3);
    expect(r.neu).toBe(0);
  });

  it('verwirft eine numerische Fehleingabe im Bereich', async () => {
    const p = (await listProjekte(getPool(), { jahr: 2026 })).find((x) => x.nummer === '4991.26')!;
    expect(p.bereich).toBeNull();             // Rohwert war "3204"
  });

  it('summiert die CSV-Werte und schreibt sie in die DB', async () => {
    const r = await importProjekte(getPool(), gruppen(), idNachNummer);
    expect(r.csvSummen.budgetChf).toBeCloseTo(35850, 2);       // 24600 + 11250 + 0
    expect(r.csvSummen.offenProv).toBeCloseTo(24600, 2);
    expect(r.csvSummen.abgerechnet).toBeCloseTo(18955, 2);     // 11250 + 7705
    const s = await projektSummen(getPool(), 2026);
    expect(s.anzahl).toBe(3);
    expect(s.budgetChf).toBeCloseTo(r.csvSummen.budgetChf, 2);
    expect(s.abgerechnet).toBeCloseTo(r.csvSummen.abgerechnet, 2);
  });

  it('ueberspringt Projekte ohne bekannten Auftraggeber', async () => {
    const g = gruppen();
    g.push({ projekt: { 'Projekt_Nr.': '9997.26', 'Projekt_Name': 'Waise', 'Auftraggeber_Nr.': '77777' }, kinder: [] });
    const r = await importProjekte(getPool(), g, idNachNummer);
    expect(r.uebersprungen).toBe(1);
    expect(r.warnungen.some((w) => w.includes('9997.26'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationProjekte` → FAIL.

- [ ] **Step 3: Implementieren** — `src/migration/projekte.ts`

```ts
import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import type { MigrationProjektInput } from '../domain/types';
import { fmText, fmZahl, fmProjektNummer, fmBereich } from './normalize';
import { findKontoByNummer } from '../repos/kontoRepo';
import { upsertProjektAusMigration } from '../repos/projektRepo';

export type ProjektImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; uebersprungen: number;
  csvSummen: { budgetChf: number; offenProv: number; abgerechnet: number };
  warnungen: string[];
};

export async function importProjekte(
  pool: pg.Pool,
  gruppen: ProjektGruppe[],
  idNachNummer: Map<string, string>,
): Promise<ProjektImportErgebnis> {
  const e: ProjektImportErgebnis = {
    gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0,
    csvSummen: { budgetChf: 0, offenProv: 0, abgerechnet: 0 }, warnungen: [],
  };
  // Kontonummer -> id (oder null fuer "nicht im Kontenplan"), einmal je Lauf aufgeloest
  const kontoCache = new Map<string, string | null>();
  const kontoId = async (nummer: string | null, projektNr: string, feld: string): Promise<string | null> => {
    if (nummer === null) return null;
    if (!kontoCache.has(nummer)) {
      const k = await findKontoByNummer(pool, nummer);
      kontoCache.set(nummer, k?.id ?? null);
    }
    const id = kontoCache.get(nummer)!;
    if (id === null) e.warnungen.push(`Projekt ${projektNr}: ${feld} "${nummer}" nicht im Kontenplan — Kontierung bleibt offen`);
    return id;
  };

  for (const g of gruppen) {
    const p = g.projekt;
    const projektNr = fmText(p['Projekt_Nr.']) ?? '(ohne Nr.)';
    const name = fmText(p['Projekt_Name']);
    const auftraggeberNr = fmText(p['Auftraggeber_Nr.']);
    const auftraggeberId = auftraggeberNr === null ? undefined : idNachNummer.get(auftraggeberNr);

    if (name === null) { e.uebersprungen++; e.warnungen.push(`Projekt ${projektNr}: ohne Projekt_Name uebersprungen`); continue; }
    if (!auftraggeberId) { e.uebersprungen++; e.warnungen.push(`Projekt ${projektNr}: Auftraggeber-Nr. "${auftraggeberNr}" nicht importiert — uebersprungen`); continue; }

    const { stammnummer, jahr } = fmProjektNummer(projektNr);
    const jahrSpalte = fmZahl(p['Jahr']);
    if (jahrSpalte !== null && jahrSpalte !== jahr) {
      e.warnungen.push(`Projekt ${projektNr}: Spalte Jahr=${jahrSpalte} weicht von der Nummer ab — ${jahr} verwendet`);
    }

    const budgetChf = fmZahl(p['Budget CHF']);
    const offenProv = fmZahl(p['offen_prov.']);
    const abgerechnet = fmZahl(p['abgerechnet']);

    const input: MigrationProjektInput = {
      stammnummer, jahr, name, auftraggeberId,
      kuerzel: fmText(p['Projekt_Kürzel']),
      bereich: fmBereich(p['Bereich']),
      beschrieb: fmText(p['Beschrieb']),
      ansprechperson: fmText(p['Ansprechperson']),
      ertragskontoId: await kontoId(fmText(p['Konto']), projektNr, 'Konto'),
      aufwandKontoId: await kontoId(fmText(p['Aufw. Konto']), projektNr, 'Aufw. Konto'),
      budgetChf, budgetTage: fmZahl(p['Budget Tage']),
      aufwandBudgetChf: fmZahl(p['Aufw. Budget CHF']),
      fmOffenProv: offenProv, fmAbgerechnet: abgerechnet,
      alteProjektNr: fmText(p['alte_Projekt_Nr']),
      projektleitungKuerzel: fmText(p['Referent intern']),
      mwstModus: (fmText(p['MWSt']) ?? '').toLowerCase().startsWith('inkl') ? 'inkl' : 'exkl',
      erstelltDurch: fmText(p['Erstellt durch']),
      geaendertDurch: fmText(p['geändert durch']),
    };

    const r = await upsertProjektAusMigration(pool, input);
    r.neu ? e.neu++ : e.aktualisiert++;
    e.csvSummen.budgetChf += budgetChf ?? 0;
    e.csvSummen.offenProv += offenProv ?? 0;
    e.csvSummen.abgerechnet += abgerechnet ?? 0;
  }

  e.csvSummen.budgetChf = Math.round(e.csvSummen.budgetChf * 100) / 100;
  e.csvSummen.offenProv = Math.round(e.csvSummen.offenProv * 100) / 100;
  e.csvSummen.abgerechnet = Math.round(e.csvSummen.abgerechnet * 100) / 100;
  return e;
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationProjekte` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(migration): Projekt-Import mit Kontierung und Datenpruefung"
```

---

## Task 7: CLI, Summenabgleich, Zählerstand

Bindet alles zusammen: Dry-Run als Default, Report als Markdown, Summenabgleich gegen die FileMaker-Zahlen, Zählerstand nur explizit.

**Files:**
- Create: `src/migration/report.ts`, `src/migration/run.ts`, `test/migrationReport.test.ts`, `test/migrationEchtdaten.test.ts`
- Modify: `package.json` (Script `migrate:fm`), `HANDOVER.md`

**Interfaces:**
- Consumes: alle Module aus Task 1–6, `setzeRechnungZaehler`, `projektSummen`
- Produces:
  - `type SummenVergleich = { csv: number; db: number | null; differenz: number | null; ok: boolean }`
  - `type ImportReport = { quelle: string; modus: 'dry-run' | 'apply'; jahr: number | null; auftraggeber: { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number }; projekte: { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number }; konten: { angelegt: number; vorhanden: number }; mwstSaetze: { angelegt: number; vorhanden: number }; zaehler: { gesetztAuf: number | null; hinweis: string | null }; summen: { budgetChf: SummenVergleich; offenProv: SummenVergleich; abgerechnet: SummenVergleich }; warnungen: string[] }`
  - `vergleiche(csv: number, db: number | null): SummenVergleich` — `ok` bei Differenz ≤ 0.01; `db === null` (Dry-Run) → `ok: true`, `differenz: null`
  - `formatReport(r: ImportReport): string` — Markdown
  - `fuehreMigrationAus(pool, opts: { projekteCsv: string; modus: 'dry-run' | 'apply'; rechnungMax?: number }): Promise<ImportReport>`
  - CLI `npm run migrate:fm -- --projekte=<pfad> [--apply] [--rechnung-max=<n>]`; ohne `--rechnung-max` bleibt der Zähler unangetastet und der Report enthält den Hinweis aus Befund B2. Exit-Code 1, wenn ein Summenvergleich `ok: false` ist.

- [ ] **Step 1: Failing test** — `test/migrationReport.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { vergleiche, formatReport } from '../src/migration/report';
import { fuehreMigrationAus } from '../src/migration/run';
import { getZaehler } from '../src/repos/zaehlerRepo';
import { listProjekte } from '../src/repos/projektRepo';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/projekte_mini.csv');

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('vergleiche', () => {
  it('toleriert einen Rappen Rundungsdifferenz', () => {
    expect(vergleiche(4435265, 4435265).ok).toBe(true);
    expect(vergleiche(100.0, 100.01).ok).toBe(true);
    expect(vergleiche(100.0, 100.05).ok).toBe(false);
    expect(vergleiche(100.0, null)).toEqual({ csv: 100.0, db: null, differenz: null, ok: true });
  });
});

describe('fuehreMigrationAus', () => {
  it('schreibt im Dry-Run nichts in die DB', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'dry-run' });
    expect(r.modus).toBe('dry-run');
    expect(r.projekte.gelesen).toBe(3);
    expect(await listProjekte(getPool(), { jahr: 2026 })).toHaveLength(0);
    expect(r.zaehler.gesetztAuf).toBeNull();
    expect(r.zaehler.hinweis).toContain('rechnung-max');
  });

  it('importiert im Apply-Modus und belegt die Summen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'apply' });
    expect(r.projekte.neu).toBe(3);
    expect(r.auftraggeber.neu).toBe(3);
    expect(r.auftraggeber.ohneAdresse).toBe(3);
    expect(r.konten.angelegt).toBeGreaterThan(0);
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.budgetChf.db).toBeCloseTo(r.summen.budgetChf.csv, 2);
    expect(r.summen.abgerechnet.ok).toBe(true);
    expect(await listProjekte(getPool(), { jahr: 2026 })).toHaveLength(3);
  });

  it('setzt den Zaehler nur mit explizitem Wert', async () => {
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(0);
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'apply', rechnungMax: 33214 });
    expect(r.zaehler.gesetztAuf).toBe(33214);
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  });

  it('formatiert einen lesbaren Markdown-Report', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: fixture, modus: 'dry-run' });
    const md = formatReport(r);
    expect(md).toContain('# Migrations-Report');
    expect(md).toContain('Projekte');
    expect(md).toContain('ohne Adresse');
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- migrationReport` → FAIL.

- [ ] **Step 3: Implementieren**

`src/migration/report.ts`:
```ts
export type SummenVergleich = { csv: number; db: number | null; differenz: number | null; ok: boolean };

export type ImportReport = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  jahr: number | null;
  auftraggeber: { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number };
  projekte: { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number };
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
  zaehler: { gesetztAuf: number | null; hinweis: string | null };
  summen: { budgetChf: SummenVergleich; offenProv: SummenVergleich; abgerechnet: SummenVergleich };
  warnungen: string[];
};

export function vergleiche(csv: number, db: number | null): SummenVergleich {
  if (db === null) return { csv, db: null, differenz: null, ok: true };
  const differenz = Math.round((db - csv) * 100) / 100;
  return { csv, db, differenz, ok: Math.abs(differenz) <= 0.01 };
}

const chf = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatReport(r: ImportReport): string {
  const zeile = (name: string, v: SummenVergleich) =>
    `| ${name} | ${chf(v.csv)} | ${chf(v.db)} | ${v.differenz === null ? '—' : chf(v.differenz)} | ${v.ok ? 'ok' : '**ABWEICHUNG**'} |`;
  return [
    `# Migrations-Report`,
    ``,
    `**Quelle:** \`${r.quelle}\` · **Modus:** ${r.modus}${r.jahr === null ? '' : ` · **Jahr:** ${r.jahr}`}`,
    ``,
    `## Uebernommene Datensaetze`,
    ``,
    `| Bereich | gelesen | neu | aktualisiert | Hinweis |`,
    `|---|---:|---:|---:|---|`,
    `| Auftraggeber | ${r.auftraggeber.gelesen} | ${r.auftraggeber.neu} | ${r.auftraggeber.aktualisiert} | ${r.auftraggeber.ohneAdresse} ohne Adresse |`,
    `| Projekte | ${r.projekte.gelesen} | ${r.projekte.neu} | ${r.projekte.aktualisiert} | ${r.projekte.uebersprungen} uebersprungen |`,
    `| Konten | ${r.konten.angelegt + r.konten.vorhanden} | ${r.konten.angelegt} | ${r.konten.vorhanden} | Kontenplan |`,
    `| MWSt-Saetze | ${r.mwstSaetze.angelegt + r.mwstSaetze.vorhanden} | ${r.mwstSaetze.angelegt} | ${r.mwstSaetze.vorhanden} | Satzhistorie |`,
    ``,
    `## Summenabgleich gegen FileMaker`,
    ``,
    `| Kennzahl | CSV | Datenbank | Differenz | Status |`,
    `|---|---:|---:|---:|---|`,
    zeile('Budget CHF', r.summen.budgetChf),
    zeile('offen_prov.', r.summen.offenProv),
    zeile('abgerechnet', r.summen.abgerechnet),
    ``,
    `## Rechnungszaehler`,
    ``,
    r.zaehler.gesetztAuf === null
      ? `Nicht gesetzt. ${r.zaehler.hinweis ?? ''}`.trim()
      : `Gesetzt auf **${r.zaehler.gesetztAuf}**.`,
    ``,
    `## Warnungen (${r.warnungen.length})`,
    ``,
    ...(r.warnungen.length === 0 ? ['Keine.'] : r.warnungen.map((w) => `- ${w}`)),
    ``,
  ].join('\n');
}
```

`src/migration/run.ts`:
```ts
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { csvRecords } from './csv';
import { gruppiereProjekte } from './gruppen';
import { importStammdaten } from './stammdaten';
import { importAuftraggeber } from './auftraggeber';
import { importProjekte } from './projekte';
import { vergleiche, formatReport, type ImportReport } from './report';
import { fmProjektNummer, fmText } from './normalize';
import { projektSummen } from '../repos/projektRepo';
import { setzeRechnungZaehler } from '../repos/zaehlerRepo';

const ZAEHLER_HINWEIS =
  'Kein --rechnung-max uebergeben. Der Faktura-Export ist veraltet (hoechste Nr. 31491 vom 26.06.2025), ' +
  'der Livebeleg vom Juli 2026 traegt bereits Nr. 33214. Den aktuellen Hoechststand in FileMaker ablesen ' +
  'und explizit uebergeben, sonst werden Rechnungsnummern doppelt vergeben.';

export async function fuehreMigrationAus(pool: pg.Pool, opts: {
  projekteCsv: string; modus: 'dry-run' | 'apply'; rechnungMax?: number;
}): Promise<ImportReport> {
  const { records } = csvRecords(readFileSync(opts.projekteCsv, 'utf8'));
  const gruppen = gruppiereProjekte(records);

  // Jahr aus der ersten Projektnummer — der Export ist jahresweise (Befund B1).
  const ersteNr = fmText(gruppen[0]?.projekt['Projekt_Nr.']);
  const jahr = ersteNr === null ? null : fmProjektNummer(ersteNr).jahr;

  if (opts.modus === 'dry-run') {
    // Kein Schreibzugriff: nur zaehlen, was der Export enthaelt.
    const nummern = new Set(gruppen.map((g) => fmText(g.projekt['Auftraggeber_Nr.'])).filter((n): n is string => n !== null));
    const summe = (spalte: string) => Math.round(gruppen.reduce((s, g) => s + (Number(String(g.projekt[spalte] ?? '').replace(/['’\s]/g, '')) || 0), 0) * 100) / 100;
    return {
      quelle: opts.projekteCsv, modus: 'dry-run', jahr,
      auftraggeber: { gelesen: nummern.size, neu: 0, aktualisiert: 0, ohneAdresse: nummern.size },
      projekte: { gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0 },
      konten: { angelegt: 0, vorhanden: 0 },
      mwstSaetze: { angelegt: 0, vorhanden: 0 },
      zaehler: { gesetztAuf: null, hinweis: opts.rechnungMax === undefined ? ZAEHLER_HINWEIS : 'Dry-Run: Zaehler nicht veraendert.' },
      summen: {
        budgetChf: vergleiche(summe('Budget CHF'), null),
        offenProv: vergleiche(summe('offen_prov.'), null),
        abgerechnet: vergleiche(summe('abgerechnet'), null),
      },
      warnungen: [],
    };
  }

  const stamm = await importStammdaten(pool);
  const ag = await importAuftraggeber(pool, gruppen);
  const pr = await importProjekte(pool, gruppen, ag.idNachNummer);
  const db = jahr === null ? null : await projektSummen(pool, jahr);

  let gesetztAuf: number | null = null;
  let hinweis: string | null = ZAEHLER_HINWEIS;
  if (opts.rechnungMax !== undefined) {
    gesetztAuf = await setzeRechnungZaehler(pool, opts.rechnungMax);
    hinweis = null;
  }

  return {
    quelle: opts.projekteCsv, modus: 'apply', jahr,
    auftraggeber: { gelesen: ag.gelesen, neu: ag.neu, aktualisiert: ag.aktualisiert, ohneAdresse: ag.ohneAdresse },
    projekte: { gelesen: pr.gelesen, neu: pr.neu, aktualisiert: pr.aktualisiert, uebersprungen: pr.uebersprungen },
    konten: stamm.konten, mwstSaetze: stamm.mwstSaetze,
    zaehler: { gesetztAuf, hinweis },
    summen: {
      budgetChf: vergleiche(pr.csvSummen.budgetChf, db?.budgetChf ?? null),
      offenProv: vergleiche(pr.csvSummen.offenProv, db?.offenProv ?? null),
      abgerechnet: vergleiche(pr.csvSummen.abgerechnet, db?.abgerechnet ?? null),
    },
    warnungen: [...ag.warnungen, ...pr.warnungen],
  };
}

// CLI: npm run migrate:fm -- --projekte=../fm-discovery/export/export_daten.csv [--apply] [--rechnung-max=33214]
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const arg = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const projekteCsv = arg('projekte');
  if (!projekteCsv) {
    console.error('Aufruf: npm run migrate:fm -- --projekte=<pfad.csv> [--apply] [--rechnung-max=<n>]');
    process.exit(2);
  }
  const rechnungMaxArg = arg('rechnung-max');
  const { getPool, closePool } = await import('../db/pool');
  const { runMigrations } = await import('../db/migrate');
  const pool = getPool();
  await runMigrations(pool);
  const report = await fuehreMigrationAus(pool, {
    projekteCsv,
    modus: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    rechnungMax: rechnungMaxArg === undefined ? undefined : Number(rechnungMaxArg),
  });
  console.log(formatReport(report));
  await closePool();
  const abweichung = Object.values(report.summen).some((s) => !s.ok);
  process.exit(abweichung ? 1 : 0);
}
```

`package.json` — Script ergänzen:
```json
    "migrate:fm": "tsx src/migration/run.ts",
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- migrationReport` → PASS.

- [ ] **Step 5: Echtdaten-Test ergänzen** — `test/migrationEchtdaten.test.ts` (überspringt sich, wenn der Export nicht lokal liegt)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { fuehreMigrationAus } from '../src/migration/run';

// Liegt ausserhalb des Repos (Personen-/Bankdaten werden nicht eingecheckt).
const echt = join(dirname(fileURLToPath(import.meta.url)), '../../fm-discovery/export/export_daten.csv');
const vorhanden = existsSync(echt);

beforeAll(async () => { if (vorhanden) await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe.skipIf(!vorhanden)('Migration gegen den echten Projekt-Export', () => {
  it('importiert 151 Projekte und 49 Auftraggeber mit passenden Summen', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.jahr).toBe(2026);
    expect(r.projekte.gelesen).toBe(151);
    expect(r.projekte.neu).toBe(151);
    expect(r.projekte.uebersprungen).toBe(0);
    expect(r.auftraggeber.gelesen).toBe(49);

    // Sollwerte aus dem FileMaker-Export (Befund B1)
    expect(r.summen.budgetChf.csv).toBeCloseTo(4435265.0, 2);
    expect(r.summen.offenProv.csv).toBeCloseTo(2048973.45, 2);
    expect(r.summen.abgerechnet.csv).toBeCloseTo(2401554.55, 2);

    // Datenbank stimmt mit der CSV ueberein
    expect(r.summen.budgetChf.ok).toBe(true);
    expect(r.summen.offenProv.ok).toBe(true);
    expect(r.summen.abgerechnet.ok).toBe(true);

    // Bekannte, erwartete Datenluecken (Befunde B3/B4)
    expect(r.auftraggeber.ohneAdresse).toBe(49);
    expect(r.warnungen.filter((w) => w.includes('nicht im Kontenplan')).length).toBeGreaterThan(0);
  });

  it('ist beim zweiten Lauf idempotent', async () => {
    const r = await fuehreMigrationAus(getPool(), { projekteCsv: echt, modus: 'apply' });
    expect(r.projekte.neu).toBe(0);
    expect(r.projekte.aktualisiert).toBe(151);
    expect(r.auftraggeber.neu).toBe(0);
  });
});
```

Run: `npm test -- migrationEchtdaten` → PASS (oder „skipped", falls der Export nicht lokal liegt).

- [ ] **Step 6: HANDOVER.md nachführen** — im Abschnitt „Fortschritt" ergänzen:

```markdown
- **Plan 5 Migration** ✅ — CSV-Parser, FM-Normalisierung, Parent/Child-Gruppierung, Stammdaten (Kontenplan + MWSt-Satzhistorie), Auftraggeber (ohne Adresse, markiert), Projekte (151/2026), Summenabgleich, Zaehler nur explizit. CLI: `npm run migrate:fm -- --projekte=<pfad> [--apply] [--rechnung-max=<n>]`.
```

und unter „Offene Punkte / To-verify":

```markdown
- **Adressen-Export fehlt:** Auftraggeber sind mit `adresse_unvollstaendig=true` importiert; ohne Adresse ist fuer sie keine QR-Rechnung moeglich. Separater Adressen-/Banken-Export aus FileMaker noetig.
- **Rechnungszaehler:** Faktura-Export endet bei Nr. 31491 (26.06.2025), Livebeleg Juli 2026 hat 33214. Zaehler erst nach Ablesen des echten Hoechststands via `--rechnung-max` setzen.
- **Kontenplan-Bezeichnungen** in `src/migration/stammdaten.ts` sind abgeleitet, nicht bestaetigt. Fuenfstellige Konten (31001/31021/32001/32041) sind ungeklaert — betroffene Projekte haben keine Kontierung.
- **Projekt-Export deckt nur Jahr 2026 ab** (151 von ~4967). Vollexport aller Jahrgaenge nachziehen und erneut laufen lassen (idempotent).
```

- [ ] **Step 7: Alles gruen + Commit**

Run: `npm test` (alle Suiten) → PASS; `npx tsc --noEmit` → sauber.

```bash
git add -A && git commit -m "feat(migration): CLI, Summenabgleich und Zaehlerstand-Gate"
```

---

## Self-Review (gegen Spec §7)

**Spec-Abdeckung:**
- „`auftraggeber` (aus Projekte-Auftraggeber, dedupliziert über Nummer)" → Task 5 ✓ (mit dokumentierter Adress-Lücke, Befund B3)
- „`konto`, `mwst_satz` (Stammdaten anlegen)" → Task 4 ✓
- „`projekt` (~4967), inkl. `fortsetzung_von` über alte Nr." → Task 6 ✓ **mit Einschränkung**: der vorliegende Export enthält nur die 151 Projekte des Jahrgangs 2026. `alte_projekt_nr` wird gespeichert; die FK `fortsetzung_von_id` bleibt bewusst leer, weil der Jahresverlauf laut Spec §5.1 über die **Stammnummer** abgeleitet wird und der Sonderfall-Link erst bei mehrjährigem Bestand auflösbar ist. Beides ist in „Offene Punkte" vermerkt.
- „Offene Rechnungen/Salden als Anfangsbestand Debitoren" + „historische Rechnungen als abgeschlossen importieren" → **nicht in diesem Plan.** Begründung: Der Faktura-Export ist unvollständig (Befund B2: endet 06/2025, kein Jahrgang 2026) und enthält keinen Zahlungsstatus. Ein Debitoren-Anfangsbestand daraus wäre falsch. Die FM-Stände sind als `fm_offen_prov`/`fm_abgerechnet` je Projekt mitgeführt, damit der spätere Rechnungsimport dagegen abgeglichen werden kann. Folgeplan „5b Rechnungs-/OP-Übernahme" nach einem vollständigen Faktura-Export.
- „Validierung: Summen gegen FileMaker-Report abgleichen" → Task 7 ✓ (Report + Exit-Code, Echtdaten-Test mit den drei Sollsummen)
- Handover-Punkt „Zähler-Startwert setzen" → Task 3 (`setzeRechnungZaehler`, nur aufsteigend) + Task 7 (nur mit `--rechnung-max`) ✓

**Platzhalter:** keine — jeder Step enthält den auszuführenden Code bzw. Befehl.

**Typ-Konsistenz:** `MigrationProjektInput` in Task 3 definiert, in Task 6 identisch verwendet. `ProjektGruppe` (Task 2) ist der Eingabetyp von `importAuftraggeber` und `importProjekte`. `idNachNummer: Map<string, string>` wird in Task 5 erzeugt und in Task 6 konsumiert. `SummenVergleich`/`ImportReport` (Task 7) nur dort. Funktionsnamen `fmText/fmZahl/fmDatum/fmProjektNummer/fmName/fmBereich` durchgehend gleich geschrieben.

## Offene Punkte

- **Adressen** (Befund B3): blockiert QR-Rechnungen für migrierte Auftraggeber. Separater FileMaker-Export nötig; danach ein kleiner Nachtrags-Import, der `adresse_unvollstaendig` auf `false` setzt.
- **Rechnungszähler** (Befund B2): Höchststand muss aus dem Livesystem abgelesen werden. Bis dahin darf in der migrierten Datenbank **keine** Rechnung festgeschrieben werden.
- **Kontenplan-Bezeichnungen** sind abgeleitet, nicht bestätigt; fünfstellige Konten ungeklärt (Befund B4).
- **Vollexport aller Jahrgänge** (~4967 Projekte statt 151) nachziehen — der Import ist idempotent und kann erneut laufen.
- **Mitarbeitende/Referenten** sind in v1 nur als Kürzel-Text am Projekt (`projektleitung_kuerzel`) mitgeführt; die Tabellen `mitarbeitende`/`referent` aus Spec §4.8/§4.9 existieren noch nicht und kommen mit der Auth-Verdrahtung in Plan 6.

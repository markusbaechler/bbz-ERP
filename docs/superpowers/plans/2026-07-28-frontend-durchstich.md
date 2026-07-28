# Frontend-Durchstich Projekte & Verrechnung — Implementation Plan (Plan 6, erster Schnitt)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine klickbare Kette Projektliste → Projektdetail → Rechnung erfassen → festschreiben → QR-PDF, lokal, auf den echten migrierten Daten.

**Architecture:** Der bestehende Fastify-Server liefert `public/` als statische Dateien aus — ein Ursprung, ein Prozess. Das Frontend besteht aus Vanilla-ES-Modulen ohne Build: ein Hash-Router, ein `fetch`-Wrapper und je ein Modul pro Screen, dazu reine Hilfsmodule für Formatierung und MWSt-Rechnung. Die MWSt-Logik im Browser wird gegen die Server-Implementierung getestet, damit Anzeige und Festschreibung nie auseinanderlaufen. Drei fehlende Lesendpunkte werden im Backend nachgezogen.

**Tech Stack:** TypeScript/Fastify/PostgreSQL/vitest wie bisher, plus `@fastify/static` 7.x (Fastify 4). Frontend: reines ES2022-JavaScript, keine Bibliothek, kein Bundler.

Spec: `docs/superpowers/specs/2026-07-28-frontend-durchstich-design.md`

## Global Constraints

- **TDD, bite-sized:** Test → rot → Implementierung → grün → Commit. Ein Commit je Task.
- **Aller DB-Zugriff nur über `src/repos/*`.** Routen und Frontend enthalten kein SQL.
- **Genau eine neue Abhängigkeit:** `@fastify/static` (^7.0.4). Statisches Ausliefern von Hand zu schreiben hiesse Pfad-Traversierungsschutz und MIME-Typen selbst zu bauen — das gehört nicht handgeschrieben. Sonst **keine** weitere Abhängigkeit, insbesondere keine Frontend-Bibliothek und kein Bundler.
- **Kein Build-Schritt.** `public/` wird unverändert ausgeliefert. Dateien dort sind `.js`, nicht TypeScript, und liegen ausserhalb von `tsconfig.json` — `npx tsc --noEmit` deckt sie nicht ab. Ihre Absicherung sind die Unit-Tests aus Task 3.
- **Beträge:** Rappenrundung auf 0.05 über `rappenRunden`. Die Browser-Rechnung muss dieselben Werte liefern wie `src/domain/mwst.ts` — Task 3 prüft das.
- **Schweizer Formate:** `4'435'265.00`, `27.07.2026`, `8.1 %`.
- **Rot ist reserviert** für Storno und negative Beträge. Es ist keine allgemeine Warnfarbe.
- **Rollen-Header:** `x-user-role: admin` wird an **genau einer Stelle** gesetzt (`public/api.js`), mit Kommentar, dass Entra-ID das ablöst.
- Deutsch in Code, Kommentaren und Oberfläche, **„ss" statt „ß"**. Commit-Trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Barrierefreiheit als Untergrenze, ohne Aufhebens: sichtbarer Tastaturfokus, Beschriftungen an allen Feldern, `prefers-reduced-motion` respektiert.

---

## Designsystem (verbindlich für alle Screens)

Die Gestaltung leitet sich vom **Schweizer QR-Zahlteil** ab — dem Artefakt, das diese Anwendung erzeugt.

**Eckmarken als Signatur.** Der Zahlteil markiert auszufüllende Felder mit kleinen Winkeln. Genau so werden hier **Eingabefelder** markiert — und nur sie. Lesetabellen bekommen keine. Der Winkel heisst „hier trägst du etwas ein".

**Bezeichner sind Codes.** Projektnummer, Rechnungsnummer, QR-Referenz, Kontonummer stehen in der Monospace, weil sie Codes sind. Die **Projektnummer ist der Seitentitel** — gross, in Monospace, der Projektname darunter. Das bildet ab, wie im Betrieb gesprochen wird („6231.26"), statt der üblichen Hierarchie zu folgen.

**Beträge** stehen rechtsbündig in Tabellenziffern (`font-variant-numeric: tabular-nums`), damit Kolonnen vergleichbar sind.

```css
:root {
  --papier:     #FAFAF8;  /* Grundflaeche */
  --tinte:      #14181D;  /* Text, blauschwarz */
  --tinte-matt: #5A6470;  /* Sekundaertext */
  --linie:      #D9DCE0;  /* Trennlinien */
  --marke:      #1F4E79;  /* einzige Akzentfarbe: Fokus, Primaeraktion */
  --offen:      #8A5A00;  /* Status abgerechnet/offen (Ocker) */
  --bezahlt:    #1E6B4F;  /* Status bezahlt */
  --storno:     #9B2226;  /* Storno UND negative Betraege — sonst nie */

  --schrift:    -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --code:       "Cascadia Mono", Consolas, ui-monospace, monospace;
}
```

Statuszuordnung: `offen_prov` → `--tinte-matt`, `def_vereinbart` → `--marke`, `abgerechnet` → `--offen`, `bezahlt` → `--bezahlt`, `storniert` → `--storno` mit Durchstreichung.

---

## Dateistruktur

```
package.json                          # +@fastify/static, +Script "test:browser"   (Modify)
src/domain/types.ts                   # +ProjektListenZeile, +ProjektDetail, +RechnungListenZeile (Modify)
src/repos/projektRepo.ts              # +listProjekteMitAuftraggeber, +getProjektDetail, +listRechnungenFuerProjekt (Modify)
src/server/routes/projekt.ts          # erweiterte GETs + neue Rechnungsliste             (Modify)
src/server/app.ts                     # statische Auslieferung registrieren              (Modify)
public/index.html                     # Grundgeruest
public/stil.css                       # Designsystem
public/app.js                         # Hash-Router, Fehlerbanner, Sperrstreifen
public/api.js                         # fetch-Wrapper, Fehlermapping, Rollen-Header
public/ui/format.js                   # franken, datum, prozent, menge (de-CH)
public/ui/mwst.js                     # rappenRunden, berechneMwst (Spiegel des Servers)
public/ui/tabelle.js                  # dichte Tabelle mit Sortierung
public/ui/zustand.js                  # laedt / leer / Fehler
public/screens/projekte.js            # Liste
public/screens/projekt.js             # Detail + Rechnungen + Adress-Nachtrag
public/screens/rechnung.js            # Erfassung, Positionen, Summen, Festschreibung
public/screens/system.js              # Zaehlerstand
test/projektLeseRouten.test.ts        # Task 1
test/statischeAuslieferung.test.ts    # Task 2
test/browserFormat.test.ts            # Task 3
test/browserMwst.test.ts              # Task 3 — Abgleich Browser gegen Server
```

---

## Task 1: Lese-Endpunkte für die Oberfläche

Beim Entwurf sind drei Lücken aufgefallen: es gibt keinen Weg an die Rechnungen eines Projekts, die Projektliste liefert nur `auftraggeberId` statt des Namens, und `GET /projekt/:id` gibt nur den schmalen `Projekt`-Typ zurück — ohne Ansprechperson, Beschrieb, Aufwandsdaten und ohne die FileMaker-Stände, die die Liste anzeigen soll.

**Files:**
- Modify: `src/domain/types.ts`, `src/repos/projektRepo.ts`, `src/server/routes/projekt.ts`
- Create: `test/projektLeseRouten.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`, `createAuftraggeber`, `upsertProjektAusMigration`, `createRechnung`, `addPosition`, `festschreiben`, `setzeRechnungZaehler`, `NotFoundError`
- Produces:
  - `type ProjektListenZeile = { id: string; nummer: string; jahr: number; name: string; bereich: string | null; auftraggeberId: string; auftraggeberName: string; budgetChf: number | null; fmAbgerechnet: number | null; fmOffenProv: number | null }`
  - `type ProjektDetail = Projekt & { auftraggeberName: string; auftraggeberZusatz: string | null; auftraggeberStrasse: string; auftraggeberPlz: string; auftraggeberOrt: string; auftraggeberLand: string; auftraggeberAdresseUnvollstaendig: boolean; ansprechperson: string | null; beschrieb: string | null; projektleitungKuerzel: string | null; alteProjektNr: string | null; aufwandBudgetChf: number | null; ertragskontoNummer: string | null; ertragskontoBezeichnung: string | null; aufwandKontoNummer: string | null; fmAbgerechnet: number | null; fmOffenProv: number | null }`
  - `type RechnungListenZeile = { id: string; nummer: string | null; datum: string; status: RechnungStatus; totalBrutto: number }`
  - `listProjekteMitAuftraggeber(pool, filter?: { jahr?: number }): Promise<ProjektListenZeile[]>` — sortiert nach `nummer`
  - `getProjektDetail(pool, id): Promise<ProjektDetail>` — wirft `NotFoundError`
  - `listRechnungenFuerProjekt(pool, projektId): Promise<RechnungListenZeile[]>` — absteigend nach `datum`, dann `erstellt_am`
  - Routen: `GET /projekt` (liefert jetzt `ProjektListenZeile[]`), `GET /projekt/:id` (liefert `ProjektDetail`), `GET /projekt/:id/rechnungen`

- [ ] **Step 1: Failing test** — `test/projektLeseRouten.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { upsertProjektAusMigration } from '../src/repos/projektRepo';
import { createKonto } from '../src/repos/kontoRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { setzeRechnungZaehler } from '../src/repos/zaehlerRepo';
import type { MigrationProjektInput } from '../src/domain/types';

const app = buildApp(getPool());
let auftraggeberId: string; let projektId: string; let kontoId: string;

beforeAll(async () => {
  await resetDb(getPool());
  await setzeRechnungZaehler(getPool(), 33214, 'test');
  auftraggeberId = (await createAuftraggeber(getPool(), {
    nummer: '1069', name: 'Urner Kantonalbank', strasse: 'Postfach', plz: '6460', ort: 'Altdorf',
  })).id;
  kontoId = (await createKonto(getPool(), { nummer: '3101', bezeichnung: 'Grundbildung', typ: 'Ertrag' })).id;

  const basis: MigrationProjektInput = {
    stammnummer: 5934, jahr: 2026, name: 'Lehrgang Bankfachgrundbildung', auftraggeberId,
    kuerzel: 'BFG', bereich: 'Banking', beschrieb: 'Grundbildung ZUNO', ansprechperson: 'Peter Muster',
    ertragskontoId: kontoId, aufwandKontoId: null, budgetChf: 24600, budgetTage: 12,
    aufwandBudgetChf: 3000, fmOffenProv: 10000, fmAbgerechnet: 14600,
    alteProjektNr: '5934.25', projektleitungKuerzel: 'ml', mwstModus: 'exkl',
    erstelltDurch: 'p.meier', geaendertDurch: 'm.lippuner',
  };
  projektId = (await upsertProjektAusMigration(getPool(), basis)).projekt.id;
  await upsertProjektAusMigration(getPool(), { ...basis, stammnummer: 1285, name: 'Connect KB', budgetChf: 1000, fmAbgerechnet: null, fmOffenProv: null });
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('GET /projekt (Liste)', () => {
  it('liefert den Auftraggeber-Namen und die FileMaker-Staende mit', async () => {
    const r = await app.inject({ method: 'GET', url: '/projekt?jahr=2026' });
    expect(r.statusCode).toBe(200);
    const zeilen = r.json();
    expect(zeilen).toHaveLength(2);
    const p = zeilen.find((z: any) => z.nummer === '5934.26');
    expect(p.auftraggeberName).toBe('Urner Kantonalbank');
    expect(p.budgetChf).toBe(24600);
    expect(p.fmAbgerechnet).toBe(14600);
    expect(p.fmOffenProv).toBe(10000);
    expect(p.bereich).toBe('Banking');
  });

  it('sortiert nach Nummer und behaelt null-Staende als null', async () => {
    const zeilen = (await app.inject({ method: 'GET', url: '/projekt' })).json();
    expect(zeilen.map((z: any) => z.nummer)).toEqual(['1285.26', '5934.26']);
    expect(zeilen[0].fmAbgerechnet).toBeNull();
  });
});

describe('GET /projekt/:id (Detail)', () => {
  it('liefert Auftraggeber-Adresse, Kontierung und Freitexte', async () => {
    const d = (await app.inject({ method: 'GET', url: `/projekt/${projektId}` })).json();
    expect(d.nummer).toBe('5934.26');
    expect(d.auftraggeberName).toBe('Urner Kantonalbank');
    expect(d.auftraggeberStrasse).toBe('Postfach');
    expect(d.auftraggeberPlz).toBe('6460');
    expect(d.auftraggeberOrt).toBe('Altdorf');
    expect(d.auftraggeberAdresseUnvollstaendig).toBe(false);
    expect(d.ansprechperson).toBe('Peter Muster');
    expect(d.beschrieb).toBe('Grundbildung ZUNO');
    expect(d.projektleitungKuerzel).toBe('ml');
    expect(d.alteProjektNr).toBe('5934.25');
    expect(d.aufwandBudgetChf).toBe(3000);
    expect(d.ertragskontoNummer).toBe('3101');
    expect(d.ertragskontoBezeichnung).toBe('Grundbildung');
    expect(d.aufwandKontoNummer).toBeNull();
  });

  it('antwortet 404 fuer eine unbekannte Id', async () => {
    const r = await app.inject({ method: 'GET', url: '/projekt/00000000-0000-0000-0000-000000000000' });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /projekt/:id/rechnungen', () => {
  it('liefert leere Liste, wenn das Projekt keine Rechnungen hat', async () => {
    const r = await app.inject({ method: 'GET', url: `/projekt/${projektId}/rechnungen` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it('liefert Nummer, Datum, Status und Bruttototal, neueste zuerst', async () => {
    const alt = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-03-01', mwstModus: 'exkl' });
    await addPosition(getPool(), alt.id, { beschreibung: 'Vorbereitung', menge: 1, einzelpreis: 500, mwstSatz: 8.1 });
    await festschreiben(getPool(), alt.id, 'ml');
    const neu = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-27', mwstModus: 'exkl' });
    await addPosition(getPool(), neu.id, { beschreibung: 'Kurstage', menge: 2, einzelpreis: 1000, mwstSatz: 8.1 });

    const zeilen = (await app.inject({ method: 'GET', url: `/projekt/${projektId}/rechnungen` })).json();
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0].datum).toBe('2026-07-27');
    expect(zeilen[0].status).toBe('offen_prov');
    expect(zeilen[0].nummer).toBeNull();
    expect(zeilen[0].totalBrutto).toBe(2162);
    expect(zeilen[1].status).toBe('abgerechnet');
    expect(zeilen[1].nummer).toBe('5934.26 - 33215 ml');
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- projektLeseRouten` → FAIL (`auftraggeberName` undefined).

- [ ] **Step 3: Implementieren**

`src/domain/types.ts` anfügen:
```ts
export type ProjektListenZeile = {
  id: string; nummer: string; jahr: number; name: string; bereich: string | null;
  auftraggeberId: string; auftraggeberName: string;
  budgetChf: number | null; fmAbgerechnet: number | null; fmOffenProv: number | null;
};

export type ProjektDetail = Projekt & {
  auftraggeberName: string; auftraggeberZusatz: string | null;
  auftraggeberStrasse: string; auftraggeberPlz: string; auftraggeberOrt: string; auftraggeberLand: string;
  auftraggeberAdresseUnvollstaendig: boolean;
  ansprechperson: string | null; beschrieb: string | null; projektleitungKuerzel: string | null;
  alteProjektNr: string | null; aufwandBudgetChf: number | null;
  ertragskontoNummer: string | null; ertragskontoBezeichnung: string | null; aufwandKontoNummer: string | null;
  fmAbgerechnet: number | null; fmOffenProv: number | null;
};

export type RechnungListenZeile = {
  id: string; nummer: string | null; datum: string; status: RechnungStatus; totalBrutto: number;
};
```

`src/repos/projektRepo.ts` anfügen (`map` unverändert lassen — der schmale `Projekt`-Typ bleibt für die bestehenden Aufrufer):
```ts
import type { ProjektListenZeile, ProjektDetail, RechnungListenZeile } from '../domain/types';

const zahl = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function listProjekteMitAuftraggeber(
  pool: pg.Pool, filter: { jahr?: number } = {},
): Promise<ProjektListenZeile[]> {
  const args: any[] = [];
  let where = '';
  if (filter.jahr !== undefined) { args.push(filter.jahr); where = `where p.jahr=$${args.length}`; }
  const r = await pool.query(
    `select p.id, p.nummer, p.jahr, p.name, p.bereich, p.auftraggeber_id, a.name as auftraggeber_name,
            p.budget_chf, p.fm_abgerechnet, p.fm_offen_prov
     from projekt p join auftraggeber a on a.id = p.auftraggeber_id
     ${where} order by p.nummer`, args);
  return r.rows.map((x) => ({
    id: x.id, nummer: x.nummer, jahr: x.jahr, name: x.name, bereich: x.bereich,
    auftraggeberId: x.auftraggeber_id, auftraggeberName: x.auftraggeber_name,
    budgetChf: zahl(x.budget_chf), fmAbgerechnet: zahl(x.fm_abgerechnet), fmOffenProv: zahl(x.fm_offen_prov),
  }));
}

export async function getProjektDetail(pool: pg.Pool, id: string): Promise<ProjektDetail> {
  const r = await pool.query(
    `select p.*, a.name as auftraggeber_name, a.zusatz as auftraggeber_zusatz,
            a.strasse, a.plz, a.ort, a.land, a.adresse_unvollstaendig,
            ke.nummer as ertragskonto_nummer, ke.bezeichnung as ertragskonto_bezeichnung,
            ka.nummer as aufwand_konto_nummer
     from projekt p
     join auftraggeber a on a.id = p.auftraggeber_id
     left join konto ke on ke.id = p.ertragskonto_id
     left join konto ka on ka.id = p.aufwand_konto_id
     where p.id=$1`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  const x = r.rows[0];
  return {
    ...map(x),
    auftraggeberName: x.auftraggeber_name, auftraggeberZusatz: x.auftraggeber_zusatz,
    auftraggeberStrasse: x.strasse, auftraggeberPlz: x.plz, auftraggeberOrt: x.ort, auftraggeberLand: x.land,
    auftraggeberAdresseUnvollstaendig: x.adresse_unvollstaendig,
    ansprechperson: x.ansprechperson, beschrieb: x.beschrieb, projektleitungKuerzel: x.projektleitung_kuerzel,
    alteProjektNr: x.alte_projekt_nr, aufwandBudgetChf: zahl(x.aufwand_budget_chf),
    ertragskontoNummer: x.ertragskonto_nummer, ertragskontoBezeichnung: x.ertragskonto_bezeichnung,
    aufwandKontoNummer: x.aufwand_konto_nummer,
    fmAbgerechnet: zahl(x.fm_abgerechnet), fmOffenProv: zahl(x.fm_offen_prov),
  };
}

export async function listRechnungenFuerProjekt(pool: pg.Pool, projektId: string): Promise<RechnungListenZeile[]> {
  const r = await pool.query(
    `select id, nummer, datum, status, total_brutto from rechnung
     where projekt_id=$1 order by datum desc, erstellt_am desc`, [projektId]);
  return r.rows.map((x) => ({
    id: x.id, nummer: x.nummer, datum: x.datum, status: x.status, totalBrutto: Number(x.total_brutto),
  }));
}
```

`src/server/routes/projekt.ts` — die beiden GETs auf die neuen Repo-Funktionen umstellen und die Rechnungsliste ergänzen:
```ts
import { listProjekteMitAuftraggeber, getProjektDetail, listRechnungenFuerProjekt } from '../../repos/projektRepo';

  app.get('/projekt', async (req) => {
    const q = req.query as any;
    return listProjekteMitAuftraggeber(pool, { jahr: q.jahr ? Number(q.jahr) : undefined });
  });

  app.get('/projekt/:id', async (req, reply) => {
    try { return await getProjektDetail(pool, (req.params as any).id); }
    catch (e) {
      if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });

  app.get('/projekt/:id/rechnungen', async (req, reply) => {
    try {
      await getProjektDetail(pool, (req.params as any).id);   // 404 statt leerer Liste bei Tippfehler
      return await listRechnungenFuerProjekt(pool, (req.params as any).id);
    } catch (e) {
      if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });
```

Der bisherige `auftraggeberId`-Filter auf `GET /projekt` entfällt — die Oberfläche filtert im Browser, und kein Test nutzt ihn. Falls doch, im Report melden statt den Test anzupassen.

- [ ] **Step 4: Verify pass** — Run: `npm test -- projektLeseRouten` → PASS; dann `npm test` (alle) → PASS; `npx tsc --noEmit` sauber.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(api): Lese-Endpunkte fuer die Oberflaeche (Liste, Detail, Rechnungen)"
```

---

## Task 2: Statische Auslieferung, Grundgerüst und Designsystem

**Files:**
- Modify: `package.json`, `src/server/app.ts`
- Create: `public/index.html`, `public/stil.css`, `public/api.js`, `public/app.js`, `public/ui/zustand.js`, `test/statischeAuslieferung.test.ts`

**Interfaces:**
- Consumes: `buildApp`
- Produces:
  - Server liefert `GET /` → `public/index.html`, `GET /stil.css`, `GET /app.js`, `GET /ui/*.js`, `GET /screens/*.js`
  - `api.js`: `hole(pfad)`, `sende(methode, pfad, koerper)`, `class ApiFehler extends Error { status: number; meldung: string }`
  - `app.js`: Hash-Router mit den Routen `#/projekte` (Vorgabe), `#/projekt/:id`, `#/rechnung/:id`, `#/system`; `zeigeFehler(text)`; `registriere(muster, ladeFn)`
  - `ui/zustand.js`: `laedt(el)`, `leer(el, text)`, `fehler(el, text)`

- [ ] **Step 1: Failing test** — `test/statischeAuslieferung.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';

const app = buildApp(getPool());
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('statische Auslieferung', () => {
  it('liefert die Startseite unter /', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('<div id="inhalt"');
  });

  it('liefert Stylesheet und Module', async () => {
    expect((await app.inject({ method: 'GET', url: '/stil.css' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/app.js' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ui/zustand.js' })).statusCode).toBe(200);
  });

  it('laesst die API-Routen unberuehrt', async () => {
    const r = await app.inject({ method: 'GET', url: '/zaehler/rechnung' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('untergrenze');
  });

  it('verweigert Pfad-Traversierung', async () => {
    const r = await app.inject({ method: 'GET', url: '/../package.json' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- statischeAuslieferung` → FAIL (404 auf `/`).

- [ ] **Step 3: Implementieren**

```bash
npm install @fastify/static@^7.0.4
```

`src/server/app.ts` — Registrierung **nach** den API-Routen, damit sie Vorrang behalten:
```ts
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ... nach den register*Routes-Aufrufen, vor `return app;`:
  app.register(fastifyStatic, {
    root: join(dirname(fileURLToPath(import.meta.url)), '../../public'),
    prefix: '/',
  });
```

`public/index.html`:
```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bbz Projekte</title>
<link rel="stylesheet" href="/stil.css">
<header class="kopf">
  <a class="marke" href="#/projekte">bbz Projekte</a>
  <nav><a href="#/projekte">Projekte</a><a href="#/system">System</a></nav>
</header>
<div id="sperrstreifen" hidden></div>
<div id="fehlerbanner" hidden></div>
<main id="inhalt" tabindex="-1"></main>
<script type="module" src="/app.js"></script>
```

`public/stil.css` — Designsystem aus dem Kopf dieses Plans, plus:
```css
* { box-sizing: border-box; }
body { margin: 0; background: var(--papier); color: var(--tinte); font-family: var(--schrift); font-size: 14px; line-height: 1.45; }
.kopf { display: flex; gap: 1.5rem; align-items: baseline; padding: .6rem 1rem; border-bottom: 1px solid var(--linie); }
.marke { font-weight: 600; text-decoration: none; color: var(--tinte); }
.kopf nav a { margin-right: 1rem; color: var(--tinte-matt); text-decoration: none; }
.kopf nav a:hover { color: var(--marke); }
main { padding: 1rem; }

/* Bezeichner sind Codes */
.code, td.code { font-family: var(--code); font-variant-numeric: tabular-nums; }
/* Projektnummer als Titel — die Nummer ist der Name, unter dem gesprochen wird */
.titel-nummer { font-family: var(--code); font-size: 2rem; letter-spacing: -.02em; margin: 0; }
.titel-name { font-size: 1.05rem; color: var(--tinte-matt); margin: .1rem 0 1rem; }

table { border-collapse: collapse; width: 100%; }
th, td { padding: .3rem .6rem; border-bottom: 1px solid var(--linie); text-align: left; }
th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--tinte-matt); font-weight: 600; cursor: pointer; }
td.betrag, th.betrag { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--code); }
td.betrag.minus { color: var(--storno); }
tbody tr:hover { background: #F0F2F4; }

.status { font-size: .78rem; font-weight: 600; }
.status-offen_prov { color: var(--tinte-matt); }
.status-def_vereinbart { color: var(--marke); }
.status-abgerechnet { color: var(--offen); }
.status-bezahlt { color: var(--bezahlt); }
.status-storniert { color: var(--storno); text-decoration: line-through; }

/* Eckmarken: Signatur aus dem QR-Zahlteil — markieren ausschliesslich Eingabefelder */
.eck { position: relative; display: inline-block; padding: 2px; }
.eck > input, .eck > select { border: 0; background: transparent; font: inherit; color: inherit; padding: .25rem .35rem; }
.eck::before, .eck::after {
  content: ""; position: absolute; width: 7px; height: 7px; pointer-events: none;
  border-color: var(--tinte-matt); border-style: solid;
}
.eck::before { top: 0; left: 0; border-width: 1px 0 0 1px; }
.eck::after  { bottom: 0; right: 0; border-width: 0 1px 1px 0; }
.eck:focus-within::before, .eck:focus-within::after { border-color: var(--marke); border-width: 2px; }
.eck.fehlerhaft::before, .eck.fehlerhaft::after { border-color: var(--storno); }

button { font: inherit; padding: .35rem .8rem; border: 1px solid var(--linie); background: #fff; color: var(--tinte); cursor: pointer; }
button:hover { border-color: var(--marke); color: var(--marke); }
button.haupt { background: var(--marke); border-color: var(--marke); color: #fff; }
button[disabled] { opacity: .5; cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--marke); outline-offset: 2px; }

#fehlerbanner, #sperrstreifen { padding: .5rem 1rem; font-size: .9rem; }
#fehlerbanner { background: #FBEAEA; color: var(--storno); border-bottom: 1px solid var(--storno); }
#sperrstreifen { background: #FBF3E3; color: var(--offen); border-bottom: 1px solid var(--offen); }
.hinweis-fm { font-size: .78rem; color: var(--tinte-matt); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

`public/api.js`:
```js
// Rollen-Header: einziger Ort, an dem die Identitaet gesetzt wird.
// Platzhalter bis Entra-ID/MSAL verdrahtet ist — dann wird hier das Token gesetzt.
const KOPFZEILEN = { 'content-type': 'application/json', 'x-user-role': 'admin' };

export class ApiFehler extends Error {
  constructor(status, meldung) { super(meldung); this.status = status; this.meldung = meldung; }
}

async function auswerten(antwort) {
  if (antwort.ok) return antwort.status === 204 ? null : antwort.json();
  let meldung = `Unerwarteter Fehler (${antwort.status})`;
  try { const k = await antwort.json(); if (k && k.error) meldung = k.error; } catch { /* kein JSON */ }
  throw new ApiFehler(antwort.status, meldung);
}

export async function hole(pfad) {
  return auswerten(await fetch(pfad, { headers: KOPFZEILEN }));
}

export async function sende(methode, pfad, koerper) {
  return auswerten(await fetch(pfad, {
    method: methode, headers: KOPFZEILEN,
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
  }));
}
```

`public/ui/zustand.js`:
```js
export function laedt(el) { el.innerHTML = '<p class="hinweis-fm">Lädt …</p>'; }
export function leer(el, text) { el.innerHTML = `<p class="hinweis-fm">${text}</p>`; }
export function fehler(el, text) { el.innerHTML = `<p style="color:var(--storno)">${text}</p>`; }
```

`public/app.js`:
```js
import { hole, ApiFehler } from './api.js';

const inhalt = document.getElementById('inhalt');
const banner = document.getElementById('fehlerbanner');
const streifen = document.getElementById('sperrstreifen');
const routen = [];

export function registriere(muster, laden) { routen.push({ muster, laden }); }

export function zeigeFehler(text) {
  banner.textContent = text;
  banner.hidden = false;
}
function verbergeFehler() { banner.hidden = true; }

// Der gesperrte Zaehler blockiert die Kernaktion — er gehoert dauerhaft sichtbar,
// nicht erst in die Fehlermeldung nach dem Klick.
export async function aktualisiereSperrstreifen() {
  try {
    const z = await hole('/zaehler/rechnung');
    streifen.hidden = !z.gesperrt;
    if (z.gesperrt) {
      streifen.textContent =
        `Rechnungszähler steht auf ${z.wert}, Untergrenze ${z.untergrenze}. ` +
        `Festschreiben ist gesperrt, bis der FileMaker-Höchststand gesetzt ist.`;
    }
    return z;
  } catch { streifen.hidden = true; return null; }
}

async function route() {
  verbergeFehler();
  const pfad = location.hash.slice(1) || '/projekte';
  for (const { muster, laden } of routen) {
    const treffer = muster.exec(pfad);
    if (!treffer) continue;
    try { await laden(inhalt, treffer.slice(1)); }
    catch (e) { zeigeFehler(e instanceof ApiFehler ? e.meldung : String(e)); }
    inhalt.focus();
    return;
  }
  inhalt.innerHTML = '<p>Diese Ansicht gibt es nicht.</p>';
}

addEventListener('hashchange', route);
addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    import('./screens/projekte.js'), import('./screens/projekt.js'),
    import('./screens/rechnung.js'), import('./screens/system.js'),
  ]);
  await aktualisiereSperrstreifen();
  await route();
});
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- statischeAuslieferung` → PASS; `npm test` → PASS.

Die vier Screen-Module existieren noch nicht. Damit der Import in `app.js` nicht scheitert, lege sie in diesem Task als leere Module mit je einer `registriere`-Zeile an, die eine Platzhalterzeile rendert; Task 4–7 füllen sie.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(ui): statische Auslieferung, Router und Designsystem"
```

---

## Task 3: Formatierung und MWSt im Browser

Die Anzeige darf nie andere Zahlen zeigen als die Festschreibung erzeugt. Deshalb wird die MWSt-Rechnung im Browser gegen die Server-Implementierung getestet, nicht nur gegen Erwartungswerte.

**Files:**
- Create: `public/ui/format.js`, `public/ui/mwst.js`, `test/browserFormat.test.ts`, `test/browserMwst.test.ts`

**Interfaces:**
- Consumes: `rappenRunden`, `berechneMwst` aus `src/domain/mwst.ts` (nur im Test, zum Abgleich)
- Produces:
  - `franken(n: number | null): string` — `4'435'265.00`, `null` → `'—'`
  - `datum(iso: string | null): string` — `'2026-07-27'` → `'27.07.2026'`, `null` → `'—'`
  - `prozent(n: number): string` — `8.1` → `'8.1 %'`
  - `menge(n: number): string` — bis zwei Nachkommastellen, ohne unnötige Nullen (`33.5`, `1`, `0.25`)
  - `rappenRunden(x: number): number` und `berechneMwst(positionen, modus)` mit identischer Signatur und identischem Ergebnis wie der Server

- [ ] **Step 1: Failing tests** — `test/browserFormat.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { franken, datum, prozent, menge } from '../public/ui/format.js';

describe('franken', () => {
  it('setzt Apostroph-Tausender und zwei Nachkommastellen', () => {
    expect(franken(4435265)).toBe("4'435'265.00");
    expect(franken(8329.1)).toBe("8'329.10");
    expect(franken(0)).toBe('0.00');
  });
  it('zeigt negative Betraege mit Minus', () => {
    expect(franken(-1234.5)).toBe("-1'234.50");
  });
  it('zeigt fehlende Werte als Gedankenstrich', () => {
    expect(franken(null)).toBe('—');
  });
});

describe('datum', () => {
  it('wandelt ISO nach Schweizer Schreibweise', () => {
    expect(datum('2026-07-27')).toBe('27.07.2026');
    expect(datum('2026-01-01')).toBe('01.01.2026');
  });
  it('zeigt fehlende Werte als Gedankenstrich', () => {
    expect(datum(null)).toBe('—');
  });
});

describe('prozent und menge', () => {
  it('formatiert Saetze und Mengen lesbar', () => {
    expect(prozent(8.1)).toBe('8.1 %');
    expect(prozent(0)).toBe('0 %');
    expect(menge(33.5)).toBe('33.5');
    expect(menge(1)).toBe('1');
    expect(menge(0.25)).toBe('0.25');
  });
});
```

`test/browserMwst.test.ts` — der eigentliche Zweck: Browser gegen Server:

```ts
import { describe, it, expect } from 'vitest';
import { berechneMwst as serverMwst, rappenRunden as serverRunden } from '../src/domain/mwst';
import { berechneMwst as browserMwst, rappenRunden as browserRunden } from '../public/ui/mwst.js';

const faelle: { positionen: { betrag: number; satz: number }[]; modus: 'exkl' | 'inkl' }[] = [
  { positionen: [{ betrag: 7705, satz: 8.1 }], modus: 'exkl' },                       // der echte Beleg
  { positionen: [{ betrag: 8329.1, satz: 8.1 }], modus: 'inkl' },
  { positionen: [{ betrag: 1000, satz: 8.1 }, { betrag: 500, satz: 2.6 }], modus: 'exkl' },
  { positionen: [{ betrag: 333.33, satz: 8.1 }, { betrag: 66.67, satz: 8.1 }], modus: 'exkl' },
  { positionen: [{ betrag: 1, satz: 0 }], modus: 'exkl' },
  { positionen: [], modus: 'exkl' },
];

describe('MWSt im Browser', () => {
  it('rundet auf 0.05 wie der Server', () => {
    for (const x of [0, 0.02, 0.03, 8329.12, 624.07, -1.23]) {
      expect(browserRunden(x)).toBe(serverRunden(x));
    }
  });

  it('liefert fuer jeden Fall exakt das Server-Ergebnis', () => {
    for (const f of faelle) {
      expect(browserMwst(f.positionen, f.modus)).toEqual(serverMwst(f.positionen, f.modus));
    }
  });

  it('reproduziert den echten Beleg', () => {
    const e = browserMwst([{ betrag: 7705, satz: 8.1 }], 'exkl');
    expect(e.totalNetto).toBe(7705);
    expect(e.totalSteuer).toBe(624.1);
    expect(e.totalBrutto).toBe(8329.1);
    expect(e.proSatz).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- browserFormat browserMwst` → FAIL (Module fehlen).

- [ ] **Step 3: Implementieren**

`public/ui/format.js`:
```js
const CHF = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function franken(n) {
  if (n === null || n === undefined) return '—';
  return CHF.format(n);
}

export function datum(iso) {
  if (!iso) return '—';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

export function prozent(n) {
  return `${Number(n)} %`;
}

export function menge(n) {
  return String(Math.round(Number(n) * 100) / 100);
}
```

`public/ui/mwst.js` — bewusst wortgleich zu `src/domain/mwst.ts`. Die Duplikation ist der Preis dafür, dass das Frontend ohne Build läuft; `test/browserMwst.test.ts` hält beide Fassungen zusammen:
```js
// Spiegel von src/domain/mwst.ts. Aenderungen dort MUESSEN hier nachgezogen werden —
// test/browserMwst.test.ts vergleicht beide Fassungen und schlaegt sonst fehl.
export function rappenRunden(x) {
  return Math.round(x * 20) / 20;
}

export function berechneMwst(positionen, modus) {
  const nettoJeSatz = new Map();
  for (const p of positionen) {
    const netto = modus === 'exkl' ? p.betrag : (p.betrag * 100) / (100 + p.satz);
    nettoJeSatz.set(p.satz, (nettoJeSatz.get(p.satz) ?? 0) + netto);
  }
  const proSatz = [];
  for (const [satz, nettoRoh] of [...nettoJeSatz.entries()].sort((a, b) => b[0] - a[0])) {
    const netto = rappenRunden(nettoRoh);
    const steuer = rappenRunden((netto * satz) / 100);
    proSatz.push({ satz, netto, steuer, brutto: rappenRunden(netto + steuer) });
  }
  const totalNetto = rappenRunden(proSatz.reduce((s, z) => s + z.netto, 0));
  const totalSteuer = rappenRunden(proSatz.reduce((s, z) => s + z.steuer, 0));
  return { proSatz, totalNetto, totalSteuer, totalBrutto: rappenRunden(totalNetto + totalSteuer) };
}
```

`vitest.config.ts` — `include` um die Browser-Module erweitern ist **nicht** nötig; die Tests liegen weiterhin unter `test/`. Prüfe, ob vitest `.js`-Importe aus `public/` auflöst; falls nicht, ergänze in `vitest.config.ts` unter `test` die Option `server: { deps: { inline: [/public\//] } }` und halte das im Report fest.

- [ ] **Step 4: Verify pass** — Run: `npm test -- browserFormat browserMwst` → PASS; `npm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(ui): Schweizer Formate und MWSt-Rechnung im Browser, gegen den Server abgeglichen"
```

---

## Task 4: Projektliste

**Files:**
- Create: `public/ui/tabelle.js`
- Modify: `public/screens/projekte.js`

**Interfaces:**
- Consumes: `hole`, `registriere`, `franken`, `laedt`, `leer`, `fehler`
- Produces: `tabelle(spalten, zeilen)` — `spalten: { titel, feld, klasse?, render? }[]`; liefert ein `<table>` mit Sortierung je Spaltenkopf. Route `#/projekte`.

- [ ] **Step 1: Screen bauen** — `public/screens/projekte.js`

```js
import { registriere } from '../app.js';
import { hole } from '../api.js';
import { franken } from '../ui/format.js';
import { tabelle } from '../ui/tabelle.js';
import { laedt, leer } from '../ui/zustand.js';

registriere(/^\/projekte$/, async (el) => {
  laedt(el);
  const alle = await hole('/projekt');

  el.innerHTML = `
    <h1 class="titel-nummer">Projekte</h1>
    <p class="titel-name">${alle.length} Projekte</p>
    <div class="filterzeile">
      <label>Jahr <span class="eck"><input id="f-jahr" size="5" inputmode="numeric"></span></label>
      <label>Suche <span class="eck"><input id="f-text" size="30" placeholder="Nummer, Name oder Auftraggeber"></span></label>
    </div>
    <p class="hinweis-fm">„abgerechnet" und „offen" sind Stände aus FileMaker vom Zeitpunkt des Exports.
       Sie ändern sich nicht, wenn hier eine Rechnung erfasst wird.</p>
    <div id="liste"></div>`;

  const ziel = el.querySelector('#liste');
  const spalten = [
    { titel: 'Nummer', feld: 'nummer', klasse: 'code' },
    { titel: 'Name', feld: 'name' },
    { titel: 'Auftraggeber', feld: 'auftraggeberName' },
    { titel: 'Bereich', feld: 'bereich' },
    { titel: 'Budget', feld: 'budgetChf', klasse: 'betrag', render: franken },
    { titel: 'abgerechnet (FM)', feld: 'fmAbgerechnet', klasse: 'betrag', render: franken },
    { titel: 'offen (FM)', feld: 'fmOffenProv', klasse: 'betrag', render: franken },
  ];

  function zeichne() {
    const jahr = el.querySelector('#f-jahr').value.trim();
    const text = el.querySelector('#f-text').value.trim().toLowerCase();
    const gefiltert = alle.filter((p) =>
      (jahr === '' || String(p.jahr) === jahr) &&
      (text === '' || `${p.nummer} ${p.name} ${p.auftraggeberName}`.toLowerCase().includes(text)));
    ziel.innerHTML = '';
    if (gefiltert.length === 0) { leer(ziel, 'Kein Projekt passt zu diesem Filter.'); return; }
    ziel.append(tabelle(spalten, gefiltert, (p) => { location.hash = `#/projekt/${p.id}`; }));
  }

  el.querySelector('#f-jahr').addEventListener('input', zeichne);
  el.querySelector('#f-text').addEventListener('input', zeichne);
  zeichne();
});
```

`public/ui/tabelle.js`:
```js
export function tabelle(spalten, zeilen, beiKlick) {
  let sortFeld = null;
  let absteigend = false;
  const t = document.createElement('table');

  function zeichne() {
    const daten = sortFeld === null ? zeilen : [...zeilen].sort((a, b) => {
      const x = a[sortFeld], y = b[sortFeld];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;   // Leerwerte immer ans Ende
      if (y === null || y === undefined) return -1;
      const v = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de-CH');
      return absteigend ? -v : v;
    });
    t.innerHTML =
      `<thead><tr>${spalten.map((s) =>
        `<th class="${s.klasse ?? ''}" data-feld="${s.feld}">${s.titel}${
          sortFeld === s.feld ? (absteigend ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>` +
      `<tbody>${daten.map((z, i) =>
        `<tr data-i="${i}">${spalten.map((s) =>
          `<td class="${s.klasse ?? ''}">${s.render ? s.render(z[s.feld]) : (z[s.feld] ?? '—')}</td>`
        ).join('')}</tr>`).join('')}</tbody>`;
    t.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const f = th.dataset.feld;
      absteigend = sortFeld === f ? !absteigend : false;
      sortFeld = f;
      zeichne();
    }));
    if (beiKlick) t.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', () => beiKlick(daten[Number(tr.dataset.i)])));
  }

  zeichne();
  return t;
}
```

- [ ] **Step 2: Von Hand prüfen** — `docker compose up -d`, dann in einer Shell mit gesetztem `DATABASE_URL` die Daten aufbauen (Kontenplan, Projekte, Adressen) und `npm run dev` starten. `http://localhost:3000/#/projekte` öffnen. Erwartet: 151 Zeilen, Filter nach Jahr und Text greifen, Spaltensortierung funktioniert, Beträge stehen rechtsbündig in Tabellenziffern, der Hinweis zu den FileMaker-Ständen ist sichtbar.

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ui): Projektliste mit Filter, Suche und Sortierung"
```

---

## Task 5: Projektdetail und Adress-Nachtrag

**Files:**
- Modify: `public/screens/projekt.js`

**Interfaces:**
- Consumes: `hole`, `sende`, `registriere`, `franken`, `datum`, `tabelle`, `laedt`
- Produces: Route `#/projekt/:id`. Nutzt `GET /projekt/:id`, `GET /projekt/:id/rechnungen`, `PUT /auftraggeber/:id`.

- [ ] **Step 1: Screen bauen** — `public/screens/projekt.js`

```js
import { registriere, aktualisiereSperrstreifen } from '../app.js';
import { hole, sende } from '../api.js';
import { franken, datum } from '../ui/format.js';
import { tabelle } from '../ui/tabelle.js';
import { laedt, leer } from '../ui/zustand.js';

registriere(/^\/projekt\/([0-9a-f-]+)$/, async (el, [id]) => {
  laedt(el);
  const [p, rechnungen] = await Promise.all([hole(`/projekt/${id}`), hole(`/projekt/${id}/rechnungen`)]);

  const adresse = p.auftraggeberAdresseUnvollstaendig
    ? `<div id="adressnachtrag" class="sperrhinweis">
         <p><strong>${p.auftraggeberName}</strong> hat keine vollständige Adresse.
            Ohne Strasse, PLZ und Ort lässt sich keine Rechnung festschreiben.</p>
         <label>Strasse <span class="eck"><input id="a-strasse" size="28"></span></label>
         <label>PLZ <span class="eck"><input id="a-plz" size="6"></span></label>
         <label>Ort <span class="eck"><input id="a-ort" size="18"></span></label>
         <label>Land <span class="eck"><input id="a-land" size="4" value="CH"></span></label>
         <button id="a-speichern" class="haupt">Adresse speichern</button>
       </div>`
    : `<p>${p.auftraggeberName}${p.auftraggeberZusatz ? '<br>' + p.auftraggeberZusatz : ''}<br>
          ${p.auftraggeberStrasse}<br>${p.auftraggeberLand}-${p.auftraggeberPlz} ${p.auftraggeberOrt}</p>`;

  el.innerHTML = `
    <h1 class="titel-nummer">${p.nummer}</h1>
    <p class="titel-name">${p.name}</p>
    <section class="kopfdaten">
      <dl>
        <dt>Auftraggeber</dt><dd>${adresse}</dd>
        <dt>Ansprechperson</dt><dd>${p.ansprechperson ?? '—'}</dd>
        <dt>Bereich</dt><dd>${p.bereich ?? '—'}</dd>
        <dt>Projektleitung</dt><dd class="code">${p.projektleitungKuerzel ?? '—'}</dd>
        <dt>Ertragskonto</dt><dd><span class="code">${p.ertragskontoNummer ?? '—'}</span>
            ${p.ertragskontoBezeichnung ?? ''}</dd>
        <dt>Budget</dt><dd class="betrag">${franken(p.budgetChf)}</dd>
        <dt>Vorjahr</dt><dd class="code">${p.alteProjektNr ?? '—'}</dd>
      </dl>
      ${p.beschrieb ? `<pre class="beschrieb">${p.beschrieb}</pre>` : ''}
    </section>
    <h2>Rechnungen</h2>
    <div id="rechnungen"></div>
    <button id="neu" class="haupt">Neue Rechnung</button>`;

  const ziel = el.querySelector('#rechnungen');
  if (rechnungen.length === 0) {
    leer(ziel, 'Für dieses Projekt gibt es noch keine Rechnung.');
  } else {
    ziel.append(tabelle([
      { titel: 'Nummer', feld: 'nummer', klasse: 'code' },
      { titel: 'Datum', feld: 'datum', render: datum },
      { titel: 'Status', feld: 'status', render: (s) => `<span class="status status-${s}">${s}</span>` },
      { titel: 'Total', feld: 'totalBrutto', klasse: 'betrag', render: franken },
    ], rechnungen, (r) => { location.hash = `#/rechnung/${r.id}`; }));
  }

  el.querySelector('#neu').addEventListener('click', async () => {
    const r = await sende('POST', '/rechnung', {
      projektId: p.id, auftraggeberId: p.auftraggeberId,
      datum: new Date().toISOString().slice(0, 10),
      betreff: p.name, mwstModus: p.mwstModus,
    });
    location.hash = `#/rechnung/${r.id}`;
  });

  const speichern = el.querySelector('#a-speichern');
  if (speichern) speichern.addEventListener('click', async () => {
    await sende('PUT', `/auftraggeber/${p.auftraggeberId}`, {
      strasse: el.querySelector('#a-strasse').value.trim(),
      plz: el.querySelector('#a-plz').value.trim(),
      ort: el.querySelector('#a-ort').value.trim(),
      land: el.querySelector('#a-land').value.trim(),
    });
    await aktualisiereSperrstreifen();
    location.reload();
  });
});
```

Ergänze in `public/stil.css`:
```css
.kopfdaten dl { display: grid; grid-template-columns: 11rem 1fr; gap: .15rem 1rem; margin: 0 0 1rem; }
.kopfdaten dt { color: var(--tinte-matt); font-size: .85rem; }
.kopfdaten dd { margin: 0; }
.beschrieb { font: inherit; white-space: pre-wrap; background: #fff; border-left: 2px solid var(--linie); padding: .5rem .8rem; margin: 0 0 1rem; }
.sperrhinweis { background: #FBF3E3; border: 1px solid var(--offen); padding: .7rem; }
.sperrhinweis label { margin-right: .8rem; }
```

- [ ] **Step 2: Von Hand prüfen** — Ein Projekt der Urner Kantonalbank öffnen: Kopfdaten vollständig, Rechnungsliste leer. Dann ein Projekt von `20577` (bbz st.gallen ag) öffnen: der Adress-Nachtrag erscheint. Adresse eintragen, speichern, Seite lädt neu — der Hinweis ist weg.

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ui): Projektdetail mit Rechnungen und Adress-Nachtrag"
```

---

## Task 6: Rechnungserfassung, Festschreibung und PDF

**Files:**
- Modify: `public/screens/rechnung.js`

**Interfaces:**
- Consumes: `hole`, `sende`, `registriere`, `aktualisiereSperrstreifen`, `berechneMwst`, `franken`, `prozent`, `menge`
- Produces: Route `#/rechnung/:id`. Nutzt `GET /rechnung/:id`, `POST /rechnung/:id/position`, `POST /rechnung/:id/festschreiben`, `GET /rechnung/:id/pdf`.

**Fachliche Regeln, die dieser Screen sichtbar machen muss:**
- Positionen sind nur im Entwurf editierbar (`offen_prov`, `def_vereinbart`) — der Server lehnt sonst ab.
- Festschreiben ist irreversibel und braucht eine Bestätigung, die das ausspricht.
- Bei gesperrtem Zähler ist der Knopf inaktiv, mit Grund.

- [ ] **Step 1: Screen bauen** — `public/screens/rechnung.js`

```js
import { registriere, aktualisiereSperrstreifen } from '../app.js';
import { hole, sende } from '../api.js';
import { berechneMwst } from '../ui/mwst.js';
import { franken, datum, prozent, menge } from '../ui/format.js';
import { laedt } from '../ui/zustand.js';

const SAETZE = [8.1, 2.6, 3.8, 0];

registriere(/^\/rechnung\/([0-9a-f-]+)$/, async (el, [id]) => {
  laedt(el);
  const r = await hole(`/rechnung/${id}`);
  const p = await hole(`/projekt/${r.projektId}`);
  const zaehler = await aktualisiereSperrstreifen();
  const entwurf = r.status === 'offen_prov' || r.status === 'def_vereinbart';

  const e = berechneMwst(r.positionen.map((x) => ({ betrag: x.betragNetto, satz: x.mwstSatz })), r.mwstModus);

  el.innerHTML = `
    <h1 class="titel-nummer">${r.nummer ?? 'Entwurf'}</h1>
    <p class="titel-name">${p.nummer} · ${p.name} · ${p.auftraggeberName}</p>
    <p><span class="status status-${r.status}">${r.status}</span> · ${datum(r.datum)} ·
       MWSt ${r.mwstModus}.</p>

    <table id="positionen">
      <thead><tr>
        <th>Beschreibung</th><th class="betrag">Menge</th><th>Einheit</th>
        <th class="betrag">Einzelpreis</th><th class="betrag">MWSt</th><th class="betrag">Betrag</th>
      </tr></thead>
      <tbody>${r.positionen.map((x) => `<tr>
        <td>${x.beschreibung}</td>
        <td class="betrag">${menge(x.menge)}</td>
        <td>${x.einheit}</td>
        <td class="betrag">${franken(x.einzelpreis)}</td>
        <td class="betrag">${prozent(x.mwstSatz)}</td>
        <td class="betrag">${franken(x.betragNetto)}</td>
      </tr>`).join('')}</tbody>
    </table>

    ${entwurf ? `<fieldset id="neu-pos">
      <legend>Position hinzufügen</legend>
      <label>Beschreibung <span class="eck"><input id="p-text" size="36"></span></label>
      <label>Menge <span class="eck"><input id="p-menge" size="6" inputmode="decimal" value="1"></span></label>
      <label>Einheit <span class="eck"><select id="p-einheit">
        <option>Std</option><option>Tag</option><option>Pauschal</option><option>Stk</option>
      </select></span></label>
      <label>Einzelpreis <span class="eck"><input id="p-preis" size="10" inputmode="decimal"></span></label>
      <label>MWSt <span class="eck"><select id="p-satz">
        ${SAETZE.map((s) => `<option value="${s}">${prozent(s)}</option>`).join('')}
      </select></span></label>
      <button id="p-add">Hinzufügen</button>
    </fieldset>` : ''}

    <!-- Aufbau wie die MWSt-Zusammenfassung auf dem gedruckten Beleg -->
    <table class="summen">
      <tbody>
        ${e.proSatz.map((z) => `<tr>
          <td>Netto ${prozent(z.satz)}</td><td class="betrag">${franken(z.netto)}</td>
          <td>MWSt</td><td class="betrag">${franken(z.steuer)}</td>
        </tr>`).join('')}
        <tr class="total">
          <td>Total netto</td><td class="betrag">${franken(e.totalNetto)}</td>
          <td>Total MWSt</td><td class="betrag">${franken(e.totalSteuer)}</td>
        </tr>
        <tr class="total"><td colspan="3">Rechnungsbetrag</td>
          <td class="betrag">${franken(e.totalBrutto)}</td></tr>
      </tbody>
    </table>

    <div class="aktionen">
      ${entwurf ? `<button id="fest" class="haupt">Festschreiben</button>` : ''}
      ${r.nummer ? `<a href="/rechnung/${r.id}/pdf" target="_blank"><button>PDF öffnen</button></a>` : ''}
      <a href="#/projekt/${p.id}"><button>Zurück zum Projekt</button></a>
    </div>
    <p id="sperrgrund" class="hinweis-fm"></p>`;

  const hinzu = el.querySelector('#p-add');
  if (hinzu) hinzu.addEventListener('click', async () => {
    await sende('POST', `/rechnung/${r.id}/position`, {
      beschreibung: el.querySelector('#p-text').value.trim(),
      menge: Number(el.querySelector('#p-menge').value),
      einheit: el.querySelector('#p-einheit').value,
      einzelpreis: Number(el.querySelector('#p-preis').value),
      mwstSatz: Number(el.querySelector('#p-satz').value),
    });
    location.reload();
  });

  const fest = el.querySelector('#fest');
  if (fest) {
    const gesperrt = zaehler?.gesperrt ?? false;
    const ohnePositionen = r.positionen.length === 0;
    const adresseFehlt = p.auftraggeberAdresseUnvollstaendig;
    fest.disabled = gesperrt || ohnePositionen || adresseFehlt;
    el.querySelector('#sperrgrund').textContent =
      gesperrt ? `Festschreiben gesperrt: der Rechnungszähler steht auf ${zaehler.wert}, Untergrenze ${zaehler.untergrenze}. Unter „System" setzen.`
      : adresseFehlt ? 'Festschreiben gesperrt: dem Auftraggeber fehlt die Adresse. Beim Projekt nachtragen.'
      : ohnePositionen ? 'Festschreiben möglich, sobald mindestens eine Position erfasst ist.'
      : '';

    fest.addEventListener('click', async () => {
      const ok = confirm(
        `Rechnung festschreiben?\n\n` +
        `Es wird eine Rechnungsnummer unwiderruflich vergeben. ` +
        `Die Rechnung ist danach nicht mehr änderbar — Korrekturen nur über Storno und Neuerfassung.\n\n` +
        `Betrag: ${franken(e.totalBrutto)}`);
      if (!ok) return;
      await sende('POST', `/rechnung/${r.id}/festschreiben`, { erstellerKuerzel: p.projektleitungKuerzel ?? undefined });
      location.reload();
    });
  }
});
```

Ergänze in `public/stil.css`:
```css
#neu-pos { border: 1px solid var(--linie); padding: .7rem; margin: 1rem 0; }
#neu-pos label { margin-right: .8rem; }
.summen { width: auto; min-width: 26rem; margin: 1rem 0; }
.summen td { border-bottom: 0; padding: .15rem .6rem; }
.summen tr.total td { border-top: 1px solid var(--tinte); font-weight: 600; }
.aktionen { display: flex; gap: .5rem; margin: 1rem 0; }
.aktionen a { text-decoration: none; }
```

- [ ] **Step 2: Von Hand prüfen** — Rechnung aus einem Projekt anlegen, Position „Kurstage Lehrgang Bankfach", 33.5 Std à 230.00, 8.1 % erfassen. Erwartet: Netto `7'705.00`, MWSt `624.10`, Rechnungsbetrag `8'329.10` — dieselben Zahlen wie auf dem echten FileMaker-Beleg. Festschreiben-Knopf bei gesperrtem Zähler inaktiv mit Begründung; nach dem Setzen aktiv. Nach der Bestätigung erscheint die Nummer, die Positionsmaske verschwindet, PDF öffnet sich.

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ui): Rechnungserfassung mit Live-Summen, Festschreibung und PDF"
```

---

## Task 7: Systemzustand und Durchstich-Nachweis

**Files:**
- Modify: `public/screens/system.js`, `HANDOVER.md`
- Create: `docs/durchstich-nachweis.md`

**Interfaces:**
- Consumes: `hole`, `sende`, `registriere`, `aktualisiereSperrstreifen`, `datum`
- Produces: Route `#/system`. Nutzt `GET /zaehler/rechnung`, `PUT /zaehler/rechnung`.

- [ ] **Step 1: Screen bauen** — `public/screens/system.js`

```js
import { registriere, aktualisiereSperrstreifen } from '../app.js';
import { hole, sende } from '../api.js';
import { laedt } from '../ui/zustand.js';

registriere(/^\/system$/, async (el) => {
  laedt(el);
  const z = await hole('/zaehler/rechnung');

  el.innerHTML = `
    <h1 class="titel-nummer">${z.wert}</h1>
    <p class="titel-name">Stand des Rechnungszählers</p>
    <dl class="kopfdaten">
      <dt>Untergrenze</dt><dd class="code">${z.untergrenze}</dd>
      <dt>Festschreiben</dt>
      <dd>${z.gesperrt
        ? '<span class="status status-abgerechnet">gesperrt</span>'
        : '<span class="status status-bezahlt">möglich</span>'}</dd>
      <dt>Gesetzt am</dt><dd>${z.gesetztAm ? new Date(z.gesetztAm).toLocaleString('de-CH') : '—'}</dd>
      <dt>Gesetzt durch</dt><dd>${z.gesetztDurch ?? '—'}</dd>
    </dl>
    <p>Der Zähler muss auf den höchsten in FileMaker vergebenen Rechnungsnummer-Stand gesetzt werden.
       Die Untergrenze ${z.untergrenze} ist nur der aus dem Export belegbare Boden — der echte Stand liegt darüber.
       Er lässt sich nur erhöhen, nie senken.</p>
    <label>Neuer Stand <span class="eck"><input id="z-wert" size="8" inputmode="numeric"></span></label>
    <button id="z-setzen" class="haupt">Zähler setzen</button>
    <p id="z-meldung" class="hinweis-fm"></p>`;

  el.querySelector('#z-setzen').addEventListener('click', async () => {
    const wert = Number(el.querySelector('#z-wert').value);
    const neu = await sende('PUT', '/zaehler/rechnung', { wert });
    await aktualisiereSperrstreifen();
    el.querySelector('#z-meldung').textContent = `Zähler steht jetzt auf ${neu.wert}.`;
  });
});
```

- [ ] **Step 2: Vollständigen Durchstich fahren und belegen**

Auf einer frisch zurückgesetzten Datenbank, mit gesetztem `DATABASE_URL`:

```bash
docker compose up -d
npm run migrate:fm -- --konten=../fm-discovery/info/kontoplan_erfolgsrechnung.csv --apply
npm run migrate:fm -- --projekte=../fm-discovery/export/export_daten.csv --apply
npm run migrate:fm -- --adressen=../fm-discovery/export/adressen_export.csv --apply
npm run dev
```

Dann **ausschliesslich im Browser**, ohne Terminal:
1. `#/projekte` — nach „Urner" suchen, ein Projekt öffnen
2. „Neue Rechnung", Position 33.5 Std à 230.00 zu 8.1 % erfassen
3. Festschreiben ist gesperrt → `#/system` → Zähler auf 33214 setzen
4. zurück zur Rechnung, festschreiben, bestätigen
5. PDF öffnen

Halte das in `docs/durchstich-nachweis.md` fest: die Schritte, die erzeugte Rechnungsnummer, die drei Summen, und ob eine Aktion einen Terminal-Eingriff gebraucht hätte. **Wenn ja, ist das ein Befund** — die Spec verlangt, dass die Kette ohne Terminal durchläuft.

- [ ] **Step 3: `HANDOVER.md` nachführen** — im Abschnitt „Fortschritt" ergänzen:

```markdown
- **Plan 6 Durchstich (erster Schnitt)** ✅ — statische Auslieferung via `@fastify/static`, Vanilla-ES-Module ohne Build unter `public/`, vier Screens (Projektliste, Projektdetail, Rechnungserfassung, Systemzustand), drei neue Lese-Endpunkte. MWSt-Rechnung im Browser gegen den Server abgeglichen (`test/browserMwst.test.ts`). Nachweis: `docs/durchstich-nachweis.md`.
```

und unter „Offene Punkte / To-verify":

```markdown
- **Frontend-Suche laeuft im Browser** — traegt bei 151 Projekten, nicht beim Vollexport (~4967). Serverseitige Suche/Paginierung nachziehen, sobald der Vollexport da ist.
- **`public/ui/mwst.js` ist ein Spiegel von `src/domain/mwst.ts`.** Aenderungen muessen in beiden erfolgen; `test/browserMwst.test.ts` faengt Abweichungen ab.
- **`public/` liegt ausserhalb von tsconfig** — `tsc --noEmit` deckt die Frontend-Module nicht ab.
```

- [ ] **Step 4: Alles grün + Commit**

Run: `npm test` → PASS; `npx tsc --noEmit` → sauber.

```bash
git add -A && git commit -m "feat(ui): Systemzustand und Durchstich-Nachweis"
```

---

## Self-Review (gegen die Spec)

**Spec-Abdeckung:**
- §3.1 Auslieferung durch den bestehenden Server → Task 2 ✓
- §3.2 Dateiaufbau, kein Build → Tasks 2–7, Struktur wie spezifiziert ✓
- §3.3 kein Zustands-Framework → jeder Screen lädt selbst ✓. Das in der Spec erwähnte Zwischenspeicher-Modul für Nachschlagedaten **entfällt**: nach dem Bau der Screens braucht keiner davon Auftraggeber- oder Kontolisten — das Detail liefert die Bezeichnungen mit. YAGNI, statt ein Modul ohne Aufrufer zu bauen.
- §3.4 Rollen-Header an einer Stelle → `public/api.js`, kommentiert ✓
- §4.1 Projektliste inkl. gekennzeichneter FileMaker-Stände → Task 4 ✓
- §4.2 Projektdetail inkl. Adress-Nachtrag → Task 5 ✓
- §4.3 Erfassung, Live-Summen je Satz, Bestätigung, PDF → Task 6 ✓
- §4.4 Systemzustand → Task 7 ✓
- §5 drei API-Ergänzungen → Task 1 ✓ (die Spec nannte zwei; die dritte — der schmale Detail-Endpunkt — kam beim Planen dazu und ist in Task 1 enthalten)
- §7 Gestaltung: Eckmarken nur an Eingabefeldern, Nummer als Titel, Codes in Monospace, Beträge tabellarisch, Rot reserviert → Designsystem + Tasks 4–7 ✓
- §8 vier Zustände und Fehlermapping → `ui/zustand.js`, `api.js`, Sperrstreifen ✓
- §9 Tests: Backend gegen echte DB (Task 1), Browser-Rechnung gegen Server (Task 3), manueller Nachweis (Task 7) ✓

**Platzhalter:** keine.

**Typ-Konsistenz:** `ProjektListenZeile`, `ProjektDetail`, `RechnungListenZeile` in Task 1 definiert und in Tasks 4–6 mit denselben Feldnamen konsumiert. `franken`/`datum`/`prozent`/`menge` in Task 3 definiert, danach unverändert benutzt. `registriere`/`zeigeFehler`/`aktualisiereSperrstreifen` in Task 2 definiert, in Tasks 4–7 importiert. `berechneMwst` liefert in beiden Fassungen `{ proSatz, totalNetto, totalSteuer, totalBrutto }`.

## Offene Punkte

- `location.reload()` nach dem Hinzufügen einer Position und nach dem Festschreiben ist grob, aber ehrlich: es garantiert, dass die Anzeige den Serverzustand zeigt. Feineres Nachzeichnen erst, wenn es stört.
- Die Statusbezeichnungen erscheinen technisch (`offen_prov`, `def_vereinbart`). Ob sie durch deutsche Klartexte ersetzt werden sollen, entscheidet der Nutzer am laufenden Durchstich — vorher wäre es geraten.
- Es gibt keinen Weg, eine Entwurfs-Rechnung zu löschen; die API kennt keinen. Fällt auf, sobald jemand sich vertippt.

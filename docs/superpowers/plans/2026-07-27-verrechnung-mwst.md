# Verrechnung & MWSt — Implementation Plan (Plan 2 von 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechnungen mit strukturierten Positionen, korrekte MWSt je Posten (mehrsatzfähig, Rappenrundung), **strikt lückenlose** Rechnungsnummerierung und den Status-/Festschreibungs-Lebenszyklus — aufbauend auf dem Fundament aus Plan 1.

**Architecture:** Reine MWSt-Rechenlogik als DB-freies, voll getestetes Domänenmodul (`src/domain/mwst.ts`). Persistenz in `rechnung`/`rechnungsposition` über Repos. Nummernvergabe & Festschreibung serverseitig **in einer DB-Transaktion** über einen `FOR UPDATE`-gesperrten Zähler → gapless auch bei Rollback. Totale werden aus den Positionen mit der MWSt-Engine berechnet, nicht clientseitig.

**Tech Stack:** wie Plan 1 (TypeScript, Fastify, `pg`, vitest, Postgres).

## Global Constraints

- **Beträge** `numeric(12,2)`, **MWSt-Sätze** `numeric(5,2)`. (Spec §4)
- **Rechnungsnummer strikt lückenlos + unveränderlich nach Festschreibung**; Storno statt Löschung. (Spec §6.1)
- **MWSt je Position**; Summierung **je Satz** (Netto/Steuer/Brutto); **Rappenrundung auf 0.05 CHF**. (Spec §5.3, §6.3)
- **Rappenrundung:** `rappenRunden(x) = Math.round(x*20)/20`. Beispielbeleg 7'705.00 × 8.1 % = 624.105 → **624.10** (auf 0.05). Diese Regel ist in Plan 3 gegen den Golden-Beleg zu bestätigen.
- **Festschreibung** friert Kopf + Positionen + Nummer ein; danach keine Mutation (nur Storno). (Spec §6.4)
- Aller DB-Zugriff nur über `src/repos/*`. Sprache deutsch, „ss" statt „ß".

---

## Dateistruktur (in diesem Plan angelegt/berührt)

```
db/migrations/005_rechnung.sql     # rechnung, rechnungsposition, zaehler
src/domain/mwst.ts                 # reine MWSt-Engine + rappenRunden
src/domain/types.ts                # +Rechnung, +Rechnungsposition, +RechnungStatus  (Modify)
src/repos/rechnungRepo.ts          # Draft/Positionen/Totale/Status/Festschreibung
src/server/routes/rechnung.ts      # REST
src/server/app.ts                  # Route-Registrierung  (Modify)
test/mwst.test.ts
test/rechnungRepo.test.ts
test/rechnungFestschreibung.test.ts
test/rechnungRoutes.test.ts
```

---

## Task 1: MWSt-Engine (rein, DB-frei)

**Files:**
- Create: `src/domain/mwst.ts`, `test/mwst.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `rappenRunden(x: number): number` — auf 0.05 gerundet
  - Typen `MwstZeile = { satz: number; netto: number; steuer: number; brutto: number }`, `MwstErgebnis = { proSatz: MwstZeile[]; totalNetto: number; totalSteuer: number; totalBrutto: number }`
  - `berechneMwst(positionen: { betrag: number; satz: number }[], modus: 'exkl' | 'inkl'): MwstErgebnis` — gruppiert je Satz, rundet Steuer je Satz auf 0.05. Bei `exkl` ist `betrag` netto, bei `inkl` brutto.

- [ ] **Step 1: Failing test** — `test/mwst.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { rappenRunden, berechneMwst } from '../src/domain/mwst';

describe('rappenRunden', () => {
  it('rundet auf 0.05', () => {
    expect(rappenRunden(624.105)).toBe(624.10);
    expect(rappenRunden(1.024)).toBe(1.00);
    expect(rappenRunden(1.026)).toBe(1.05);
  });
});

describe('berechneMwst exkl', () => {
  it('Beispielbeleg: 7705 @ 8.1% -> Steuer 624.10, Brutto 8329.10', () => {
    const e = berechneMwst([{ betrag: 7705, satz: 8.1 }], 'exkl');
    expect(e.totalNetto).toBe(7705);
    expect(e.totalSteuer).toBe(624.10);
    expect(e.totalBrutto).toBe(8329.10);
    expect(e.proSatz).toHaveLength(1);
    expect(e.proSatz[0]).toEqual({ satz: 8.1, netto: 7705, steuer: 624.10, brutto: 8329.10 });
  });
  it('mehrsatzig: 1000@8.1 + 500@2.6 gruppiert je Satz', () => {
    const e = berechneMwst([{ betrag: 1000, satz: 8.1 }, { betrag: 500, satz: 2.6 }], 'exkl');
    expect(e.totalNetto).toBe(1500);
    expect(e.totalSteuer).toBe(94.00); // 81.00 + 13.00
    expect(e.proSatz.find((z) => z.satz === 8.1)!.steuer).toBe(81.00);
    expect(e.proSatz.find((z) => z.satz === 2.6)!.steuer).toBe(13.00);
  });
});

describe('berechneMwst inkl', () => {
  it('108.10 inkl 8.1% -> netto 100.00, steuer 8.10', () => {
    const e = berechneMwst([{ betrag: 108.10, satz: 8.1 }], 'inkl');
    expect(e.totalNetto).toBe(100.00);
    expect(e.totalSteuer).toBe(8.10);
    expect(e.totalBrutto).toBe(108.10);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- mwst` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren** — `src/domain/mwst.ts`

```ts
export function rappenRunden(x: number): number {
  return Math.round(x * 20) / 20;
}

export type MwstZeile = { satz: number; netto: number; steuer: number; brutto: number };
export type MwstErgebnis = { proSatz: MwstZeile[]; totalNetto: number; totalSteuer: number; totalBrutto: number };

export function berechneMwst(positionen: { betrag: number; satz: number }[], modus: 'exkl' | 'inkl'): MwstErgebnis {
  const nettoJeSatz = new Map<number, number>();
  for (const p of positionen) {
    const netto = modus === 'exkl' ? p.betrag : p.betrag * 100 / (100 + p.satz);
    nettoJeSatz.set(p.satz, (nettoJeSatz.get(p.satz) ?? 0) + netto);
  }
  const proSatz: MwstZeile[] = [];
  for (const [satz, nettoRoh] of [...nettoJeSatz.entries()].sort((a, b) => b[0] - a[0])) {
    const netto = rappenRunden(nettoRoh);
    const steuer = rappenRunden(netto * satz / 100);
    proSatz.push({ satz, netto, steuer, brutto: rappenRunden(netto + steuer) });
  }
  const totalNetto = rappenRunden(proSatz.reduce((s, z) => s + z.netto, 0));
  const totalSteuer = rappenRunden(proSatz.reduce((s, z) => s + z.steuer, 0));
  return { proSatz, totalNetto, totalSteuer, totalBrutto: rappenRunden(totalNetto + totalSteuer) };
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- mwst` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mwst): reine MWSt-Engine mit Rappenrundung (0.05)"
```

---

## Task 2: Schema rechnung / rechnungsposition / zaehler

**Files:**
- Create: `db/migrations/005_rechnung.sql`
- Modify: `src/domain/types.ts` (Typen ergänzen)
- Test: über Task 3 (Repo) abgedeckt; hier nur Migration + Typen

**Interfaces:**
- Consumes: `konto`, `mwst_satz`, `projekt`, `auftraggeber` (Plan 1)
- Produces:
  - Typ `RechnungStatus = 'offen_prov' | 'def_vereinbart' | 'abgerechnet' | 'bezahlt' | 'storniert'`
  - Typ `Rechnungsposition = { id: string; rechnungId: string; position: number; beschreibung: string; menge: number; einheit: string; einzelpreis: number; mwstSatz: number; kontoId: string | null; betragNetto: number }`
  - Typ `Rechnung = { id: string; projektId: string; auftraggeberId: string; datum: string; betreff: string | null; mwstModus: 'exkl' | 'inkl'; waehrung: string; lfdNr: number | null; nummer: string | null; status: RechnungStatus; totalNetto: number; totalMwst: number; totalBrutto: number }`

- [ ] **Step 1: Migration schreiben** — `db/migrations/005_rechnung.sql`

```sql
create table rechnung (
  id uuid primary key default gen_random_uuid(),
  projekt_id uuid not null references projekt(id),
  auftraggeber_id uuid not null references auftraggeber(id),
  datum date not null,
  betreff text,
  mwst_modus text not null default 'exkl' check (mwst_modus in ('exkl','inkl')),
  waehrung text not null default 'CHF',
  lfd_nr integer unique,                 -- erst bei Festschreibung vergeben; lueckenlos
  nummer text unique,                    -- Anzeige, z. B. "6231.26 - 33214 ml"
  status text not null default 'offen_prov'
    check (status in ('offen_prov','def_vereinbart','abgerechnet','bezahlt','storniert')),
  total_netto numeric(12,2) not null default 0,
  total_mwst  numeric(12,2) not null default 0,
  total_brutto numeric(12,2) not null default 0,
  erstellt_am timestamptz not null default now(),
  festgeschrieben_am timestamptz
);

create table rechnungsposition (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnung(id) on delete cascade,
  position integer not null,
  beschreibung text not null,
  menge numeric(12,2) not null default 1,
  einheit text not null default 'Pauschal',
  einzelpreis numeric(12,2) not null default 0,
  mwst_satz numeric(5,2) not null,
  konto_id uuid references konto(id),
  betrag_netto numeric(12,2) not null,
  unique (rechnung_id, position)
);

-- Lueckenloser Zaehler (FOR UPDATE gesperrt in der Festschreibungs-Transaktion)
create table zaehler (
  name text primary key,
  wert integer not null
);
insert into zaehler(name, wert) values ('rechnung_lfd_nr', 0);
```

- [ ] **Step 2: Typen ergänzen** — in `src/domain/types.ts` anfügen

```ts
export type RechnungStatus = 'offen_prov' | 'def_vereinbart' | 'abgerechnet' | 'bezahlt' | 'storniert';

export type Rechnungsposition = {
  id: string; rechnungId: string; position: number; beschreibung: string;
  menge: number; einheit: string; einzelpreis: number; mwstSatz: number;
  kontoId: string | null; betragNetto: number;
};

export type Rechnung = {
  id: string; projektId: string; auftraggeberId: string; datum: string;
  betreff: string | null; mwstModus: 'exkl' | 'inkl'; waehrung: string;
  lfdNr: number | null; nummer: string | null; status: RechnungStatus;
  totalNetto: number; totalMwst: number; totalBrutto: number;
};
```

- [ ] **Step 3: Migration anwenden (Nachweis)** — Run: `npm test -- migrate`
Expected: PASS (resetDb wendet auch 005 an, kein Fehler).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(rechnung): Schema rechnung/rechnungsposition/zaehler + Typen"
```

---

## Task 3: rechnungRepo — Draft, Positionen, Totalberechnung

**Files:**
- Create: `src/repos/rechnungRepo.ts`, `test/rechnungRepo.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`, `berechneMwst`, `createAuftraggeber`, `createProjekt`, `createKonto`, alle Plan-1-Repos, `Rechnung`, `Rechnungsposition`, `ValidationError`, `NotFoundError`
- Produces:
  - `createRechnung(pool, input: { projektId: string; auftraggeberId: string; datum: string; betreff?: string|null; mwstModus?: 'exkl'|'inkl'; waehrung?: string }): Promise<Rechnung>` — Status `offen_prov`, Totale 0, `lfdNr`/`nummer` null
  - `addPosition(pool, rechnungId: string, p: { beschreibung: string; menge: number; einheit?: string; einzelpreis: number; mwstSatz: number; kontoId?: string|null }): Promise<Rechnungsposition>` — `position` fortlaufend je Rechnung, `betragNetto = rappenRunden(menge*einzelpreis)`; danach Totale neu berechnen; wirft `ValidationError` wenn Rechnung nicht `offen_prov`/`def_vereinbart`
  - `listPositionen(pool, rechnungId): Promise<Rechnungsposition[]>`
  - `getRechnung(pool, id): Promise<Rechnung>`
  - `recalcTotale(pool, rechnungId): Promise<Rechnung>` — liest Positionen, ruft `berechneMwst`, schreibt Totale

- [ ] **Step 1: Failing test** — `test/rechnungRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, getRechnung } from '../src/repos/rechnungRepo';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('rechnungRepo', () => {
  it('erstellt Draft und berechnet Totale aus Positionen (exkl, Rappenrundung)', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', betreff: 'Verrechnung', mwstModus: 'exkl' });
    expect(r.status).toBe('offen_prov');
    expect(r.lfdNr).toBeNull();

    await addPosition(getPool(), r.id, { beschreibung: '33.5 Std. à 230.00', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' });
    const updated = await getRechnung(getPool(), r.id);
    expect(Number(updated.totalNetto)).toBe(7705);
    expect(Number(updated.totalMwst)).toBe(624.10);
    expect(Number(updated.totalBrutto)).toBe(8329.10);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- rechnungRepo` → FAIL.

- [ ] **Step 3: Implementieren** — `src/repos/rechnungRepo.ts`

```ts
import type pg from 'pg';
import type { Rechnung, Rechnungsposition } from '../domain/types';
import { berechneMwst, rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError } from '../domain/errors';

const mapR = (r: any): Rechnung => ({
  id: r.id, projektId: r.projekt_id, auftraggeberId: r.auftraggeber_id, datum: r.datum,
  betreff: r.betreff, mwstModus: r.mwst_modus, waehrung: r.waehrung,
  lfdNr: r.lfd_nr === null ? null : Number(r.lfd_nr), nummer: r.nummer, status: r.status,
  totalNetto: Number(r.total_netto), totalMwst: Number(r.total_mwst), totalBrutto: Number(r.total_brutto),
});
const mapP = (r: any): Rechnungsposition => ({
  id: r.id, rechnungId: r.rechnung_id, position: r.position, beschreibung: r.beschreibung,
  menge: Number(r.menge), einheit: r.einheit, einzelpreis: Number(r.einzelpreis),
  mwstSatz: Number(r.mwst_satz), kontoId: r.konto_id, betragNetto: Number(r.betrag_netto),
});

export async function createRechnung(pool: pg.Pool, input: { projektId: string; auftraggeberId: string; datum: string; betreff?: string | null; mwstModus?: 'exkl' | 'inkl'; waehrung?: string }): Promise<Rechnung> {
  const r = await pool.query(
    `insert into rechnung(projekt_id,auftraggeber_id,datum,betreff,mwst_modus,waehrung)
     values ($1,$2,$3,$4,coalesce($5,'exkl'),coalesce($6,'CHF')) returning *`,
    [input.projektId, input.auftraggeberId, input.datum, input.betreff ?? null, input.mwstModus ?? null, input.waehrung ?? null]);
  return mapR(r.rows[0]);
}

export async function getRechnung(pool: pg.Pool, id: string): Promise<Rechnung> {
  const r = await pool.query('select * from rechnung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Rechnung ${id} nicht gefunden`);
  return mapR(r.rows[0]);
}

export async function listPositionen(pool: pg.Pool, rechnungId: string): Promise<Rechnungsposition[]> {
  const r = await pool.query('select * from rechnungsposition where rechnung_id=$1 order by position', [rechnungId]);
  return r.rows.map(mapP);
}

export async function recalcTotale(pool: pg.Pool, rechnungId: string): Promise<Rechnung> {
  const rechnung = await getRechnung(pool, rechnungId);
  const pos = await listPositionen(pool, rechnungId);
  const e = berechneMwst(pos.map((p) => ({ betrag: p.betragNetto, satz: p.mwstSatz })), rechnung.mwstModus);
  const upd = await pool.query(
    'update rechnung set total_netto=$2,total_mwst=$3,total_brutto=$4 where id=$1 returning *',
    [rechnungId, e.totalNetto, e.totalSteuer, e.totalBrutto]);
  return mapR(upd.rows[0]);
}

export async function addPosition(pool: pg.Pool, rechnungId: string, p: { beschreibung: string; menge: number; einheit?: string; einzelpreis: number; mwstSatz: number; kontoId?: string | null }): Promise<Rechnungsposition> {
  const rechnung = await getRechnung(pool, rechnungId);
  if (rechnung.status !== 'offen_prov' && rechnung.status !== 'def_vereinbart') {
    throw new ValidationError(`Positionen nur im Entwurf editierbar (Status ${rechnung.status})`);
  }
  const betragNetto = rappenRunden(p.menge * p.einzelpreis);
  const r = await pool.query(
    `insert into rechnungsposition(rechnung_id,position,beschreibung,menge,einheit,einzelpreis,mwst_satz,konto_id,betrag_netto)
     values ($1,(select coalesce(max(position),0)+1 from rechnungsposition where rechnung_id=$1),$2,$3,coalesce($4,'Pauschal'),$5,$6,$7,$8) returning *`,
    [rechnungId, p.beschreibung, p.menge, p.einheit ?? null, p.einzelpreis, p.mwstSatz, p.kontoId ?? null, betragNetto]);
  await recalcTotale(pool, rechnungId);
  return mapP(r.rows[0]);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- rechnungRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rechnung): Draft + Positionen + Totalberechnung via MWSt-Engine"
```

---

## Task 4: Festschreibung mit lückenloser Nummer (Transaktion + Zähler)

**Files:**
- Modify: `src/repos/rechnungRepo.ts`
- Create: `test/rechnungFestschreibung.test.ts`

**Interfaces:**
- Consumes: `getRechnung`, `projektRepo.getProjektById`
- Produces:
  - `festschreiben(pool, rechnungId: string, erstellerKuerzel?: string): Promise<Rechnung>` — nur aus `offen_prov`/`def_vereinbart`; in **einer Transaktion**: `zaehler` per `for update` sperren, `wert+1` = neue `lfdNr`, `nummer = "{projekt.nummer} - {lfdNr}[ {kuerzel}]"`, Status→`abgerechnet`, `festgeschrieben_am=now()`. Wirft `ValidationError` bei falschem Status oder 0 Positionen.

- [ ] **Step 1: Failing test** — `test/rechnungFestschreibung.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, getRechnung } from '../src/repos/rechnungRepo';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function draftMitPosition(): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
  return r.id;
}

describe('festschreiben', () => {
  it('vergibt lückenlose lfdNr und baut nummer', async () => {
    const a = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    const b = await festschreiben(getPool(), await draftMitPosition(), 'ml');
    expect(a.lfdNr).toBe(1);
    expect(b.lfdNr).toBe(2);
    expect(a.status).toBe('abgerechnet');
    expect(a.nummer).toBe('6231.26 - 1 ml');
    expect(b.nummer).toBe('6231.26 - 2 ml');
  });
  it('verweigert Festschreibung ohne Positionen', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(festschreiben(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
  });
  it('verweigert Positionsänderung nach Festschreibung', async () => {
    const id = await draftMitPosition();
    await festschreiben(getPool(), id);
    await expect(addPosition(getPool(), id, { beschreibung: 'Y', menge: 1, einzelpreis: 1, mwstSatz: 8.1 }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- rechnungFestschreibung` → FAIL.

- [ ] **Step 3: Implementieren** — an `src/repos/rechnungRepo.ts` anfügen

```ts
import { getProjektById } from './projektRepo';

export async function festschreiben(pool: pg.Pool, rechnungId: string, erstellerKuerzel?: string): Promise<Rechnung> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rr = await client.query('select * from rechnung where id=$1 for update', [rechnungId]);
    if (!rr.rowCount) throw new NotFoundError(`Rechnung ${rechnungId} nicht gefunden`);
    const rechnung = mapR(rr.rows[0]);
    if (rechnung.status !== 'offen_prov' && rechnung.status !== 'def_vereinbart') {
      throw new ValidationError(`Festschreibung nur aus Entwurf (Status ${rechnung.status})`);
    }
    const pc = await client.query('select count(*)::int as n from rechnungsposition where rechnung_id=$1', [rechnungId]);
    if (pc.rows[0].n === 0) throw new ValidationError('Rechnung ohne Positionen kann nicht festgeschrieben werden');

    // Lueckenloser Zaehler: Sperre haelt bis commit/rollback -> bei Fehler keine Luecke
    const z = await client.query(`update zaehler set wert = wert + 1 where name='rechnung_lfd_nr' returning wert`);
    const lfdNr: number = z.rows[0].wert;

    const projekt = await getProjektById(pool, rechnung.projektId);
    const nummer = `${projekt.nummer} - ${lfdNr}${erstellerKuerzel ? ' ' + erstellerKuerzel : ''}`;

    const upd = await client.query(
      `update rechnung set lfd_nr=$2, nummer=$3, status='abgerechnet', festgeschrieben_am=now() where id=$1 returning *`,
      [rechnungId, lfdNr, nummer]);
    await client.query('commit');
    return mapR(upd.rows[0]);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
```

> **Hinweis Zähler-Sperre:** `update zaehler ... returning` nimmt eine Row-Lock; parallele Festschreibungen serialisieren sich, ein Rollback macht das `+1` rückgängig → strikt lückenlos.

- [ ] **Step 4: Verify pass** — Run: `npm test -- rechnungFestschreibung` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rechnung): Festschreibung mit lueckenloser Nummer (Transaktion+Zaehler)"
```

---

## Task 5: Status-Übergänge (def. vereinbart, Storno)

**Files:**
- Modify: `src/repos/rechnungRepo.ts`
- Create: `test/rechnungStatus.test.ts`

**Interfaces:**
- Consumes: `getRechnung`
- Produces:
  - `setDefVereinbart(pool, id): Promise<Rechnung>` — nur aus `offen_prov`
  - `stornieren(pool, id, grund?: string): Promise<Rechnung>` — nur aus `abgerechnet`/`bezahlt`; Status→`storniert` (Nummer bleibt erhalten, keine Löschung → Lückenfreiheit)
  - beide werfen `ValidationError` bei unzulässigem Ausgangsstatus

- [ ] **Step 1: Failing test** — `test/rechnungStatus.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, setDefVereinbart, stornieren } from '../src/repos/rechnungRepo';
import { ValidationError } from '../src/domain/errors';

let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

describe('status-übergänge', () => {
  it('offen_prov -> def_vereinbart', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    const d = await setDefVereinbart(getPool(), r.id);
    expect(d.status).toBe('def_vereinbart');
  });
  it('abgerechnet -> storniert behält Nummer', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 100, mwstSatz: 8.1 });
    const fg = await festschreiben(getPool(), r.id, 'ml');
    const st = await stornieren(getPool(), r.id);
    expect(st.status).toBe('storniert');
    expect(st.nummer).toBe(fg.nummer); // Nummer bleibt -> keine Lücke
  });
  it('Storno aus Entwurf verboten', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(stornieren(getPool(), r.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- rechnungStatus` → FAIL.

- [ ] **Step 3: Implementieren** — an `src/repos/rechnungRepo.ts` anfügen

```ts
export async function setDefVereinbart(pool: pg.Pool, id: string): Promise<Rechnung> {
  const r = await getRechnung(pool, id);
  if (r.status !== 'offen_prov') throw new ValidationError(`def_vereinbart nur aus offen_prov (Status ${r.status})`);
  const upd = await pool.query(`update rechnung set status='def_vereinbart' where id=$1 returning *`, [id]);
  return mapR(upd.rows[0]);
}

export async function stornieren(pool: pg.Pool, id: string, grund?: string): Promise<Rechnung> {
  const r = await getRechnung(pool, id);
  if (r.status !== 'abgerechnet' && r.status !== 'bezahlt') {
    throw new ValidationError(`Storno nur aus abgerechnet/bezahlt (Status ${r.status})`);
  }
  const upd = await pool.query(`update rechnung set status='storniert' where id=$1 returning *`, [id]);
  return mapR(upd.rows[0]);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- rechnungStatus` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rechnung): Status-Uebergaenge def_vereinbart + Storno"
```

---

## Task 6: REST-Routen Rechnung

**Files:**
- Create: `src/server/routes/rechnung.ts`
- Modify: `src/server/app.ts` (Registrierung)
- Create: `test/rechnungRoutes.test.ts`

**Interfaces:**
- Consumes: `buildApp`, `rechnungRepo.*`, `requireAdmin`
- Produces:
  - `registerRechnungRoutes(app, pool)`:
    - `POST /rechnung` (Admin) → 201 Draft
    - `POST /rechnung/:id/position` (Admin) → 201 Position
    - `POST /rechnung/:id/festschreiben` (Admin) → 200 festgeschriebene Rechnung
    - `GET /rechnung/:id` → Rechnung + Positionen `{ ...rechnung, positionen }`
  - Fehler-Mapping `ValidationError→400`, `NotFoundError→404`

- [ ] **Step 1: Failing test** — `test/rechnungRoutes.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let projektId: string; let auftraggeberId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('rechnung-routes', () => {
  it('Draft -> Position -> Festschreiben ergibt Nummer und Totale', async () => {
    const c = await app.inject({ method: 'POST', url: '/rechnung', headers: admin,
      payload: { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' } });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;

    const p = await app.inject({ method: 'POST', url: `/rechnung/${id}/position`, headers: admin,
      payload: { beschreibung: '33.5 Std', menge: 33.5, einzelpreis: 230, mwstSatz: 8.1, einheit: 'Std' } });
    expect(p.statusCode).toBe(201);

    const f = await app.inject({ method: 'POST', url: `/rechnung/${id}/festschreiben`, headers: admin,
      payload: { erstellerKuerzel: 'ml' } });
    expect(f.statusCode).toBe(200);
    expect(f.json().nummer).toBe('6231.26 - 1 ml');
    expect(Number(f.json().totalBrutto)).toBe(8329.10);

    const g = await app.inject({ method: 'GET', url: `/rechnung/${id}` });
    expect(g.json().positionen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- rechnungRoutes` → FAIL.

- [ ] **Step 3: Implementieren** — `src/server/routes/rechnung.ts`

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createRechnung, addPosition, festschreiben, getRechnung, listPositionen } from '../../repos/rechnungRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';

function mapErr(reply: any, e: unknown): never | any {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

export function registerRechnungRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/rechnung', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createRechnung(pool, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.post('/rechnung/:id/position', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await addPosition(pool, (req.params as any).id, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.post('/rechnung/:id/festschreiben', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.send(await festschreiben(pool, (req.params as any).id, (req.body as any)?.erstellerKuerzel)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/rechnung/:id', async (req, reply) => {
    try {
      const id = (req.params as any).id;
      const rechnung = await getRechnung(pool, id);
      return { ...rechnung, positionen: await listPositionen(pool, id) };
    } catch (e) { return mapErr(reply, e); }
  });
}
```

`src/server/app.ts` — Import + Registrierung ergänzen (analog zu Plan 1):
```ts
import { registerRechnungRoutes } from './routes/rechnung';
// ... vor `return app;`:
  registerRechnungRoutes(app, pool);
```

- [ ] **Step 4: Verify pass** — Run: `npm test` (alle) → PASS. Danach `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): Rechnungs-Routen (Draft/Position/Festschreiben/Get)"
```

---

## Self-Review (gegen Spec)

- **Spec-Abdeckung:** §4.3 Rechnung (Status, lfdNr, nummer, Totale) ✓, §4.4 Rechnungsposition (Menge/Einzelpreis/Satz/Konto/Netto) ✓, §5.2 Verrechnung (Draft→Position→Festschreibung, Nummernbildung) ✓, §5.3 MWSt je Posten + Rappenrundung + mehrsatzig + exkl/inkl ✓, §6.1 lückenlose/unveränderliche Nummer (Zähler+Transaktion, Storno statt Löschung) ✓, §6.4 Festschreibung friert ein (addPosition blockiert nach abgerechnet) ✓. QR-Referenz/PDF bewusst Plan 3; `konto_id` je Position vorhanden (Kontierung), Zahlungseingang/Saldo Plan 4.
- **Platzhalter:** keine.
- **Typ-Konsistenz:** `Rechnung/Rechnungsposition/RechnungStatus` zentral in `types.ts`; Repo-Signaturen (`createRechnung/addPosition/getRechnung/festschreiben/setDefVereinbart/stornieren/listPositionen/recalcTotale`) in allen Tasks deckungsgleich; MWSt-Engine liefert `totalSteuer`, in `recalcTotale` auf Spalte `total_mwst` gemappt (bewusst; Feldname DB = mwst, Engine = steuer).

## Offene Punkte
- **Rundungsregel 0.05** ist gegen den Golden-Beleg in **Plan 3** final zu bestätigen (alternativ 0.01 kaufmännisch).
- **Zähler-Startwert** für lückenlose Fortführung der FileMaker-Nummern wird in **Plan 5 (Migration)** gesetzt.
- `inkl`-Modus: Rundung des rückgerechneten Nettos je Satz — in Plan 3 am Beleg prüfen.

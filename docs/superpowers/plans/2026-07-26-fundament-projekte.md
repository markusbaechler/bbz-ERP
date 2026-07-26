# Fundament & Projekte — Implementation Plan (Plan 1 von 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lauffähiges, getestetes Backend-Fundament mit Postgres-Schema, Stammdaten (Konto, MWSt-Satz), Auftraggeber und Projekten inkl. korrekter Kontierung — als Basis für die späteren Verrechnungs-/Debitoren-Pläne.

**Architecture:** TypeScript-Node-Backend (Fastify) über PostgreSQL. Datenzugriff in dünnen Repository-Funktionen (Adapter-Muster → spätere DB-Portabilität). SQL-Migrationen als versionierte Dateien. TDD durchgängig mit vitest gegen eine echte (lokale Docker-)Postgres.

**Tech Stack:** Node ≥ 20, TypeScript, Fastify, `pg`, `vitest`, Docker-Compose (lokale Postgres), Ziel-Hosting Azure Database for PostgreSQL (Switzerland North).

## Global Constraints

- **Datenstandort Schweiz** — Prod-DB in Azure Region *Switzerland North*; lokal nur Testdaten. (Spec §3, §8)
- **Rechnungsnummerierung strikt lückenlos/unveränderlich** — betrifft Plan 2, aber Schema-Entscheide hier dürfen dem nicht widersprechen (Sequenzen, keine harten Löschungen von Finanzdaten). (Spec §6.1)
- **Beträge** `numeric(12,2)`, **MWSt-Sätze** `numeric(5,2)`. (Spec §4)
- **Auftraggeber-Adresse vollständig** (Strasse/PLZ/Ort/Land Pflicht) — behebt QR-Lücke. (Spec §4.1, §5.4)
- **Rollen** Admin/Standard; Finanzoperationen serverseitig validiert. (Spec §3, §8)
- **Sprache:** fachliche Bezeichner deutsch, „ss" statt „ß".
- **Portabilität:** aller DB-Zugriff nur über `src/repos/*` (kein SQL in Routen/Domain). (Spec §3.1)

---

## Dateistruktur (in diesem Plan angelegt/berührt)

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example, docker-compose.yml
db/migrations/001_init.sql
db/migrations/002_stammdaten.sql
db/migrations/003_auftraggeber.sql
db/migrations/004_projekt.sql
src/db/pool.ts            # pg-Pool aus DATABASE_URL
src/db/migrate.ts         # wendet db/migrations/*.sql sortiert an
src/domain/types.ts       # Domänentypen (Konto, MwstSatz, Auftraggeber, Projekt)
src/domain/errors.ts      # ValidationError, NotFoundError
src/repos/kontoRepo.ts
src/repos/mwstSatzRepo.ts
src/repos/auftraggeberRepo.ts
src/repos/projektRepo.ts
src/server/app.ts         # buildApp(pool) -> Fastify
src/server/auth.ts        # requireRole(...)
src/server/routes/auftraggeber.ts
src/server/routes/projekt.ts
test/helpers/db.ts        # Test-DB Setup/Reset
test/*.test.ts
```

---

## Task 1: Projekt-Scaffold & Toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`
- Create: `src/smoke.ts`, `test/smoke.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `sum(a: number, b: number): number` (nur Toolchain-Nachweis; später entfernbar)

- [ ] **Step 1: Failing test schreiben** — `test/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sum } from '../src/smoke';

describe('toolchain', () => {
  it('addiert', () => {
    expect(sum(2, 3)).toBe(5);
  });
});
```

- [ ] **Step 2: Konfig-Dateien anlegen**

`package.json`:
```json
{
  "name": "bbz-projekte",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "tsx src/db/migrate.ts",
    "dev": "tsx watch src/server/main.ts"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "pg": "^8.12.0",
    "swissqrbill": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.6",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], fileParallelism: false, hookTimeout: 30000 },
});
```

`.gitignore`:
```
node_modules/
dist/
.env
```

`.env.example`:
```
DATABASE_URL=postgres://bbz:bbz@localhost:5433/bbz_test
```

`docker-compose.yml` (lokale Test-Postgres, Port 5433 um Kollisionen zu vermeiden):
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: bbz
      POSTGRES_PASSWORD: bbz
      POSTGRES_DB: bbz_test
    ports: ["5433:5432"]
```

`src/smoke.ts`:
```ts
export function sum(a: number, b: number): number {
  return a + b;
}
```

- [ ] **Step 3: Abhängigkeiten installieren & DB starten**

Run: `npm install && docker compose up -d`
Expected: Install ok; Container `db` läuft (`docker compose ps` zeigt „running").

- [ ] **Step 4: Test läuft grün**

Run: `npm test`
Expected: PASS (1 Test).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold TS/Fastify/pg/vitest + lokale Postgres"
```

---

## Task 2: DB-Pool & Migrations-Runner

**Files:**
- Create: `src/db/pool.ts`, `src/db/migrate.ts`, `db/migrations/001_init.sql`
- Create: `test/helpers/db.ts`, `test/migrate.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` (env)
- Produces:
  - `getPool(): Pool` — Singleton `pg.Pool`
  - `closePool(): Promise<void>`
  - `runMigrations(pool: Pool): Promise<void>` — wendet `db/migrations/*.sql` in Dateinamens-Sortierung an, idempotent über Tabelle `schema_migrations(version text primary key)`
  - `resetDb(pool: Pool): Promise<void>` (Test-Helper) — droppt `public`-Schema neu und migriert

- [ ] **Step 1: Failing test** — `test/migrate.test.ts`

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { resetDb } from './helpers/db';

afterAll(async () => { await closePool(); });

describe('migrations', () => {
  it('legt schema_migrations an und ist idempotent', async () => {
    const pool = getPool();
    await resetDb(pool);
    await runMigrations(pool); // zweiter Lauf darf nicht crashen
    const r = await pool.query('select count(*)::int as n from schema_migrations');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `npm test -- migrate`
Expected: FAIL (Module `src/db/pool` fehlt).

- [ ] **Step 3: Implementieren**

`src/db/pool.ts`:
```ts
import pg from 'pg';
let pool: pg.Pool | undefined;
export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}
export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = undefined; }
}
```

`src/db/migrate.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz default now())');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('select 1 from schema_migrations where version=$1', [file]);
    if (done.rowCount) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(version) values ($1)', [file]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; }
    finally { client.release(); }
  }
}

// CLI: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getPool, closePool } = await import('./pool.js');
  await runMigrations(getPool());
  await closePool();
  console.log('migrations applied');
}
```

`db/migrations/001_init.sql`:
```sql
create extension if not exists "pgcrypto"; -- gen_random_uuid()
```

`test/helpers/db.ts`:
```ts
import type pg from 'pg';
import { runMigrations } from '../../src/db/migrate';
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema public cascade; create schema public;');
  await runMigrations(pool);
}
```

- [ ] **Step 4: Verify pass**

Run: `npm test -- migrate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): Pool + idempotenter Migrations-Runner"
```

---

## Task 3: Stammdaten-Schema & KontoRepo

**Files:**
- Create: `db/migrations/002_stammdaten.sql`, `src/domain/types.ts`, `src/domain/errors.ts`, `src/repos/kontoRepo.ts`
- Create: `test/kontoRepo.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`
- Produces:
  - Typ `Konto = { id: string; nummer: string; bezeichnung: string; typ: 'Ertrag'|'Aufwand'; aktiv: boolean }`
  - `class ValidationError extends Error`, `class NotFoundError extends Error`
  - `createKonto(pool, input: { nummer: string; bezeichnung: string; typ: 'Ertrag'|'Aufwand' }): Promise<Konto>`
  - `listKonten(pool): Promise<Konto[]>`
  - `getKontoById(pool, id: string): Promise<Konto>` (wirft `NotFoundError`)

- [ ] **Step 1: Failing test** — `test/kontoRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createKonto, listKonten, getKontoById } from '../src/repos/kontoRepo';
import { NotFoundError } from '../src/domain/errors';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('kontoRepo', () => {
  it('legt Konto an und liest es', async () => {
    const pool = getPool();
    const k = await createKonto(pool, { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' });
    expect(k.id).toBeTruthy();
    expect(k.aktiv).toBe(true);
    const again = await getKontoById(pool, k.id);
    expect(again.nummer).toBe('3100');
    expect((await listKonten(pool)).length).toBe(1);
  });
  it('wirft NotFoundError bei unbekannter id', async () => {
    await expect(getKontoById(getPool(), '00000000-0000-0000-0000-000000000000'))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- kontoRepo` → FAIL.

- [ ] **Step 3: Implementieren**

`db/migrations/002_stammdaten.sql`:
```sql
create table konto (
  id uuid primary key default gen_random_uuid(),
  nummer text not null unique,
  bezeichnung text not null,
  typ text not null check (typ in ('Ertrag','Aufwand')),
  aktiv boolean not null default true
);

create table mwst_satz (
  id uuid primary key default gen_random_uuid(),
  satz numeric(5,2) not null,
  bezeichnung text not null,
  gueltig_ab date not null,
  gueltig_bis date
);
```

`src/domain/errors.ts`:
```ts
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
```

`src/domain/types.ts`:
```ts
export type Konto = { id: string; nummer: string; bezeichnung: string; typ: 'Ertrag'|'Aufwand'; aktiv: boolean };
export type MwstSatz = { id: string; satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string|null };
export type Auftraggeber = {
  id: string; nummer: string|null; name: string;
  strasse: string; plz: string; ort: string; land: string;
  ansprechperson: string|null; email: string|null; telefon: string|null; aktiv: boolean;
};
export type Projekt = {
  id: string; nummer: string; basisnummer: number; jahr: number;
  kuerzel: string|null; name: string; bereich: string|null;
  auftraggeberId: string; ertragskontoId: string|null;
  budgetChf: number|null; budgetTage: number|null; mwstModus: 'exkl'|'inkl';
  fortsetzungVonId: string|null;
};
```

`src/repos/kontoRepo.ts`:
```ts
import type pg from 'pg';
import type { Konto } from '../domain/types';
import { NotFoundError } from '../domain/errors';

const map = (r: any): Konto => ({ id: r.id, nummer: r.nummer, bezeichnung: r.bezeichnung, typ: r.typ, aktiv: r.aktiv });

export async function createKonto(pool: pg.Pool, input: { nummer: string; bezeichnung: string; typ: 'Ertrag'|'Aufwand' }): Promise<Konto> {
  const r = await pool.query(
    'insert into konto(nummer,bezeichnung,typ) values ($1,$2,$3) returning *',
    [input.nummer, input.bezeichnung, input.typ]);
  return map(r.rows[0]);
}
export async function listKonten(pool: pg.Pool): Promise<Konto[]> {
  const r = await pool.query('select * from konto order by nummer');
  return r.rows.map(map);
}
export async function getKontoById(pool: pg.Pool, id: string): Promise<Konto> {
  const r = await pool.query('select * from konto where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Konto ${id} nicht gefunden`);
  return map(r.rows[0]);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- kontoRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(stammdaten): Konto-Schema + kontoRepo"
```

---

## Task 4: MwstSatzRepo mit Gültigkeits-Lookup

**Files:**
- Create: `src/repos/mwstSatzRepo.ts`, `test/mwstSatzRepo.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`, `MwstSatz`
- Produces:
  - `createMwstSatz(pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string|null }): Promise<MwstSatz>`
  - `findGueltigenSatz(pool, satz: number, datum: string): Promise<MwstSatz>` — der am `datum` gültige Eintrag mit diesem Prozentsatz (wirft `NotFoundError`)

- [ ] **Step 1: Failing test** — `test/mwstSatzRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createMwstSatz, findGueltigenSatz } from '../src/repos/mwstSatzRepo';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('mwstSatzRepo', () => {
  it('findet den am Datum gültigen Satz (7.7 -> 8.1 Wechsel)', async () => {
    const pool = getPool();
    await createMwstSatz(pool, { satz: 7.7, bezeichnung: 'Normal', gueltigAb: '2018-01-01', gueltigBis: '2023-12-31' });
    await createMwstSatz(pool, { satz: 8.1, bezeichnung: 'Normal', gueltigAb: '2024-01-01', gueltigBis: null });
    const s = await findGueltigenSatz(pool, 8.1, '2026-07-23');
    expect(s.satz).toBe(8.1);
    expect(s.gueltigBis).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- mwstSatzRepo` → FAIL.

- [ ] **Step 3: Implementieren** — `src/repos/mwstSatzRepo.ts`

```ts
import type pg from 'pg';
import type { MwstSatz } from '../domain/types';
import { NotFoundError } from '../domain/errors';

const map = (r: any): MwstSatz => ({
  id: r.id, satz: Number(r.satz), bezeichnung: r.bezeichnung,
  gueltigAb: r.gueltig_ab.toISOString().slice(0,10),
  gueltigBis: r.gueltig_bis ? r.gueltig_bis.toISOString().slice(0,10) : null,
});

export async function createMwstSatz(pool: pg.Pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string|null }): Promise<MwstSatz> {
  const r = await pool.query(
    'insert into mwst_satz(satz,bezeichnung,gueltig_ab,gueltig_bis) values ($1,$2,$3,$4) returning *',
    [input.satz, input.bezeichnung, input.gueltigAb, input.gueltigBis ?? null]);
  return map(r.rows[0]);
}
export async function findGueltigenSatz(pool: pg.Pool, satz: number, datum: string): Promise<MwstSatz> {
  const r = await pool.query(
    `select * from mwst_satz where satz=$1 and gueltig_ab<=$2 and (gueltig_bis is null or gueltig_bis>=$2) limit 1`,
    [satz, datum]);
  if (!r.rowCount) throw new NotFoundError(`Kein MWSt-Satz ${satz} gültig am ${datum}`);
  return map(r.rows[0]);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- mwstSatzRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(stammdaten): mwstSatzRepo mit Gueltigkeits-Lookup"
```

---

## Task 5: AuftraggeberRepo mit Pflicht-Adresse

**Files:**
- Create: `db/migrations/003_auftraggeber.sql`, `src/repos/auftraggeberRepo.ts`, `test/auftraggeberRepo.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`, `Auftraggeber`, `ValidationError`, `NotFoundError`
- Produces:
  - `createAuftraggeber(pool, input: { nummer?: string|null; name: string; strasse: string; plz: string; ort: string; land?: string; ansprechperson?: string|null; email?: string|null; telefon?: string|null }): Promise<Auftraggeber>` — wirft `ValidationError` wenn `name/strasse/plz/ort` leer
  - `getAuftraggeberById(pool, id): Promise<Auftraggeber>`
  - `listAuftraggeber(pool): Promise<Auftraggeber[]>`

- [ ] **Step 1: Failing test** — `test/auftraggeberRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber, getAuftraggeberById } from '../src/repos/auftraggeberRepo';
import { ValidationError } from '../src/domain/errors';

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('auftraggeberRepo', () => {
  it('legt Auftraggeber mit vollständiger Adresse an', async () => {
    const a = await createAuftraggeber(getPool(), {
      nummer: '20577', name: 'Urner Kantonalbank',
      strasse: 'Bahnhofstrasse 1', plz: '6460', ort: 'Altdorf',
    });
    expect(a.land).toBe('CH');
    const again = await getAuftraggeberById(getPool(), a.id);
    expect(again.name).toBe('Urner Kantonalbank');
  });
  it('verweigert unvollständige Adresse', async () => {
    await expect(createAuftraggeber(getPool(), {
      name: 'Ohne Ort', strasse: 'X', plz: '', ort: '',
    })).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- auftraggeberRepo` → FAIL.

- [ ] **Step 3: Implementieren**

`db/migrations/003_auftraggeber.sql`:
```sql
create table auftraggeber (
  id uuid primary key default gen_random_uuid(),
  nummer text unique,
  name text not null,
  strasse text not null,
  plz text not null,
  ort text not null,
  land text not null default 'CH',
  ansprechperson text,
  email text,
  telefon text,
  aktiv boolean not null default true
);
```

`src/repos/auftraggeberRepo.ts`:
```ts
import type pg from 'pg';
import type { Auftraggeber } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Auftraggeber => ({
  id: r.id, nummer: r.nummer, name: r.name, strasse: r.strasse, plz: r.plz, ort: r.ort,
  land: r.land, ansprechperson: r.ansprechperson, email: r.email, telefon: r.telefon, aktiv: r.aktiv,
});

export async function createAuftraggeber(pool: pg.Pool, input: {
  nummer?: string|null; name: string; strasse: string; plz: string; ort: string;
  land?: string; ansprechperson?: string|null; email?: string|null; telefon?: string|null;
}): Promise<Auftraggeber> {
  for (const f of ['name','strasse','plz','ort'] as const) {
    if (!input[f] || !String(input[f]).trim()) throw new ValidationError(`Feld ${f} ist Pflicht`);
  }
  const r = await pool.query(
    `insert into auftraggeber(nummer,name,strasse,plz,ort,land,ansprechperson,email,telefon)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [input.nummer ?? null, input.name, input.strasse, input.plz, input.ort, input.land ?? 'CH',
     input.ansprechperson ?? null, input.email ?? null, input.telefon ?? null]);
  return map(r.rows[0]);
}
export async function getAuftraggeberById(pool: pg.Pool, id: string): Promise<Auftraggeber> {
  const r = await pool.query('select * from auftraggeber where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Auftraggeber ${id} nicht gefunden`);
  return map(r.rows[0]);
}
export async function listAuftraggeber(pool: pg.Pool): Promise<Auftraggeber[]> {
  const r = await pool.query('select * from auftraggeber order by name');
  return r.rows.map(map);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- auftraggeberRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(stammdaten): auftraggeberRepo mit Pflicht-Adresse"
```

---

## Task 6: ProjektRepo mit Nummernschema & Kontierung

**Files:**
- Create: `db/migrations/004_projekt.sql`, `src/repos/projektRepo.ts`, `test/projektRepo.test.ts`

**Interfaces:**
- Consumes: `getPool`, `resetDb`, `Projekt`, `createAuftraggeber`, `createKonto`, `ValidationError`, `NotFoundError`
- Produces:
  - `createProjekt(pool, input: { basisnummer: number; jahr: number; name: string; auftraggeberId: string; ertragskontoId?: string|null; kuerzel?: string|null; bereich?: string|null; budgetChf?: number|null; budgetTage?: number|null; mwstModus?: 'exkl'|'inkl'; fortsetzungVonId?: string|null }): Promise<Projekt>` — `nummer` = `${basisnummer}.${String(jahr).slice(-2)}`; wirft `ValidationError` bei fehlendem `name/auftraggeberId`
  - `getProjektById(pool, id): Promise<Projekt>`
  - `listProjekte(pool, filter?: { jahr?: number; auftraggeberId?: string }): Promise<Projekt[]>`

- [ ] **Step 1: Failing test** — `test/projektRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createKonto } from '../src/repos/kontoRepo';
import { createProjekt, getProjektById, listProjekte } from '../src/repos/projektRepo';

let auftraggeberId: string; let kontoId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'bbz st.gallen ag', strasse: 'Zürcherstrasse 202', plz: '9014', ort: 'St. Gallen' })).id;
  kontoId = (await createKonto(getPool(), { nummer: '3100', bezeichnung: 'Seminarertrag', typ: 'Ertrag' })).id;
});
afterAll(async () => { await closePool(); });

describe('projektRepo', () => {
  it('bildet nummer als basisnummer.jahr und speichert Kontierung', async () => {
    const p = await createProjekt(getPool(), {
      basisnummer: 6231, jahr: 2026, name: 'Ausgaben/Einnahmen bbz', auftraggeberId,
      ertragskontoId: kontoId, budgetChf: 24600, budgetTage: 2.5,
    });
    expect(p.nummer).toBe('6231.26');
    expect(p.mwstModus).toBe('exkl');
    const again = await getProjektById(getPool(), p.id);
    expect(again.ertragskontoId).toBe(kontoId);
    expect(Number(again.budgetChf)).toBe(24600);
  });
  it('filtert nach Jahr', async () => {
    await createProjekt(getPool(), { basisnummer: 7575, jahr: 2025, name: 'Altprojekt', auftraggeberId });
    const y26 = await listProjekte(getPool(), { jahr: 2026 });
    expect(y26.every(p => p.jahr === 2026)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- projektRepo` → FAIL.

- [ ] **Step 3: Implementieren**

`db/migrations/004_projekt.sql`:
```sql
create table projekt (
  id uuid primary key default gen_random_uuid(),
  nummer text not null,
  basisnummer integer not null,
  jahr integer not null,
  kuerzel text,
  name text not null,
  bereich text,
  auftraggeber_id uuid not null references auftraggeber(id),
  ertragskonto_id uuid references konto(id),
  budget_chf numeric(12,2),
  budget_tage numeric(6,2),
  mwst_modus text not null default 'exkl' check (mwst_modus in ('exkl','inkl')),
  fortsetzung_von_id uuid references projekt(id),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (basisnummer, jahr)
);
create index projekt_jahr_idx on projekt(jahr);
create index projekt_auftraggeber_idx on projekt(auftraggeber_id);
```

`src/repos/projektRepo.ts`:
```ts
import type pg from 'pg';
import type { Projekt } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Projekt => ({
  id: r.id, nummer: r.nummer, basisnummer: r.basisnummer, jahr: r.jahr,
  kuerzel: r.kuerzel, name: r.name, bereich: r.bereich,
  auftraggeberId: r.auftraggeber_id, ertragskontoId: r.ertragskonto_id,
  budgetChf: r.budget_chf === null ? null : Number(r.budget_chf),
  budgetTage: r.budget_tage === null ? null : Number(r.budget_tage),
  mwstModus: r.mwst_modus, fortsetzungVonId: r.fortsetzung_von_id,
});

export async function createProjekt(pool: pg.Pool, input: {
  basisnummer: number; jahr: number; name: string; auftraggeberId: string;
  ertragskontoId?: string|null; kuerzel?: string|null; bereich?: string|null;
  budgetChf?: number|null; budgetTage?: number|null; mwstModus?: 'exkl'|'inkl'; fortsetzungVonId?: string|null;
}): Promise<Projekt> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.basisnummer}.${String(input.jahr).slice(-2)}`;
  const r = await pool.query(
    `insert into projekt(nummer,basisnummer,jahr,name,auftraggeber_id,ertragskonto_id,kuerzel,bereich,budget_chf,budget_tage,mwst_modus,fortsetzung_von_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'exkl'),$12) returning *`,
    [nummer, input.basisnummer, input.jahr, input.name, input.auftraggeberId,
     input.ertragskontoId ?? null, input.kuerzel ?? null, input.bereich ?? null,
     input.budgetChf ?? null, input.budgetTage ?? null, input.mwstModus ?? null, input.fortsetzungVonId ?? null]);
  return map(r.rows[0]);
}
export async function getProjektById(pool: pg.Pool, id: string): Promise<Projekt> {
  const r = await pool.query('select * from projekt where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  return map(r.rows[0]);
}
export async function listProjekte(pool: pg.Pool, filter: { jahr?: number; auftraggeberId?: string } = {}): Promise<Projekt[]> {
  const cond: string[] = []; const args: any[] = [];
  if (filter.jahr !== undefined) { args.push(filter.jahr); cond.push(`jahr=$${args.length}`); }
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); cond.push(`auftraggeber_id=$${args.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  const r = await pool.query(`select * from projekt ${where} order by nummer`, args);
  return r.rows.map(map);
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- projektRepo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(projekt): projektRepo mit Nummernschema und Kontierung"
```

---

## Task 7: Fastify-App & Rollen-Guard

**Files:**
- Create: `src/server/app.ts`, `src/server/auth.ts`, `src/server/main.ts`, `test/auth.test.ts`

**Interfaces:**
- Consumes: `getPool`, `Pool`
- Produces:
  - `buildApp(pool: pg.Pool): FastifyInstance` — registriert Auth-Hook + Routen (Routen in Task 8)
  - Auth-Hook liest Rolle aus Header `x-user-role` (`admin`|`standard`) und legt `req.rolle` ab. **Hinweis:** Platzhalter für Entra-ID/MSAL — echte Token-Verifikation kommt in einem späteren Härtungs-Task (Spec §3). Ohne Header → `req.rolle='standard'`.
  - `requireAdmin(req, reply): Promise<void>` — Prehandler, antwortet `403` wenn `req.rolle!=='admin'`

- [ ] **Step 1: Failing test** — `test/auth.test.ts`

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';

const app = buildApp(getPool());
afterAll(async () => { await app.close(); await closePool(); });

describe('auth', () => {
  it('403 auf Admin-Route ohne admin-Rolle', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ping', headers: { 'x-user-role': 'standard' } });
    expect(res.statusCode).toBe(403);
  });
  it('200 mit admin-Rolle', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ping', headers: { 'x-user-role': 'admin' } });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- auth` → FAIL.

- [ ] **Step 3: Implementieren**

`src/server/auth.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
declare module 'fastify' { interface FastifyRequest { rolle: 'admin'|'standard'; } }

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.rolle !== 'admin') { await reply.code(403).send({ error: 'Nur Admin' }); }
}
```

`src/server/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from './auth';

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('rolle', 'standard');
  app.addHook('onRequest', async (req) => {
    const h = req.headers['x-user-role'];
    req.rolle = h === 'admin' ? 'admin' : 'standard';
  });
  app.get('/admin/ping', { preHandler: requireAdmin }, async () => ({ ok: true }));
  // Routen aus Task 8 werden hier registriert (registerAuftraggeberRoutes/registerProjektRoutes)
  return app;
}
```

`src/server/main.ts`:
```ts
import { buildApp } from './app';
import { getPool } from '../db/pool';
const app = buildApp(getPool());
app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .then(a => console.log(`listening on ${a}`));
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- auth` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): Fastify-App + Rollen-Guard (Entra-ID-Platzhalter)"
```

---

## Task 8: REST-Routen Auftraggeber & Projekt

**Files:**
- Create: `src/server/routes/auftraggeber.ts`, `src/server/routes/projekt.ts`
- Modify: `src/server/app.ts` (Routen registrieren)
- Create: `test/routes.test.ts`

**Interfaces:**
- Consumes: `buildApp`, alle Repos, `requireAdmin`
- Produces:
  - `registerAuftraggeberRoutes(app, pool)` — `POST /auftraggeber` (Admin), `GET /auftraggeber`
  - `registerProjektRoutes(app, pool)` — `POST /projekt` (Admin), `GET /projekt?jahr=`, `GET /projekt/:id`
  - Fehler-Mapping: `ValidationError→400`, `NotFoundError→404`

- [ ] **Step 1: Failing test** — `test/routes.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
beforeAll(async () => { await resetDb(getPool()); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('routes', () => {
  it('legt Auftraggeber + Projekt an und liest sie', async () => {
    const a = await app.inject({ method: 'POST', url: '/auftraggeber', headers: admin,
      payload: { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' } });
    expect(a.statusCode).toBe(201);
    const auftraggeberId = a.json().id;

    const p = await app.inject({ method: 'POST', url: '/projekt', headers: admin,
      payload: { basisnummer: 6231, jahr: 2026, name: 'Testprojekt', auftraggeberId } });
    expect(p.statusCode).toBe(201);
    expect(p.json().nummer).toBe('6231.26');

    const list = await app.inject({ method: 'GET', url: '/projekt?jahr=2026' });
    expect(list.json().length).toBe(1);
  });
  it('400 bei unvollständiger Adresse', async () => {
    const res = await app.inject({ method: 'POST', url: '/auftraggeber', headers: admin,
      payload: { name: 'X', strasse: 'Y', plz: '', ort: '' } });
    expect(res.statusCode).toBe(400);
  });
  it('403 ohne Admin-Rolle', async () => {
    const res = await app.inject({ method: 'POST', url: '/auftraggeber',
      payload: { name: 'X', strasse: 'Y', plz: '1', ort: 'Z' } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- routes` → FAIL.

- [ ] **Step 3: Implementieren**

`src/server/routes/auftraggeber.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createAuftraggeber, listAuftraggeber } from '../../repos/auftraggeberRepo';
import { ValidationError } from '../../domain/errors';

export function registerAuftraggeberRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/auftraggeber', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const a = await createAuftraggeber(pool, req.body as any);
      return reply.code(201).send(a);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
  app.get('/auftraggeber', async () => listAuftraggeber(pool));
}
```

`src/server/routes/projekt.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { createProjekt, listProjekte, getProjektById } from '../../repos/projektRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';

export function registerProjektRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/projekt', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = await createProjekt(pool, req.body as any);
      return reply.code(201).send(p);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
  app.get('/projekt', async (req) => {
    const q = req.query as any;
    return listProjekte(pool, { jahr: q.jahr ? Number(q.jahr) : undefined, auftraggeberId: q.auftraggeberId });
  });
  app.get('/projekt/:id', async (req, reply) => {
    try { return await getProjektById(pool, (req.params as any).id); }
    catch (e) { if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message }); throw e; }
  });
}
```

`src/server/app.ts` — Registrierung ergänzen (nach der `/admin/ping`-Zeile):
```ts
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
// ... innerhalb buildApp, vor `return app;`:
  registerAuftraggeberRoutes(app, pool);
  registerProjektRoutes(app, pool);
```

- [ ] **Step 4: Verify pass** — Run: `npm test` (alle Tests) → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): Routen Auftraggeber + Projekt mit Rollen-/Fehler-Mapping"
```

---

## Roadmap: Folgepläne (nach Plan 1)

- **Plan 2 — Verrechnung & MWSt:** `rechnung` + `rechnungsposition`; MWSt-Engine (Satz je Position, Summierung je Satz, Rappenrundung 0.05, exkl/inkl); **lückenlose Nummerierung** via DB-Sequenz + Transaktion; Status-Lebenszyklus + Festschreibung.
- **Plan 3 — QR-Rechnung & PDF:** QRR-Referenz (Mod10), `swissqrbill`-Integration, PDF (Brief + Zahlteil), Golden-Test gegen echten Beleg 6231.26 / 8'329.10.
- **Plan 4 — Debitorenkontrolle:** `zahlungseingang`, offene Posten, Kontokorrent-Saldo (transaktional), OP-Liste/Report.
- **Plan 5 — Migration:** FileMaker-Export → Import (auftraggeber/konto/mwst_satz/projekt), Summen-Validierung gegen FileMaker.
- **Plan 6 — Frontend-PWA:** Projekte-/Rechnungs-/Debitoren-UI, Entra-ID-Login, PDF-Ansicht.

---

## Self-Review (gegen Spec)

- **Spec-Abdeckung Plan 1:** §3 Stack (TS/Fastify/pg ✓, Entra-ID als Platzhalter dokumentiert), §4.1 Auftraggeber inkl. Pflichtadresse ✓, §4.2 Projekt inkl. Kontierung/Nummernschema/Fortsetzung ✓, §4.5 Konto ✓, §4.6 MWSt-Satz (historisiert) ✓, §5.1 Projekte-Modul (CRUD/Kontierung) ✓, §6 Rollen/serverseitige Validierung ✓. Verrechnung/QR/Debitoren/Migration/Frontend bewusst in Plan 2–6.
- **Platzhalter:** keine „TBD/TODO"; Auth-Platzhalter ist explizit als solcher markiert mit Verweis auf Härtungs-Task.
- **Typ-Konsistenz:** `Konto/MwstSatz/Auftraggeber/Projekt` zentral in `src/domain/types.ts`; Repo-Signaturen in Produces-Blöcken deckungsgleich mit Verwendung in Task 8; `getPool/closePool/resetDb/runMigrations` durchgängig gleich benannt.

# Debitorenkontrolle — Implementation Plan (Plan 4 von 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zahlungseingänge manuell erfassen, offene Posten je Rechnung und Kontokorrent-Saldo je Auftraggeber führen — ohne Bank-Import (v1-Scope „mittel").

**Architecture:** `zahlungseingang` als eigene Tabelle; Zahlung + Statuswechsel transaktional. Offener Betrag = Brutto − Summe Zahlungen (Rappenrundung). Offene-Posten-/Saldo-Abfragen als SQL-Aggregate über Repos.

**Tech Stack:** wie Plan 1–3.

## Global Constraints
- Zahlung nur für **festgeschriebene** Rechnungen (`abgerechnet`/`bezahlt`); Entwürfe/Storno abgelehnt. (Spec §5.5)
- **Kein camt-Import in v1** — Zahlung manuell. (Nutzer-Entscheid)
- Saldo/Status konsistent halten (Zahlung + Statuswechsel in einer Transaktion). (Spec §6.5)
- Beträge `numeric(12,2)`, Rappenrundung via `rappenRunden` (Plan 2). DB nur über Repos.

---

## Dateistruktur
```
db/migrations/006_zahlungseingang.sql
src/domain/types.ts                 # +Zahlungseingang, +OffenerPosten  (Modify)
src/repos/debitorRepo.ts
src/server/routes/debitor.ts
src/server/app.ts                   # Registrierung  (Modify)
test/debitorRepo.test.ts
test/debitorRoutes.test.ts
```

---

## Task 1: Schema + debitorRepo (Zahlung, offener Betrag, Statuswechsel)

**Files:**
- Create: `db/migrations/006_zahlungseingang.sql`, `src/repos/debitorRepo.ts`, `test/debitorRepo.test.ts`
- Modify: `src/domain/types.ts`

**Interfaces:**
- Consumes: `getRechnung`, `rappenRunden`, `ValidationError`
- Produces:
  - Typ `Zahlungseingang = { id: string; rechnungId: string; datum: string; betrag: number; bemerkung: string | null; erfasstDurch: string | null }`
  - `offenerBetrag(brutto: number, bezahlt: number): number`
  - `summeBezahlt(pool, rechnungId): Promise<number>`
  - `erfasseZahlung(pool, rechnungId, input: { datum: string; betrag: number; bemerkung?: string | null; erfasstDurch?: string | null }): Promise<{ zahlung: Zahlungseingang; rechnungStatus: string; offen: number }>` — nur aus `abgerechnet`/`bezahlt`; Transaktion: Zahlung einfügen, wenn Summe ≥ Brutto → Status `bezahlt`, sonst `abgerechnet`; wirft `ValidationError` bei falschem Status oder Betrag ≤ 0

- [ ] **Step 1: Failing test** — `test/debitorRepo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben, getRechnung } from '../src/repos/rechnungRepo';
import { erfasseZahlung, summeBezahlt, offenerBetrag } from '../src/repos/debitorRepo';
import { ValidationError } from '../src/domain/errors';

let auftraggeberId: string; let projektId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function festeRechnung(brutto100: number): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: brutto100, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  return r.id;
}

describe('offenerBetrag', () => {
  it('rundet Brutto minus Bezahlt', () => {
    expect(offenerBetrag(8329.10, 8329.10)).toBe(0);
    expect(offenerBetrag(100, 40)).toBe(60);
  });
});

describe('erfasseZahlung', () => {
  it('Vollzahlung setzt Status bezahlt, offen 0', async () => {
    const id = await festeRechnung(1000);
    const res = await erfasseZahlung(getPool(), id, { datum: '2026-08-01', betrag: 1000 });
    expect(res.rechnungStatus).toBe('bezahlt');
    expect(res.offen).toBe(0);
    expect((await getRechnung(getPool(), id)).status).toBe('bezahlt');
  });
  it('Teilzahlung bleibt abgerechnet mit Restbetrag', async () => {
    const id = await festeRechnung(1000);
    const res = await erfasseZahlung(getPool(), id, { datum: '2026-08-01', betrag: 400 });
    expect(res.rechnungStatus).toBe('abgerechnet');
    expect(res.offen).toBe(600);
    expect(await summeBezahlt(getPool(), id)).toBe(400);
  });
  it('lehnt Zahlung auf Entwurf ab', async () => {
    const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23' });
    await expect(erfasseZahlung(getPool(), r.id, { datum: '2026-08-01', betrag: 10 })).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- debitorRepo` → FAIL.

- [ ] **Step 3: Implementieren**

`db/migrations/006_zahlungseingang.sql`:
```sql
create table zahlungseingang (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnung(id),
  datum date not null,
  betrag numeric(12,2) not null check (betrag > 0),
  bemerkung text,
  erfasst_durch text,
  erstellt_am timestamptz not null default now()
);
create index zahlungseingang_rechnung_idx on zahlungseingang(rechnung_id);
```

Typen in `src/domain/types.ts` anfügen:
```ts
export type Zahlungseingang = {
  id: string; rechnungId: string; datum: string; betrag: number;
  bemerkung: string | null; erfasstDurch: string | null;
};

export type OffenerPosten = {
  rechnungId: string; nummer: string | null; auftraggeberId: string; datum: string;
  totalBrutto: number; bezahlt: number; offen: number;
};
```

`src/repos/debitorRepo.ts`:
```ts
import type pg from 'pg';
import type { Zahlungseingang } from '../domain/types';
import { rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError } from '../domain/errors';

export function offenerBetrag(brutto: number, bezahlt: number): number {
  return rappenRunden(brutto - bezahlt);
}

const mapZ = (r: any): Zahlungseingang => ({
  id: r.id, rechnungId: r.rechnung_id, datum: r.datum, betrag: Number(r.betrag),
  bemerkung: r.bemerkung, erfasstDurch: r.erfasst_durch,
});

export async function summeBezahlt(pool: pg.Pool, rechnungId: string): Promise<number> {
  const r = await pool.query('select coalesce(sum(betrag),0)::numeric as s from zahlungseingang where rechnung_id=$1', [rechnungId]);
  return Number(r.rows[0].s);
}

export async function erfasseZahlung(pool: pg.Pool, rechnungId: string, input: { datum: string; betrag: number; bemerkung?: string | null; erfasstDurch?: string | null }): Promise<{ zahlung: Zahlungseingang; rechnungStatus: string; offen: number }> {
  if (input.betrag <= 0) throw new ValidationError('Betrag muss > 0 sein');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rr = await client.query('select * from rechnung where id=$1 for update', [rechnungId]);
    if (!rr.rowCount) throw new NotFoundError(`Rechnung ${rechnungId} nicht gefunden`);
    const rech = rr.rows[0];
    if (rech.status !== 'abgerechnet' && rech.status !== 'bezahlt') {
      throw new ValidationError(`Zahlung nur auf festgeschriebene Rechnung (Status ${rech.status})`);
    }
    const ins = await client.query(
      `insert into zahlungseingang(rechnung_id,datum,betrag,bemerkung,erfasst_durch) values ($1,$2,$3,$4,$5) returning *`,
      [rechnungId, input.datum, input.betrag, input.bemerkung ?? null, input.erfasstDurch ?? null]);
    const sumR = await client.query('select coalesce(sum(betrag),0)::numeric as s from zahlungseingang where rechnung_id=$1', [rechnungId]);
    const bezahlt = Number(sumR.rows[0].s);
    const brutto = Number(rech.total_brutto);
    const offen = offenerBetrag(brutto, bezahlt);
    const neuerStatus = offen <= 0 ? 'bezahlt' : 'abgerechnet';
    await client.query('update rechnung set status=$2 where id=$1', [rechnungId, neuerStatus]);
    await client.query('commit');
    return { zahlung: mapZ(ins.rows[0]), rechnungStatus: neuerStatus, offen };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- debitorRepo` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(debitor): Zahlungseingang + Statuswechsel (transaktional)"
```

---

## Task 2: Offene Posten & Kontokorrent-Saldo

**Files:**
- Modify: `src/repos/debitorRepo.ts`
- Create: `test/debitorSaldo.test.ts`

**Interfaces:**
- Consumes: `OffenerPosten`
- Produces:
  - `offenePosten(pool, filter?: { auftraggeberId?: string }): Promise<OffenerPosten[]>` — Rechnungen mit Status `abgerechnet` (offen > 0), Restbetrag berechnet, älteste zuerst
  - `kontokorrentSaldo(pool, auftraggeberId): Promise<number>` — Summe offener Beträge dieses Auftraggebers

- [ ] **Step 1: Failing test** — `test/debitorSaldo.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';
import { erfasseZahlung, offenePosten, kontokorrentSaldo } from '../src/repos/debitorRepo';

let auftraggeberId: string; let projektId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
});
afterAll(async () => { await closePool(); });

async function festeRechnung(betrag: number): Promise<string> {
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: betrag, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  return r.id;
}

describe('offene Posten + Saldo', () => {
  it('summiert offene Beträge je Auftraggeber', async () => {
    const a = await festeRechnung(1000); // offen 1000
    const b = await festeRechnung(500);
    await erfasseZahlung(getPool(), b, { datum: '2026-08-01', betrag: 200 }); // offen 300
    const c = await festeRechnung(400);
    await erfasseZahlung(getPool(), c, { datum: '2026-08-01', betrag: 400 }); // bezahlt -> nicht offen

    const op = await offenePosten(getPool(), { auftraggeberId });
    const ids = op.map((p) => p.rechnungId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(c);
    expect(await kontokorrentSaldo(getPool(), auftraggeberId)).toBe(1300); // 1000 + 300
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- debitorSaldo` → FAIL.

- [ ] **Step 3: Implementieren** — an `src/repos/debitorRepo.ts` anfügen

```ts
import type { OffenerPosten } from '../domain/types';

const OFFEN_SQL = `
  select r.id, r.nummer, r.auftraggeber_id, r.datum, r.total_brutto,
         coalesce(z.bezahlt,0)::numeric as bezahlt,
         (r.total_brutto - coalesce(z.bezahlt,0))::numeric as offen
  from rechnung r
  left join (select rechnung_id, sum(betrag) as bezahlt from zahlungseingang group by rechnung_id) z
    on z.rechnung_id = r.id
  where r.status = 'abgerechnet'`;

const mapOP = (r: any): OffenerPosten => ({
  rechnungId: r.id, nummer: r.nummer, auftraggeberId: r.auftraggeber_id, datum: r.datum,
  totalBrutto: Number(r.total_brutto), bezahlt: Number(r.bezahlt), offen: Number(r.offen),
});

export async function offenePosten(pool: pg.Pool, filter: { auftraggeberId?: string } = {}): Promise<OffenerPosten[]> {
  const args: any[] = [];
  let sql = OFFEN_SQL;
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); sql += ` and r.auftraggeber_id=$${args.length}`; }
  sql += ' order by r.datum asc';
  const r = await pool.query(sql, args);
  return r.rows.map(mapOP).filter((p) => p.offen > 0);
}

export async function kontokorrentSaldo(pool: pg.Pool, auftraggeberId: string): Promise<number> {
  const posten = await offenePosten(pool, { auftraggeberId });
  return rappenRunden(posten.reduce((s, p) => s + p.offen, 0));
}
```

- [ ] **Step 4: Verify pass** — Run: `npm test -- debitorSaldo` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(debitor): offene Posten + Kontokorrent-Saldo"
```

---

## Task 3: REST-Routen Debitoren

**Files:**
- Create: `src/server/routes/debitor.ts`
- Modify: `src/server/app.ts`
- Create: `test/debitorRoutes.test.ts`

**Interfaces:**
- Consumes: `erfasseZahlung`, `offenePosten`, `kontokorrentSaldo`, `requireAdmin`
- Produces:
  - `registerDebitorRoutes(app, pool)`:
    - `POST /rechnung/:id/zahlung` (Admin) → 201 `{ zahlung, rechnungStatus, offen }`
    - `GET /debitoren/offene-posten?auftraggeberId=` → OffenerPosten[]
    - `GET /auftraggeber/:id/saldo` → `{ auftraggeberId, saldo }`
  - Fehler-Mapping `ValidationError→400`, `NotFoundError→404`

- [ ] **Step 1: Failing test** — `test/debitorRoutes.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server/app';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createAuftraggeber } from '../src/repos/auftraggeberRepo';
import { createProjekt } from '../src/repos/projektRepo';
import { createRechnung, addPosition, festschreiben } from '../src/repos/rechnungRepo';

const app = buildApp(getPool());
const admin = { 'x-user-role': 'admin' };
let auftraggeberId: string; let rechnungId: string;
beforeAll(async () => {
  await resetDb(getPool());
  auftraggeberId = (await createAuftraggeber(getPool(), { name: 'Urner KB', strasse: 'Bahnhofstr. 1', plz: '6460', ort: 'Altdorf' })).id;
  const projektId = (await createProjekt(getPool(), { stammnummer: 6231, jahr: 2026, name: 'Test', auftraggeberId })).id;
  const r = await createRechnung(getPool(), { projektId, auftraggeberId, datum: '2026-07-23', mwstModus: 'exkl' });
  await addPosition(getPool(), r.id, { beschreibung: 'X', menge: 1, einzelpreis: 1000, mwstSatz: 0 });
  await festschreiben(getPool(), r.id, 'ml');
  rechnungId = r.id;
  await app.ready();
});
afterAll(async () => { await app.close(); await closePool(); });

describe('debitor-routes', () => {
  it('Zahlung -> offene Posten -> Saldo', async () => {
    const z = await app.inject({ method: 'POST', url: `/rechnung/${rechnungId}/zahlung`, headers: admin, payload: { datum: '2026-08-01', betrag: 400 } });
    expect(z.statusCode).toBe(201);
    expect(z.json().offen).toBe(600);

    const op = await app.inject({ method: 'GET', url: `/debitoren/offene-posten?auftraggeberId=${auftraggeberId}` });
    expect(op.json()).toHaveLength(1);
    expect(op.json()[0].offen).toBe(600);

    const s = await app.inject({ method: 'GET', url: `/auftraggeber/${auftraggeberId}/saldo` });
    expect(s.json().saldo).toBe(600);
  });
});
```

- [ ] **Step 2: Verify fail** — Run: `npm test -- debitorRoutes` → FAIL.

- [ ] **Step 3: Implementieren** — `src/server/routes/debitor.ts`

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { erfasseZahlung, offenePosten, kontokorrentSaldo } from '../../repos/debitorRepo';
import { ValidationError, NotFoundError } from '../../domain/errors';

function mapErr(reply: FastifyReply, e: unknown): FastifyReply {
  if (e instanceof ValidationError) return reply.code(400).send({ error: e.message });
  if (e instanceof NotFoundError) return reply.code(404).send({ error: e.message });
  throw e;
}

export function registerDebitorRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/rechnung/:id/zahlung', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await erfasseZahlung(pool, (req.params as any).id, req.body as any)); }
    catch (e) { return mapErr(reply, e); }
  });
  app.get('/debitoren/offene-posten', async (req) => {
    const q = req.query as any;
    return offenePosten(pool, { auftraggeberId: q.auftraggeberId });
  });
  app.get('/auftraggeber/:id/saldo', async (req) => {
    const id = (req.params as any).id;
    return { auftraggeberId: id, saldo: await kontokorrentSaldo(pool, id) };
  });
}
```

`src/server/app.ts` — Import + Registrierung (analog zu den anderen Routen):
```ts
import { registerDebitorRoutes } from './routes/debitor';
// ... vor `return app;`:
  registerDebitorRoutes(app, pool);
```

- [ ] **Step 4: Verify pass** — Run: `npm test` (alle) → PASS; danach `npx tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(api): Debitoren-Routen (Zahlung/offene Posten/Saldo)"
```

---

## Self-Review (gegen Spec)
- **Spec-Abdeckung:** §4.7 zahlungseingang ✓, §5.5 Debitorenkontrolle (Zahlung manuell, offene Posten, Kontokorrent-Saldo) ✓, §6.5 Saldo transaktional konsistent (Zahlung+Statuswechsel in einer Transaktion) ✓. Kein camt-Import (v1-Scope) — bewusst weggelassen.
- **Platzhalter:** keine.
- **Typ-Konsistenz:** `Zahlungseingang`/`OffenerPosten` zentral; `erfasseZahlung/summeBezahlt/offenerBetrag/offenePosten/kontokorrentSaldo` in allen Tasks deckungsgleich; nutzt `rappenRunden` aus Plan 2.

## Offene Punkte
- **Storno-Wechselwirkung:** Zahlung auf `bezahlt`, danach Storno → offener Posten entfällt (Status `storniert` ∉ offene Posten). Rückzahlungslogik (Gutschrift) erst bei Bedarf.
- **Überzahlung** (bezahlt > brutto) → offen = negativ, hier auf 0 gewertet für Status; echte Vorauszahlung/Guthaben später.
- camt.053/054-Import = v2.

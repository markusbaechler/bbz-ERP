import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { buildApp } from '../src/server/app';
import { createReferent } from '../src/repos/referentRepo';
import { createEinsatz } from '../src/repos/einsatzRepo';
import { ConflictError } from '../src/domain/errors';

const pool = getPool();
const app = buildApp(pool);
const admin = { 'x-user-role': 'admin', 'x-user': 'ml' };
let base: Awaited<ReturnType<typeof grundbestand>>;
beforeAll(async () => { await resetDb(pool); base = await grundbestand(pool); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('Korrekturen nach Modul-Review', () => {
  it('Storno gibt verrechnete Zeiteintraege frei (Neuverrechnung moeglich) und protokolliert', async () => {
    const z = await app.inject({ method: 'POST', url: '/zeiterfassung', headers: admin,
      payload: { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-01', stunden: 4, taetigkeit: 'Workshop' } });
    expect(z.statusCode).toBe(201);
    const v = await app.inject({ method: 'POST', url: `/projekt/${base.projekt.id}/zeit-verrechnen`, headers: admin,
      payload: { datum: '2026-10-31', mwstSatz: 8.1, gruppierung: 'mitarbeitende' } });
    expect(v.statusCode).toBe(201);
    const rechnungId = v.json().rechnung.id;
    expect((await app.inject({ method: 'POST', url: `/rechnung/${rechnungId}/festschreiben`, headers: admin, payload: { erstellerKuerzel: 'ml' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/zeiterfassung/${z.json().id}`, headers: admin, payload: { stunden: 5 } })).statusCode).toBe(409);

    const s = await app.inject({ method: 'POST', url: `/rechnung/${rechnungId}/stornieren`, headers: admin, payload: { grund: 'falscher Ansatz' } });
    expect(s.statusCode).toBe(200);
    expect(s.json().status).toBe('storniert');
    expect((await app.inject({ method: 'PATCH', url: `/zeiterfassung/${z.json().id}`, headers: admin, payload: { stunden: 5 } })).statusCode).toBe(200);
    const neu = await app.inject({ method: 'POST', url: `/projekt/${base.projekt.id}/zeit-verrechnen`, headers: admin,
      payload: { datum: '2026-11-01', mwstSatz: 8.1, gruppierung: 'mitarbeitende' } });
    expect(neu.statusCode).toBe(201);
    expect(neu.json().rechnung.totalNetto).toBe(5 * 220);
    const log = await pool.query(`select details from audit_log where aktion='storniert' and entitaet_id=$1`, [rechnungId]);
    expect(log.rows[0].details).toMatchObject({ grund: 'falscher Ansatz', freigegeben: { zeiteintraege: 1 } });
    const liste = (await app.inject({ method: 'GET', url: `/rechnung?projektId=${base.projekt.id}` })).json();
    expect(liste).toHaveLength(3);                                   // Original, Gutschrift, Neuverrechnung
    const g = s.json().gutschrift;
    expect(g).toMatchObject({ typ: 'gutschrift', bezugRechnungId: rechnungId, status: 'storniert', totalNetto: -880, totalBrutto: -951.3 });
    expect(g.lfdNr).toBe(s.json().lfdNr + 1);                        // lueckenlos aus demselben Zaehler
    expect(g.nummer).toMatch(/ G ml$/);
    const gPos = (await app.inject({ method: 'GET', url: `/rechnung/${g.id}` })).json().positionen;
    expect(gPos.map((p: any) => p.betragNetto)).toEqual([-880]);
    const pdf = await app.inject({ method: 'GET', url: `/rechnung/${g.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await app.inject({ method: 'POST', url: `/rechnung/${g.id}/stornieren`, headers: admin, payload: {} })).statusCode).toBe(400);
  });

  it('Storno nur fuer Admin', async () => {
    expect((await app.inject({ method: 'POST', url: '/rechnung/00000000-0000-0000-0000-000000000000/stornieren' })).statusCode).toBe(403);
  });

  it('parallele Einsatzbuchungen ueberbuchen nicht (Advisory-Lock je Referent und Datum)', async () => {
    const ref = await createReferent(pool, { typ: 'intern', mitarbeitendeId: base.ml.id });
    const res = await Promise.allSettled([1, 2, 3, 4].map(() =>
      createEinsatz(pool, { referentId: ref.id, projektId: base.projekt.id, datum: '2026-12-01', dauerTage: 1 })));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError)).toBe(true);
  });

  it('keine Zeiterfassung auf archivierten oder abgesagten Projekten', async () => {
    await pool.query(`update projekt set status='archiviert' where id=$1`, [base.projekt.id]);
    const r = await app.inject({ method: 'POST', url: '/zeiterfassung', headers: admin,
      payload: { mitarbeitendeId: base.ml.id, projektId: base.projekt.id, datum: '2026-10-02', stunden: 1, taetigkeit: 'X' } });
    expect(r.statusCode).toBe(409);
    await pool.query(`update projekt set status='laufend' where id=$1`, [base.projekt.id]);
  });
});

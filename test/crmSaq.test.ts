import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { createSaqFall } from '../src/repos/saqRepo';
import { ladeKontakt360 } from '../src/repos/crmAuswertungRepo';

const pool = getPool();
beforeAll(async () => { await resetDb(pool); });
afterAll(async () => { await closePool(); });

describe('CRM 360° mit SAQ-Vorgaengen', () => {
  it('zeigt laufende SAQ-Zertifizierungen der Person', async () => {
    const f = await createSaqFall(pool, { kontakt: { email: 'saq360@bank.test', nachname: 'Beispiel' }, profil: 'KMU' });
    const k = await ladeKontakt360(pool, f.kontaktId);
    expect(k.saqVorgaenge).toEqual([expect.objectContaining({ id: f.id, profil: 'KMU', status: 'angemeldet' })]);
  });
});

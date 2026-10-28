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

describe('Zertifizierung: zwei Profile am selben Tag', () => {
  it('erlaubt verschiedene Profile, verhindert Dubletten desselben Profils', async () => {
    const f = await createSaqFall(pool, { kontakt: { email: 'zwei@bank.test', nachname: 'Zwei' }, profil: 'PK' });
    const ins = (profil: string) => pool.query(
      `insert into zertifizierung(kontakt_id,typ,profil,ausgestellt_am,gueltig_bis) values ($1,'SAQ Kundenberater Bank',$2,'2026-05-04','2029-05-04')`, [f.kontaktId, profil]);
    await ins('PK');
    await ins('IK');
    await expect(ins('PK')).rejects.toMatchObject({ code: '23505' });
  });
});

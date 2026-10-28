import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { inTransaktion } from '../src/repos/db';
import { enqueue, holeFaellige, markiereFehler, markiereErledigt, backoffMinuten, listOutbox } from '../src/repos/outboxRepo';

const pool = getPool();
beforeAll(async () => { await resetDb(pool); });
afterAll(async () => { await closePool(); });

describe('outbox', () => {
  it('verwirft den Auftrag zusammen mit einer zurueckgerollten Transaktion', async () => {
    await expect(inTransaktion(pool, async (c) => {
      await enqueue(c, 'mail', null, { vorlage: 'x' });
      throw new Error('fachlicher Fehler');
    })).rejects.toThrow('fachlicher Fehler');
    expect(await listOutbox(pool)).toHaveLength(0);
  });
  it('holt faellige Auftraege genau einmal und plant Fehler mit Backoff neu ein', async () => {
    const id = await enqueue(pool, 'moodle.einschreiben', null, { anmeldungId: 'a' });
    const [e] = await holeFaellige(pool);
    expect(e.id).toBe(id);
    expect(e.versuche).toBe(1);
    expect(await holeFaellige(pool)).toHaveLength(0);           // in_arbeit -> nicht doppelt
    await markiereFehler(pool, e, 'Moodle nicht erreichbar');
    expect(await holeFaellige(pool)).toHaveLength(0);           // Backoff noch nicht abgelaufen
    const [f] = await listOutbox(pool, { status: 'fehler' });
    expect(f.letzterFehler).toBe('Moodle nicht erreichbar');
    await markiereErledigt(pool, id);
    expect(await listOutbox(pool, { status: 'erledigt' })).toHaveLength(1);
  });
  it('Backoff waechst exponentiell und ist gedeckelt', () => {
    expect([1, 2, 3, 4].map(backoffMinuten)).toEqual([1, 2, 4, 8]);
    expect(backoffMinuten(30)).toBe(360);
  });
});

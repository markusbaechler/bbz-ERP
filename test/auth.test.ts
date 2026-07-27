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

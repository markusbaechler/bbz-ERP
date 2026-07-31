import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { getZaehler } from '../src/repos/zaehlerRepo';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://bbz:bbz@localhost:5433/bbz_test' };

// Wie in migrate.test.ts: der Einstiegspunkt wird wirklich gestartet. Ein
// handgebautes "file://" + argv[1] trifft unter Windows nie zu — der Prozess
// laeuft dann durch und tut nichts (genau das ist hier schon zweimal passiert).
function laufe(...args: string[]): { code: number; aus: string } {
  try {
    const aus = execSync(['npx tsx src/cli/zaehler.ts', ...args].join(' '), {
      cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, aus };
  } catch (e: any) {
    return { code: typeof e.status === 'number' ? e.status : 1, aus: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

beforeAll(async () => { await resetDb(getPool()); });
afterAll(async () => { await closePool(); });

describe('npm run zaehler', () => {
  it('meldet ohne Argument nur den Stand und die Untergrenze', () => {
    const r = laufe();
    expect(r.code).toBe(0);
    expect(r.aus).toContain('Stand');
    expect(r.aus).toContain('Untergrenze');
    expect(r.aus).toContain('31491');
    expect(r.aus).toMatch(/gesperrt/i);
  }, 60000);

  it('setzt den Zaehler ohne CSV und ohne Import und zeigt vorher/nachher', async () => {
    const r = laufe('--rechnung-max=33214');
    expect(r.code).toBe(0);
    expect(r.aus).toMatch(/vorher.*0/is);
    expect(r.aus).toContain('33214');
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  }, 60000);

  it('weist ein Zuruecksetzen ab und laesst den Stand unveraendert', async () => {
    const r = laufe('--rechnung-max=100');
    expect(r.code).not.toBe(0);
    expect(r.aus).toContain('33214');
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  }, 60000);

  it('weist ein unbrauchbares Argument an der CLI-Grenze ab', async () => {
    const r = laufe('--rechnung-max=abc');
    expect(r.code).toBe(2);
    expect(r.aus).toContain('--rechnung-max');
    expect(await getZaehler(getPool(), 'rechnung_lfd_nr')).toBe(33214);
  }, 60000);

  it('nennt sich selbst als Akteur im Nachweis', () => {
    const r = laufe();
    expect(r.aus).toMatch(/CLI/);
  }, 60000);
});

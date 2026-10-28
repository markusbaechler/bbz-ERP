import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { istEinstieg } from '../src/einstieg';

describe('istEinstieg (CLI-Erkennung)', () => {
  it('erkennt den Start unter Windows (file:///C:/…)', () => {
    const url = 'file:///C:/Users/x/bbz-ERP/tools/fm-analyse/cli.ts';
    expect(istEinstieg(url, 'C:\\Users\\x\\bbz-ERP\\tools\\fm-analyse\\cli.ts', true)).toBe(true);
  });
  it('erkennt Pfade mit Leerzeichen (URL-kodiert)', () => {
    expect(istEinstieg('file:///home/a%20b/cli.ts', '/home/a b/cli.ts', false)).toBe(true);
  });
  it('ist false bei Import aus einem anderen Skript oder ohne Skriptpfad', () => {
    expect(istEinstieg('file:///home/x/cli.ts', '/home/x/andere.ts', false)).toBe(false);
    expect(istEinstieg('file:///home/x/cli.ts', undefined)).toBe(false);
  });
  it('npm run fm:analyse schreibt den Bericht (echter Prozessstart)', () => {
    const out = mkdtempSync(join(tmpdir(), 'fm-cli-'));
    const log = execFileSync(process.execPath, ['--import', 'tsx', 'tools/fm-analyse/cli.ts', 'test/fixtures/ddr', '--out', out], { encoding: 'utf8' });
    expect(log).toMatch(/Bericht geschrieben/);
    expect(existsSync(join(out, 'FUNKTIONSUMFANG.md'))).toBe(true);
  });
});

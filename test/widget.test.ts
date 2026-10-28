import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { getPool, closePool } from '../src/db/pool';
import { resetDb } from './helpers/db';
import { grundbestand } from './helpers/fixtures';
import { buildApp } from '../src/server/app';
import { createKursangebot } from '../src/repos/kursangebotRepo';
import { createDurchfuehrung, setDurchfuehrungStatus } from '../src/repos/durchfuehrungRepo';

/*
 * Browser-Test des Homepage-Widgets: fremde Origin (Homepage), CORS, Shadow DOM, Anmeldung mit Idempotenz.
 * Playwright ist keine Projekt-Abhaengigkeit: ist es nicht installiert (z. B. lokal), wird der Test uebersprungen.
 */
let pw: any = null;
try { pw = createRequire(import.meta.url)('playwright'); } catch { /* nicht installiert */ }
type Browser = any;
const pool = getPool();
const app = buildApp(pool);
let HOMEPAGE = ''; let FREMD = '';
let api = ''; let key = ''; let browser: Browser;
const seiten: Server[] = [];
/** "Homepage" als echter Loopback-Server (Chromium Private Network Access erlaubt loopback -> loopback). */
async function homepage(html: () => string): Promise<string> {
  const s = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html()); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  seiten.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await resetDb(pool);
  const base = await grundbestand(pool);
  await app.listen({ port: 0, host: '127.0.0.1' });
  api = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  HOMEPAGE = await homepage(() => `<!doctype html><html lang="de"><body><h1>Weiterbildung Banking</h1>
    <div data-bbz-kurse data-bereich="Banking" data-anmeldung="ja"></div>
    <script src="${api}/widget/bbz-kurse.js" data-api="${api}" data-key="${key}" defer></script></body></html>`);
  FREMD = await homepage(() => `<div data-bbz-kurse></div><script src="${api}/widget/bbz-kurse.js" data-api="${api}" data-key="${key}"></script>`);
  key = (await app.inject({ method: 'POST', url: '/admin/api-clients', headers: { 'x-user-role': 'admin' },
    payload: { name: 'Widget', scopes: ['public:read', 'public:anmeldung'], erlaubteOrigins: [HOMEPAGE] } })).json().schluessel;
  const ka = await createKursangebot(pool, { code: 'AFL', titel: 'Anlagefonds Lizenz', bereich: 'Banking', lernstunden: 16, dauerTage: 1, preisChf: 650, oeffentlich: true });
  const d = await createDurchfuehrung(pool, { kursangebotId: ka.id, projektId: base.projekt.id, startDatum: '2027-05-04', endDatum: '2027-05-04', ort: 'Zürich, FFHS Campus', kapazitaet: 12 });
  await setDurchfuehrungStatus(pool, d.id, 'ausgeschrieben');
  if (pw) browser = await pw.chromium.launch();
}, 60_000);
afterAll(async () => { await browser?.close(); for (const x of seiten) x.close(); await app.close(); await closePool(); });

describe.skipIf(!pw)('Homepage-Widget bbz-kurse.js', () => {
  it('rendert Kurse auf fremder Origin und meldet an (Shadow DOM, CORS, Idempotenz)', async () => {
    const page = await browser.newPage();
    const fehler: string[] = [];
    page.on('pageerror', (e: Error) => fehler.push(e.message));
    await page.goto(`${HOMEPAGE}/weiterbildung`);
    await page.getByText('Anlagefonds Lizenz').waitFor();
    expect(await page.getByText('16 Lernstunden').count()).toBe(1);
    expect(await page.getByText('12 frei').count()).toBe(1);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Vorname *').fill('Erika');
    await page.getByLabel('Nachname *').fill('Beispiel');
    await page.getByLabel('Geschäftliche E-Mail *').fill('erika.beispiel@bank.test');
    await page.getByLabel('Bank / Arbeitgeber *').fill('Musterbank AG');
    await page.getByLabel(/Datenschutzerklärung/).check();
    await page.getByLabel(/AGB/).check();
    await page.getByRole('button', { name: 'Verbindlich anmelden' }).click();
    await page.getByText(/Danke für Ihre Anmeldung zu «Anlagefonds Lizenz»/).waitFor();
    const r = await pool.query(`select a.quelle, a.status, k.email from anmeldung a join kontakt k on k.id=a.kontakt_id`);
    expect(r.rows).toEqual([{ quelle: 'homepage', status: 'angemeldet', email: 'erika.beispiel@bank.test' }]);
    expect(fehler).toEqual([]);
    await page.close();
  }, 30_000);

  it('zeigt eine Fehlermeldung, wenn die Origin nicht freigegeben ist', async () => {
    const page = await browser.newPage();
    await page.goto(FREMD);
    await page.getByText('Das Kursangebot ist momentan nicht verfügbar.').waitFor();
    await page.close();
  }, 30_000);
});

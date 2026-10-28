// End-to-End-Smoke der PWA (npm run test:e2e). NICHT Teil von vitest.
// Ablauf: Schema der Ziel-DB leeren -> Migrationen + Demo-Daten -> Server auf freiem Port -> Chromium:
// Anmeldung (dev, ml/Admin), alle Hauptrouten mit Schluesselelementen, echte Interaktionen, Mobile-Check.
// Screenshots landen im OS-Temp-Verzeichnis (Pfad wird ausgegeben).
// DB: E2E_DATABASE_URL oder DATABASE_URL. Aus Sicherheitsgruenden nur Datenbanken mit test/web/e2e/demo im Namen
// (sonst E2E_ERZWINGEN=1), denn das Schema wird geloescht.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wurzel = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dbUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
const ausgabe = join(tmpdir(), `bbz-erp-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const fehler = [];
const log = (s) => console.log(s);

function abbruch(text) { console.error(`E2E abgebrochen: ${text}`); process.exit(2); }

if (!dbUrl) abbruch('DATABASE_URL (oder E2E_DATABASE_URL) setzen, z. B. postgres://bbz:bbz@localhost:5433/bbz_web');
const dbName = new URL(dbUrl).pathname.slice(1);
if (!/(test|web|e2e|demo)/i.test(dbName) && process.env.E2E_ERZWINGEN !== '1') {
  abbruch(`Datenbank «${dbName}» sieht nicht nach einer Test-DB aus (Schema wird geloescht). E2E_ERZWINGEN=1 setzen, falls gewollt.`);
}

let playwright;
try { playwright = require('playwright'); } catch { playwright = await import('playwright'); }
const pg = require('pg');

/* ---------- Datenbank frisch aufsetzen ---------- */
async function datenbankVorbereiten() {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  await client.query('drop schema public cascade; create schema public;');
  await client.end();
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seedDemo.ts'], { cwd: wurzel, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: 'utf8' });
  if (r.status !== 0) abbruch(`Migration/Seed fehlgeschlagen:\n${r.stdout}\n${r.stderr}`);
  log(r.stdout.trim());
}

const freierPort = () => new Promise((ok) => { const s = createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });

async function serverStarten(port) {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
    cwd: wurzel, env: { ...process.env, DATABASE_URL: dbUrl, PORT: String(port), AUTH_MODE: 'dev' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${basis}/health`)).ok) return { proc, basis }; } catch { /* startet noch */ }
    if (proc.exitCode !== null) abbruch(`Server beendet:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  return abbruch(`Server antwortet nicht:\n${stderr}`);
}

/* ---------- Hilfen ---------- */
const H = { 'x-user': 'ml', 'x-user-role': 'admin' };
async function api(basis, pfad) {
  const r = await fetch(`${basis}${pfad}`, { headers: H });
  if (!r.ok) throw new Error(`${pfad}: HTTP ${r.status}`);
  return r.json();
}
// Erwartete Konsolenfehler: Module, die auf diesem Server noch fehlen (404), und der bewusst provozierte 409.
const ERWARTET = [
  { status: 404, url: /\/saq\/|\/debitoren\/mahn|\/rechnung\/[^/]+\/mahnungen/ },
  { status: 409, url: /\/aufgabe\/[^/]+\/verschieben/ },
];

async function pruefe(name, fn) {
  try { await fn(); log(`  ✓ ${name}`); } catch (e) { fehler.push(`${name}: ${e.message.split('\n')[0]}`); log(`  ✗ ${name}: ${e.message.split('\n')[0]}`); }
}
function erwarte(bedingung, text) { if (!bedingung) throw new Error(text); }

/* ---------- Ablauf ---------- */
let server;
let browser;
try {
  mkdirSync(ausgabe, { recursive: true });
  log(`DB ${dbName}: Schema neu, Migrationen + Demo-Daten …`);
  await datenbankVorbereiten();
  server = await serverStarten(await freierPort());
  const { basis } = server;
  log(`Server ${basis}`);

  // IDs fuer Detailansichten ueber die API
  const org = (await api(basis, '/organisation?suche=Musterbank'))[0];
  const kontakt = (await api(basis, '/kontakt?suche=musterli'))[0];
  const p1 = (await api(basis, '/projekt')).find((p) => p.stammnummer === 6301);
  const dfs = await api(basis, '/durchfuehrung?status=ausgeschrieben');
  const dBef = dfs.find((d) => d.kursangebotCode === 'BEF');
  const dSaq = dfs.find((d) => d.kursangebotCode === 'SAQV');
  const rechnung = (await api(basis, '/rechnung?status=abgerechnet'))[0];
  const aufgaben = await api(basis, `/aufgabe?projektId=${p1.id}`);
  const kickoff = aufgaben.find((a) => a.titel.startsWith('Kick-off'));
  const workshop = aufgaben.find((a) => a.titel.startsWith('Konzept-Workshop'));
  const anna = (await api(basis, '/kontakt?suche=anna.muster'))[0];
  const annaAnmeldung = (await api(basis, `/anmeldung?durchfuehrungId=${dBef.id}`)).find((a) => a.kontaktId === anna.id);

  browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'de-CH' });
  const konsole = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const url = m.location()?.url ?? '';
      const st = Number(/status of (\d{3})/.exec(m.text())?.[1]);
      if (ERWARTET.some((x) => x.status === st && x.url.test(url))) return;
      konsole.push(`${m.text()} @ ${url}`);
    }
    if (m.type() === 'warning' && /Ansicht fehlgeschlagen/.test(m.text())) konsole.push(m.text());
  });
  page.on('pageerror', (e) => konsole.push(`pageerror: ${e.message}`));

  let nr = 0;
  const foto = async (name) => { nr += 1; await page.screenshot({ path: join(ausgabe, `${String(nr).padStart(2, '0')}-${name}.png`), fullPage: true }); };
  const gehe = async (hash, selektor, name) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForSelector(selektor, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#inhalt > .bbz-loading'), null, { timeout: 15000 });
    const kaputt = await page.locator('#inhalt .bbz-banner-error', { hasText: 'konnte nicht geladen werden' }).count();
    erwarte(!kaputt, `${hash}: Ansicht mit Fehler`);
    await foto(name);
  };
  const anzahl = (sel) => page.locator(sel).count();

  log('Anmeldung (dev) als ml/Admin');
  await page.goto(`${basis}/app/`);
  await page.waitForSelector('[data-testid=login]');
  await page.selectOption('#login-kuerzel', 'ml');
  await page.check('input[name=rolle][value=admin]');
  await foto('login');
  await page.click('[data-testid=login] button[type=submit]');
  await page.waitForSelector('[data-testid=cockpit]');

  log('Routen');
  await pruefe('Cockpit: Kacheln, Pipeline, Ampel, Durchführungen', async () => {
    await gehe('#/', '[data-testid=cockpit-kacheln]', 'cockpit');
    erwarte((await anzahl('[data-testid=cockpit-kacheln] .bbz-ai')) === 4, 'erwarte 4 Kacheln');
    erwarte((await anzahl('[data-testid=cockpit-pipeline] .bbz-bar-row')) === 4, 'erwarte 4 Pipeline-Phasen');
    erwarte((await anzahl('[data-testid=cockpit-ampel] li')) >= 2, 'erwarte Projekte mit Ampel ≠ grün');
    erwarte((await anzahl('[data-testid=cockpit-durchfuehrungen] .bbz-belegung')) >= 2, 'erwarte Belegungsbalken');
  });
  await pruefe('CRM Organisationen', async () => {
    await gehe('#/crm/organisationen', '[data-testid=organisationen-tabelle]', 'organisationen');
    erwarte((await anzahl('[data-testid=organisationen-tabelle] tbody tr')) >= 7, 'erwarte >= 7 Organisationen');
  });
  await pruefe('CRM Organisation 360°', () => gehe(`#/crm/organisation/${org.id}`, '[data-testid=organisation-360]', 'organisation-360'));
  await pruefe('CRM Kontakte', () => gehe('#/crm/kontakte', '[data-testid=kontakte-tabelle]', 'kontakte'));
  await pruefe('CRM Kontakt 360°', async () => {
    await gehe(`#/crm/kontakt/${kontakt.id}`, '[data-testid=kontakt-360]', 'kontakt-360');
    erwarte(await page.locator('[data-testid=kontakt-360]', { hasText: 'SAQ-PK-DEMO-001' }).count(), 'Zertifikat fehlt');
  });
  await pruefe('CRM Pipeline: 6 Phasen-Spalten', async () => {
    await gehe('#/crm/pipeline', '[data-testid=pipeline-board]', 'pipeline');
    erwarte((await anzahl('[data-testid^=pipeline-spalte-]')) === 6, 'erwarte 6 Spalten');
    erwarte((await anzahl('[data-testid=pipeline-board] [data-action=projekt-eroeffnen]')) >= 1, 'erwarte «Projekt eröffnen»');
  });
  await pruefe('CRM Anfragen-Eingang', async () => {
    await gehe('#/crm/anfragen', '[data-testid=anfragen-liste]', 'anfragen');
    erwarte((await anzahl('[data-testid=anfrage]')) >= 3, 'erwarte >= 3 Anfragen');
  });
  await pruefe('Projekte: Portfolio', async () => {
    await gehe('#/projekte', '[data-testid=portfolio-tabelle]', 'projekte');
    erwarte((await anzahl('[data-testid=portfolio-tabelle] tbody tr')) >= 4, 'erwarte >= 4 Projekte');
  });
  await pruefe('Projekt: Übersicht/Cockpit', () => gehe(`#/projekt/${p1.id}`, '[data-testid=budget-ist]', 'projekt-uebersicht'));
  await pruefe('Projekt: Aufgaben-Kanban', async () => {
    await gehe(`#/projekt/${p1.id}/aufgaben`, '[data-testid=aufgaben-kanban]', 'projekt-kanban');
    erwarte((await anzahl('[data-testid^=kanban-spalte-]')) === 4, 'erwarte 4 Kanban-Spalten');
  });
  await pruefe('Projekt: Gantt-SVG', async () => {
    await gehe(`#/projekt/${p1.id}/gantt`, '[data-testid=gantt-svg]', 'projekt-gantt');
    erwarte((await anzahl('[data-testid=gantt-svg] rect.bar-phase')) === 3, 'erwarte 3 Phasenbalken');
    erwarte((await anzahl('[data-testid=gantt-svg] polygon.ms')) === 3, 'erwarte 3 Meilensteine');
    erwarte((await anzahl('[data-testid=gantt-svg] path.dep')) >= 2, 'erwarte Abhängigkeitspfeile');
    erwarte((await anzahl('[data-testid=gantt-svg] line.today')) === 1, 'erwarte Heute-Linie');
  });
  for (const tab of ['phasen', 'zeit', 'einsaetze', 'rechnungen']) {
    await pruefe(`Projekt: Tab ${tab}`, () => gehe(`#/projekt/${p1.id}/${tab}`, `[data-testid=projekt-tab-${tab}]`, `projekt-${tab}`));
  }
  await pruefe('Meine Zeit: Wochenraster', async () => {
    await gehe('#/zeit', '[data-testid=zeit-woche]', 'meine-zeit');
    erwarte((await anzahl('[data-testid=zeit-woche] input[name^="h__"]')) >= 7, 'erwarte Eingabefelder je Tag');
  });
  await pruefe('Bildung: Durchführungen', () => gehe('#/bildung/durchfuehrungen', '[data-testid=durchfuehrungen-tabelle]', 'durchfuehrungen'));
  await pruefe('Bildung: Kursangebote', () => gehe('#/bildung/kurse', '[data-testid=kurse-tabelle]', 'kursangebote'));
  await pruefe('Bildung: Rezertifizierung fällig', async () => {
    await gehe('#/bildung/rezertifizierung', '[data-testid=rezert-tabelle]', 'rezertifizierung');
  });
  await pruefe('Bildung: Durchführung mit Belegung und Warteliste', async () => {
    await gehe(`#/bildung/durchfuehrung/${dBef.id}`, '[data-testid=teilnehmende]', 'durchfuehrung');
    erwarte(await page.locator('[data-testid=teilnehmende]', { hasText: 'Warteliste' }).count(), 'Warteliste fehlt');
  });
  await pruefe('SAQ: Vorgänge (oder Hinweis «noch nicht verfügbar»)', () => gehe('#/saq', '[data-testid=saq-tabelle], [data-testid=modul-fehlt]', 'saq'));
  await pruefe('SAQ: Kennzahlen', () => gehe('#/saq/kennzahlen', '[data-testid=saq-kennzahlen], [data-testid=modul-fehlt]', 'saq-kennzahlen'));
  await pruefe('Finanzen: Rechnungen', async () => {
    await gehe('#/finanzen/rechnungen', '[data-testid=rechnungen-tabelle]', 'rechnungen');
    erwarte((await anzahl('[data-testid=rechnungen-tabelle] tbody tr')) >= 3, 'erwarte >= 3 Rechnungen');
  });
  await pruefe('Finanzen: Rechnung mit Positionen', () => gehe(`#/finanzen/rechnung/${rechnung.id}`, '[data-testid=positionen]', 'rechnung'));
  await pruefe('Finanzen: Offene Posten', () => gehe('#/finanzen/offene-posten', '[data-testid=op-total]', 'offene-posten'));
  await pruefe('Finanzen: Mahnwesen (oder Hinweis)', () => gehe('#/finanzen/mahnwesen', '[data-testid=mahnvorschlag], [data-testid=modul-fehlt]', 'mahnwesen'));
  await pruefe('Ressourcen: Referent:innen', () => gehe('#/ressourcen', '[data-testid=referenten-tabelle]', 'referenten'));
  await pruefe('Ressourcen: Auslastungs-Heatmap', async () => {
    await gehe('#/ressourcen/auslastung', '[data-testid=heatmap] table', 'auslastung');
    erwarte((await anzahl('[data-testid=heatmap] td.h2, [data-testid=heatmap] td.h1')) >= 1, 'erwarte belegte Tage');
  });
  for (const b of ['mitarbeitende', 'api-clients', 'webhooks', 'outbox', 'integration', 'moodle']) {
    await pruefe(`Admin: ${b}`, () => gehe(`#/admin/${b}`, `[data-testid=admin-${b}]`, `admin-${b}`));
  }

  log('Interaktionen');
  await pruefe('Aktivität erfassen (Organisation 360°)', async () => {
    await gehe(`#/crm/organisation/${org.id}`, '[data-testid=organisation-360]', 'vor-aktivitaet');
    await page.click('.bbz-page-actions [data-action=aktivitaet-neu]');
    const dlg = page.locator('[data-testid=aktivitaet-form]');
    await dlg.waitFor();
    await dlg.locator('select[name=typ]').selectOption('meeting');
    await dlg.locator('input[name=betreff]').fill('E2E: Strategiegespräch');
    await dlg.locator('select[name=kontaktId]').selectOption({ label: 'Anna Muster' });
    await dlg.locator('textarea[name=notizen]').fill('Notiz mit <b>Markup</b> & "Zeichen"');
    await dlg.locator('button[type=submit]').click();
    await page.waitForSelector('.bbz-toast-success:has-text("Aktivität erfasst")');
    await page.locator('[data-testid=organisation-360]', { hasText: 'E2E: Strategiegespräch' }).waitFor();
    erwarte(await page.locator('[data-testid=organisation-360]', { hasText: 'Notiz mit <b>Markup</b>' }).count(), 'Notiz nicht escaped angezeigt');
    erwarte(!(await page.locator('[data-testid=organisation-360] b', { hasText: 'Markup' }).count()), 'HTML aus Nutzereingabe wurde interpretiert (XSS)');
    await foto('aktivitaet-erfasst');
  });
  await pruefe('Kanban: Aufgabe per Drag&Drop nach «In Arbeit»', async () => {
    await gehe(`#/projekt/${p1.id}/aufgaben`, '[data-testid=aufgaben-kanban]', 'kanban-vorher');
    await page.dragAndDrop(`[data-testid=kanban-spalte-offen] [data-dnd-id="${kickoff.id}"]`, '[data-testid=kanban-spalte-in_arbeit] .bbz-kanban-list');
    await page.waitForSelector(`[data-testid=kanban-spalte-in_arbeit] [data-dnd-id="${kickoff.id}"]`, { timeout: 10000 });
    const a = await api(basis, `/aufgabe/${kickoff.id}`);
    erwarte(a.status === 'in_arbeit', `Status ist ${a.status}`);
    await foto('kanban-verschoben');
  });
  await pruefe('Kanban: Vorgänger nicht erledigt -> 409-Meldung', async () => {
    await page.click(`[data-dnd-id="${workshop.id}"] button[data-action=aufgabe-schieben][aria-label^="Nach In Arbeit"]`);
    await page.waitForSelector('.bbz-toast-error:has-text("Vorgaenger")', { timeout: 10000 });
    await page.waitForSelector(`[data-testid=kanban-spalte-offen] [data-dnd-id="${workshop.id}"]`);
    await foto('kanban-409');
  });
  await pruefe('Storno mit Annullationskosten und Nachrücken', async () => {
    await gehe(`#/bildung/durchfuehrung/${dBef.id}`, '[data-testid=teilnehmende]', 'vor-storno');
    await page.click(`.bbz-desktop-only [data-action=stornieren][data-id="${annaAnmeldung.id}"]`);
    const dlg = page.locator('[data-testid=storno-form]');
    await dlg.waitFor();
    await dlg.locator('input[name=grund]').fill('E2E: Terminkollision');
    await dlg.locator('button[type=submit]').click();
    const kosten = page.locator('[data-testid=annullationskosten]');
    await kosten.waitFor();
    erwarte(/1.450\.00/.test(await kosten.innerText()), `Annullationskosten: ${await kosten.innerText()}`);
    erwarte(await page.locator('[data-testid=storno-ergebnis]', { hasText: 'Nina Probe-Muster' }).count(), 'Nachrücken nicht angezeigt');
    await foto('storno-ergebnis');
    await page.click('[data-testid=storno-ergebnis] .bbz-modal-footer button');
  });
  await pruefe('Teilnehmer:in anmelden (neue Person)', async () => {
    await gehe(`#/bildung/durchfuehrung/${dSaq.id}`, '[data-testid=teilnehmende]', 'vor-anmeldung');
    await page.click('[data-action=anmelden]');
    const dlg = page.locator('[data-testid=anmeldung-form]');
    await dlg.waitFor();
    await dlg.locator('input[name=personModus][value=neu]').check();
    await dlg.locator('input[name=neuEmail]').fill('erika.testmuster@musterbank.example');
    await dlg.locator('input[name=neuVorname]').fill('Erika');
    await dlg.locator('input[name=neuNachname]').fill('Testmuster');
    await dlg.locator('select[name=neuOrganisationId]').selectOption({ label: 'Musterbank AG' });
    await dlg.locator('button[type=submit]').click();
    await page.waitForSelector('.bbz-toast-success:has-text("Angemeldet")');
    await page.locator('[data-testid=teilnehmende]', { hasText: 'Erika Testmuster' }).waitFor();
    const liste = await api(basis, `/durchfuehrung/${dSaq.id}/teilnehmerliste`);
    erwarte(liste.some((t) => t.nachname === 'Testmuster'), 'Anmeldung nicht gespeichert');
    await foto('anmeldung-erfasst');
  });

  log('Mobile (390 px)');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [hash, sel, name] of [['#/', '[data-testid=cockpit]', 'mobil-cockpit'], ['#/crm/pipeline', '[data-testid=pipeline-board]', 'mobil-pipeline'], ['#/ressourcen/auslastung', '[data-testid=heatmap]', 'mobil-auslastung']]) {
    await pruefe(`Mobil ohne horizontalen Scroll: ${hash}`, async () => {
      await gehe(hash, sel, name);
      const ueber = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      erwarte(ueber <= 1, `Seite ${ueber}px zu breit`);
      erwarte(await page.locator('.bbz-bottom-nav').isVisible(), 'Bottom-Navigation nicht sichtbar');
    });
  }

  if (konsole.length) fehler.push(...konsole.map((k) => `Konsole: ${k}`));
} catch (e) {
  fehler.push(`Abbruch: ${e.stack ?? e}`);
} finally {
  await browser?.close();
  server?.proc.kill();
}

log(`\nScreenshots: ${ausgabe}`);
if (fehler.length) {
  console.error(`\nE2E FEHLGESCHLAGEN (${fehler.length}):\n- ${fehler.join('\n- ')}`);
  process.exit(1);
}
log('E2E erfolgreich.');

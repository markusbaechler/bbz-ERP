import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { csvRecords } from './csv';
import { gruppiereProjekte } from './gruppen';
import { importStammdaten } from './stammdaten';
import { importAuftraggeber } from './auftraggeber';
import { importProjekte } from './projekte';
import { vergleiche, formatReport, type ImportReport } from './report';
import { fmProjektNummer, fmText } from './normalize';
import { projektSummen } from '../repos/projektRepo';
import { setzeRechnungZaehler } from '../repos/zaehlerRepo';

const ZAEHLER_HINWEIS =
  'Kein --rechnung-max uebergeben. Der Faktura-Export ist veraltet (hoechste Nr. 31491 vom 26.06.2025), ' +
  'der Livebeleg vom Juli 2026 traegt bereits Nr. 33214. Den aktuellen Hoechststand in FileMaker ablesen ' +
  'und explizit uebergeben, sonst werden Rechnungsnummern doppelt vergeben.';

export async function fuehreMigrationAus(pool: pg.Pool, opts: {
  projekteCsv: string; modus: 'dry-run' | 'apply'; rechnungMax?: number;
}): Promise<ImportReport> {
  const { records } = csvRecords(readFileSync(opts.projekteCsv, 'utf8'));
  const gruppen = gruppiereProjekte(records);

  // Jahr aus der ersten Projektnummer — der Export ist jahresweise (Befund B1).
  const ersteNr = fmText(gruppen[0]?.projekt['Projekt_Nr.']);
  const jahr = ersteNr === null ? null : fmProjektNummer(ersteNr).jahr;

  if (opts.modus === 'dry-run') {
    // Kein Schreibzugriff: nur zaehlen, was der Export enthaelt.
    const nummern = new Set(gruppen.map((g) => fmText(g.projekt['Auftraggeber_Nr.'])).filter((n): n is string => n !== null));
    const summe = (spalte: string) => Math.round(gruppen.reduce((s, g) => s + (Number(String(g.projekt[spalte] ?? '').replace(/['’\s]/g, '')) || 0), 0) * 100) / 100;
    return {
      quelle: opts.projekteCsv, modus: 'dry-run', jahr,
      auftraggeber: { gelesen: nummern.size, neu: 0, aktualisiert: 0, ohneAdresse: nummern.size },
      projekte: { gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0 },
      konten: { angelegt: 0, vorhanden: 0 },
      mwstSaetze: { angelegt: 0, vorhanden: 0 },
      zaehler: { gesetztAuf: null, hinweis: opts.rechnungMax === undefined ? ZAEHLER_HINWEIS : 'Dry-Run: Zaehler nicht veraendert.' },
      summen: {
        budgetChf: vergleiche(summe('Budget CHF'), null),
        offenProv: vergleiche(summe('offen_prov.'), null),
        abgerechnet: vergleiche(summe('abgerechnet'), null),
      },
      warnungen: [],
    };
  }

  const stamm = await importStammdaten(pool);
  const ag = await importAuftraggeber(pool, gruppen);
  const pr = await importProjekte(pool, gruppen, ag.idNachNummer);
  const db = jahr === null ? null : await projektSummen(pool, jahr);

  let gesetztAuf: number | null = null;
  let hinweis: string | null = ZAEHLER_HINWEIS;
  if (opts.rechnungMax !== undefined) {
    gesetztAuf = await setzeRechnungZaehler(pool, opts.rechnungMax);
    hinweis = null;
  }

  return {
    quelle: opts.projekteCsv, modus: 'apply', jahr,
    auftraggeber: { gelesen: ag.gelesen, neu: ag.neu, aktualisiert: ag.aktualisiert, ohneAdresse: ag.ohneAdresse },
    projekte: { gelesen: pr.gelesen, neu: pr.neu, aktualisiert: pr.aktualisiert, uebersprungen: pr.uebersprungen },
    konten: stamm.konten, mwstSaetze: stamm.mwstSaetze,
    zaehler: { gesetztAuf, hinweis },
    summen: {
      budgetChf: vergleiche(pr.csvSummen.budgetChf, db?.budgetChf ?? null),
      offenProv: vergleiche(pr.csvSummen.offenProv, db?.offenProv ?? null),
      abgerechnet: vergleiche(pr.csvSummen.abgerechnet, db?.abgerechnet ?? null),
    },
    warnungen: [...ag.warnungen, ...pr.warnungen],
  };
}

// CLI: npm run migrate:fm -- --projekte=../fm-discovery/export/export_daten.csv [--apply] [--rechnung-max=33214]
// pathToFileURL statt manueller string-Bau: unter Windows braucht ein Laufwerkspfad
// "file:///C:/..." (drei Slashes) — ein simples Template-Literal liefert nur zwei.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const projekteCsv = arg('projekte');
  if (!projekteCsv) {
    console.error('Aufruf: npm run migrate:fm -- --projekte=<pfad.csv> [--apply] [--rechnung-max=<n>]');
    process.exit(2);
  }
  const rechnungMaxArg = arg('rechnung-max');
  const { getPool, closePool } = await import('../db/pool');
  const { runMigrations } = await import('../db/migrate');
  const pool = getPool();
  await runMigrations(pool);
  const report = await fuehreMigrationAus(pool, {
    projekteCsv,
    modus: process.argv.includes('--apply') ? 'apply' : 'dry-run',
    rechnungMax: rechnungMaxArg === undefined ? undefined : Number(rechnungMaxArg),
  });
  console.log(formatReport(report));
  await closePool();
  const abweichung = Object.values(report.summen).some((s) => !s.ok);
  process.exit(abweichung ? 1 : 0);
}

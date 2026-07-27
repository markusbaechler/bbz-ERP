import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { csvRecords } from './csv';
import { gruppiereProjekte } from './gruppen';
import { importStammdaten } from './stammdaten';
import { importAuftraggeber, sammleAuftraggeber } from './auftraggeber';
import { importProjekte, projektUebersprungenGrund } from './projekte';
import { vergleiche, formatReport, type ImportReport } from './report';
import { fmProjektNummer, fmText, fmZahl } from './normalize';
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
    // Kein Schreibzugriff: nur zaehlen, was der Export enthaelt — mit denselben
    // Ueberspring-Regeln (projektUebersprungenGrund) und derselben Zahlenauswertung
    // (fmZahl) wie der Apply-Import, damit Dry-Run und Apply nie auseinanderlaufen.
    const { gesehen: auftraggeberGesehen, warnungen: auftraggeberWarnungen } = sammleAuftraggeber(gruppen);
    const auftraggeberNummern = new Set(auftraggeberGesehen.keys());

    let uebersprungen = 0;
    let budgetChf = 0, offenProv = 0, abgerechnet = 0;
    const projektWarnungen: string[] = [];
    for (const g of gruppen) {
      const projektNr = fmText(g.projekt['Projekt_Nr.']) ?? '(ohne Nr.)';
      const grund = projektUebersprungenGrund(g, auftraggeberNummern);
      if (grund !== null) {
        uebersprungen++;
        projektWarnungen.push(`Projekt ${projektNr}: ${grund}`);
        continue;
      }
      budgetChf += fmZahl(g.projekt['Budget CHF']) ?? 0;
      offenProv += fmZahl(g.projekt['offen_prov.']) ?? 0;
      abgerechnet += fmZahl(g.projekt['abgerechnet']) ?? 0;
    }
    budgetChf = Math.round(budgetChf * 100) / 100;
    offenProv = Math.round(offenProv * 100) / 100;
    abgerechnet = Math.round(abgerechnet * 100) / 100;

    return {
      quelle: opts.projekteCsv, modus: 'dry-run', jahr,
      auftraggeber: { gelesen: auftraggeberNummern.size, neu: 0, aktualisiert: 0, ohneAdresse: auftraggeberNummern.size },
      projekte: { gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen },
      konten: { angelegt: 0, vorhanden: 0 },
      mwstSaetze: { angelegt: 0, vorhanden: 0 },
      zaehler: { gesetztAuf: null, hinweis: opts.rechnungMax === undefined ? ZAEHLER_HINWEIS : 'Dry-Run: Zaehler nicht veraendert.' },
      summen: {
        budgetChf: vergleiche(budgetChf, null),
        offenProv: vergleiche(offenProv, null),
        abgerechnet: vergleiche(abgerechnet, null),
      },
      warnungen: [...auftraggeberWarnungen, ...projektWarnungen],
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
  const modus: 'dry-run' | 'apply' = process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const { getPool, closePool } = await import('../db/pool');
  const pool = getPool();
  // Migrationen (Schema-DDL) nur im Apply-Modus ausfuehren — der Dry-Run darf die
  // Datenbank nicht anfassen, auch nicht mit einer reinen Schema-Aenderung.
  if (modus === 'apply') {
    const { runMigrations } = await import('../db/migrate');
    await runMigrations(pool);
  }

  let report: ImportReport;
  try {
    report = await fuehreMigrationAus(pool, {
      projekteCsv,
      modus,
      rechnungMax: rechnungMaxArg === undefined ? undefined : Number(rechnungMaxArg),
    });
  } catch (e) {
    const fehler = e as NodeJS.ErrnoException;
    if (fehler && typeof fehler.code === 'string' && ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR'].includes(fehler.code)) {
      console.error(`CSV-Datei "${projekteCsv}" kann nicht gelesen werden (${fehler.code}).`);
      await closePool();
      process.exit(2);
    }
    throw e;
  }
  console.log(formatReport(report));
  await closePool();
  const abweichung = Object.values(report.summen).some((s) => !s.ok);
  process.exit(abweichung ? 1 : 0);
}

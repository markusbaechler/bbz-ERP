import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { csvRecords } from './csv';
import { gruppiereProjekte } from './gruppen';
import { importStammdaten, KONTENPLAN } from './stammdaten';
import { importAuftraggeber, sammleAuftraggeber } from './auftraggeber';
import {
  importProjekte, projektUebersprungenGrund, pruefeProjekt, kontoWarnung,
  doppelteProjektNummern,
} from './projekte';
import { vergleiche, formatReport, type ImportReport } from './report';
import { fmText } from './normalize';
import { projektSummenFuerSchluessel, type ProjektSchluessel } from '../repos/projektRepo';
import { setzeRechnungZaehler } from '../repos/zaehlerRepo';

const ZAEHLER_HINWEIS =
  'Kein --rechnung-max uebergeben. Der Faktura-Export ist veraltet (hoechste Nr. 31491 vom 26.06.2025), ' +
  'der Livebeleg vom Juli 2026 traegt bereits Nr. 33214. Den aktuellen Hoechststand in FileMaker ablesen ' +
  'und explizit uebergeben, sonst werden Rechnungsnummern doppelt vergeben.';

const DRY_RUN_KONTEN_HINWEIS =
  'Der Dry-Run prueft Konto/Aufw. Konto gegen den fest hinterlegten KONTENPLAN ' +
  '(src/migration/stammdaten.ts), nicht gegen die Datenbank — er darf nichts lesen und nichts schreiben. ' +
  'Konten, die nachtraeglich per REST erfasst wurden, sieht er darum nicht; der Apply-Lauf kann hier ' +
  'weniger Kontierungs-Warnungen melden.';

// Jahrgaenge eines Laufs, aufsteigend und ohne Dubletten.
const jahrgaenge = (schluessel: ProjektSchluessel[]): number[] =>
  [...new Set(schluessel.map((s) => s.jahr))].sort((a, b) => a - b);

export async function fuehreMigrationAus(pool: pg.Pool, opts: {
  projekteCsv: string; modus: 'dry-run' | 'apply'; rechnungMax?: number;
}): Promise<ImportReport> {
  const { records } = csvRecords(readFileSync(opts.projekteCsv, 'utf8'));
  const gruppen = gruppiereProjekte(records);

  if (opts.modus === 'dry-run') {
    // Kein Schreib- und kein Lesezugriff: nur zaehlen, was der Export enthaelt — mit
    // denselben Ueberspring-Regeln (projektUebersprungenGrund) und denselben Pruefungen
    // (pruefeProjekt) wie der Apply-Import, damit Dry-Run und Apply weder in den Zahlen
    // noch im Warnungssatz auseinanderlaufen.
    const {
      gesehen: auftraggeberGesehen, warnungen: auftraggeberWarnungen, datenbefunde: auftraggeberBefunde,
    } = sammleAuftraggeber(gruppen);
    const auftraggeberNummern = new Set(auftraggeberGesehen.keys());
    const bekannteKonten = new Set<string>(KONTENPLAN.map((k) => k.nummer));

    let uebersprungen = 0;
    let budgetChf = 0, offenProv = 0, abgerechnet = 0;
    const schluessel: ProjektSchluessel[] = [];
    const projektWarnungen: string[] = doppelteProjektNummern(gruppen);
    for (const g of gruppen) {
      const projektNr = fmText(g.projekt['Projekt_Nr.']) ?? '(ohne Nr.)';
      const grund = projektUebersprungenGrund(g, auftraggeberNummern);
      if (grund !== null) {
        uebersprungen++;
        projektWarnungen.push(`Projekt ${projektNr}: ${grund}`);
        continue;
      }
      const pruefung = pruefeProjekt(g);
      projektWarnungen.push(...pruefung.warnungen);
      for (const feld of ['Konto', 'Aufw. Konto'] as const) {
        const nummer = fmText(g.projekt[feld]);
        if (nummer !== null && !bekannteKonten.has(nummer)) projektWarnungen.push(kontoWarnung(projektNr, feld, nummer));
      }
      schluessel.push({ stammnummer: pruefung.stammnummer, jahr: pruefung.jahr });
      budgetChf += pruefung.zahlen.budgetChf ?? 0;
      offenProv += pruefung.zahlen.offenProv ?? 0;
      abgerechnet += pruefung.zahlen.abgerechnet ?? 0;
    }
    budgetChf = Math.round(budgetChf * 100) / 100;
    offenProv = Math.round(offenProv * 100) / 100;
    abgerechnet = Math.round(abgerechnet * 100) / 100;
    const jahre = jahrgaenge(schluessel);

    return {
      quelle: opts.projekteCsv, modus: 'dry-run', jahr: jahre.length === 1 ? jahre[0] : null, jahre,
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
      datenbefunde: auftraggeberBefunde,
      hinweise: [DRY_RUN_KONTEN_HINWEIS],
    };
  }

  const stamm = await importStammdaten(pool);
  const ag = await importAuftraggeber(pool, gruppen);
  const pr = await importProjekte(pool, gruppen, ag.idNachNummer);
  // Abgleich ausschliesslich ueber die Projekte, die dieser Lauf geschrieben hat —
  // nicht ueber "alle Projekte des Jahres": das schloss fremde Datensaetze ein und
  // liess bei mehrjaehrigen Dateien alle uebrigen Jahrgaenge weg.
  const db = await projektSummenFuerSchluessel(pool, pr.schluessel);
  const jahre = jahrgaenge(pr.schluessel);

  let gesetztAuf: number | null = null;
  let hinweis: string | null = ZAEHLER_HINWEIS;
  if (opts.rechnungMax !== undefined) {
    gesetztAuf = await setzeRechnungZaehler(pool, opts.rechnungMax);
    hinweis = null;
  }

  return {
    quelle: opts.projekteCsv, modus: 'apply', jahr: jahre.length === 1 ? jahre[0] : null, jahre,
    auftraggeber: { gelesen: ag.gelesen, neu: ag.neu, aktualisiert: ag.aktualisiert, ohneAdresse: ag.ohneAdresse },
    projekte: { gelesen: pr.gelesen, neu: pr.neu, aktualisiert: pr.aktualisiert, uebersprungen: pr.uebersprungen },
    konten: stamm.konten, mwstSaetze: stamm.mwstSaetze,
    zaehler: { gesetztAuf, hinweis },
    // Toleranz je Kennzahl aus der Zahl der tatsaechlich gerundeten Betraege — nicht
    // aus der Projektzahl (siehe vergleiche in report.ts).
    summen: {
      budgetChf: vergleiche(pr.csvSummen.budgetChf, db.budgetChf, pr.csvGerundet.budgetChf),
      offenProv: vergleiche(pr.csvSummen.offenProv, db.offenProv, pr.csvGerundet.offenProv),
      abgerechnet: vergleiche(pr.csvSummen.abgerechnet, db.abgerechnet, pr.csvGerundet.abgerechnet),
    },
    warnungen: [...ag.warnungen, ...pr.warnungen],
    datenbefunde: ag.datenbefunde,
    hinweise: [],
  };
}

// CLI-Grenze: --rechnung-max muss hier validiert werden. `Number('abc')` lieferte NaN
// und schlug erst tief in setzeRechnungZaehler als Stacktrace auf; `--rechnung-max=`
// wurde klaglos zu 0 und damit zu einem stillen Zaehler-Rueckwaertssetzen-Versuch.
export function parseRechnungMax(roh: string | undefined): { wert?: number; fehler?: string } {
  if (roh === undefined) return {};
  const t = roh.trim();
  const n = Number(t);
  if (!/^\d+$/.test(t) || !Number.isSafeInteger(n) || n <= 0) {
    return {
      fehler: `--rechnung-max="${roh}" ist keine positive Ganzzahl. Erwartet wird der aktuelle ` +
        `Hoechststand der Rechnungsnummer aus FileMaker, z.B. --rechnung-max=33214.`,
    };
  }
  return { wert: n };
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
  const rechnungMax = parseRechnungMax(arg('rechnung-max'));
  if (rechnungMax.fehler) {
    console.error(rechnungMax.fehler);
    process.exit(2);
  }
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
    report = await fuehreMigrationAus(pool, { projekteCsv, modus, rechnungMax: rechnungMax.wert });
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

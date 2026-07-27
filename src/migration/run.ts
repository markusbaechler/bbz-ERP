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
import { importAdressen } from './adressen';
import { vergleiche, formatReport, type ImportReport } from './report';
import { fmText } from './normalize';
import { ValidationError } from '../domain/errors';
import { projektSummenFuerSchluessel, type ProjektSchluessel } from '../repos/projektRepo';
import { getZaehler, setzeRechnungZaehler } from '../repos/zaehlerRepo';
import { rechnungNrUntergrenze, zaehlerGesperrt } from '../config/rechnungszaehler';

const ZAEHLER_HINWEIS =
  'Kein --rechnung-max uebergeben. Der Faktura-Export ist veraltet (hoechste Nr. 31491 vom 26.06.2025), ' +
  'der Livebeleg vom Juli 2026 traegt bereits Nr. 33214. Den aktuellen Hoechststand in FileMaker ablesen ' +
  'und explizit uebergeben, sonst werden Rechnungsnummern doppelt vergeben. ' +
  'Dafuer braucht es keinen Import mehr: "npm run zaehler -- --rechnung-max=<n>" setzt den Zaehler allein.';

const DRY_RUN_KONTEN_HINWEIS =
  'Der Dry-Run prueft Konto/Aufw. Konto gegen den fest hinterlegten KONTENPLAN ' +
  '(src/migration/stammdaten.ts), nicht gegen die Datenbank — er darf nichts lesen und nichts schreiben. ' +
  'Konten, die nachtraeglich per REST erfasst wurden, sieht er darum nicht; der Apply-Lauf kann hier ' +
  'weniger Kontierungs-Warnungen melden.';

// Jahrgaenge eines Laufs, aufsteigend und ohne Dubletten.
const jahrgaenge = (schluessel: ProjektSchluessel[]): number[] =>
  [...new Set(schluessel.map((s) => s.jahr))].sort((a, b) => a - b);

const ADRESSEN_DRY_RUN_HINWEIS =
  'Der Adressen-Dry-Run liest die Auftraggeber (nur lesend, ueber src/repos), weil die Zuordnung ' +
  'Kunden Nr. -> Auftraggeber-Nr. erst an der Datenbank entsteht — ohne sie liesse sich weder ' +
  '"zugeordnet" noch "weiterhin gesperrt" beantworten. Geschrieben wird nichts. Darin unterscheidet ' +
  'er sich bewusst vom Projekt-Dry-Run, der die Datenbank gar nicht anfasst.';

export async function fuehreMigrationAus(pool: pg.Pool, opts: {
  projekteCsv?: string; adressenCsv?: string; modus: 'dry-run' | 'apply'; rechnungMax?: number;
}): Promise<ImportReport> {
  if (opts.projekteCsv === undefined && opts.adressenCsv === undefined) {
    throw new ValidationError('Mindestens eines von projekteCsv / adressenCsv wird gebraucht');
  }

  // Reiner Adressen-Nachtrag: der Adressexport kommt nach dem Projekt-Import, deshalb
  // muss er ohne Projektdatei laufen koennen.
  if (opts.projekteCsv === undefined) {
    const adressen = await importAdressen(pool, {
      quelle: opts.adressenCsv!, text: readFileSync(opts.adressenCsv!, 'utf8'), modus: opts.modus,
    });
    // Auch im Dry-Run: dieser Lauf liest die Datenbank ohnehin, dann kann er dem
    // Operator auch sagen, ob die Festschreibung noch von der Untergrenze blockiert wird.
    const stand = await getZaehler(pool, 'rechnung_lfd_nr');
    return {
      quelle: opts.adressenCsv!, modus: opts.modus, projekteLauf: false, jahr: null, jahre: [],
      auftraggeber: { gelesen: 0, neu: 0, aktualisiert: 0, ohneAdresse: adressen.nochOhneAdresse.length },
      projekte: { gelesen: 0, neu: 0, aktualisiert: 0, uebersprungen: 0 },
      konten: { angelegt: 0, vorhanden: 0 },
      mwstSaetze: { angelegt: 0, vorhanden: 0 },
      zaehler: {
        gesetztAuf: null, stand, untergrenze: rechnungNrUntergrenze(), gesperrt: zaehlerGesperrt(stand),
        hinweis: 'Adressen-Nachtrag: der Zaehler wird hier nicht angefasst.',
      },
      summen: {
        budgetChf: vergleiche(0, null), offenProv: vergleiche(0, null), abgerechnet: vergleiche(0, null),
      },
      adressen,
      warnungen: adressen.warnungen,
      datenbefunde: adressen.datenbefunde,
      hinweise: opts.modus === 'dry-run' ? [ADRESSEN_DRY_RUN_HINWEIS] : [],
    };
  }

  const report = await fuehreProjektMigrationAus(pool, { ...opts, projekteCsv: opts.projekteCsv });
  if (opts.adressenCsv === undefined) return report;

  // Beide Dateien in einem Lauf: erst die Projekte (sie legen die Auftraggeber an),
  // dann die Adressen — sonst faende der Nachtrag niemanden.
  const adressen = await importAdressen(pool, {
    quelle: opts.adressenCsv, text: readFileSync(opts.adressenCsv, 'utf8'), modus: opts.modus,
  });
  // Auch im kombinierten Dry-Run wurde die Datenbank durch den Adressteil gelesen —
  // dann darf der Report den Zaehlerstand nennen statt "nicht gelesen" zu behaupten.
  const stand = report.zaehler.stand ?? await getZaehler(pool, 'rechnung_lfd_nr');
  return {
    ...report,
    adressen,
    zaehler: { ...report.zaehler, stand, gesperrt: zaehlerGesperrt(stand) },
    auftraggeber: { ...report.auftraggeber, ohneAdresse: adressen.nochOhneAdresse.length },
    warnungen: [...report.warnungen, ...adressen.warnungen],
    datenbefunde: [...report.datenbefunde, ...adressen.datenbefunde],
    hinweise: opts.modus === 'dry-run' ? [...report.hinweise, ADRESSEN_DRY_RUN_HINWEIS] : report.hinweise,
  };
}

async function fuehreProjektMigrationAus(pool: pg.Pool, opts: {
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
      quelle: opts.projekteCsv, modus: 'dry-run', projekteLauf: true, adressen: null,
      jahr: jahre.length === 1 ? jahre[0] : null, jahre,
      auftraggeber: { gelesen: auftraggeberNummern.size, neu: 0, aktualisiert: 0, ohneAdresse: auftraggeberNummern.size },
      projekte: { gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen },
      konten: { angelegt: 0, vorhanden: 0 },
      mwstSaetze: { angelegt: 0, vorhanden: 0 },
      // stand/gesperrt bleiben null: der Dry-Run liest die Datenbank nicht.
      zaehler: {
        gesetztAuf: null, stand: null, untergrenze: rechnungNrUntergrenze(), gesperrt: null,
        hinweis: opts.rechnungMax === undefined ? ZAEHLER_HINWEIS : 'Dry-Run: Zaehler nicht veraendert.',
      },
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
    gesetztAuf = await setzeRechnungZaehler(pool, opts.rechnungMax, 'CLI migrate:fm --rechnung-max');
    hinweis = null;
  }
  // Stand nach dem Lauf — auch wenn dieser Lauf nichts gesetzt hat: der Operator
  // liest hier ab, ob die Festschreibung offen ist oder die Untergrenze noch blockt.
  const stand = await getZaehler(pool, 'rechnung_lfd_nr');

  return {
    quelle: opts.projekteCsv, modus: 'apply', projekteLauf: true, adressen: null,
    jahr: jahre.length === 1 ? jahre[0] : null, jahre,
    auftraggeber: { gelesen: ag.gelesen, neu: ag.neu, aktualisiert: ag.aktualisiert, ohneAdresse: ag.ohneAdresse },
    projekte: { gelesen: pr.gelesen, neu: pr.neu, aktualisiert: pr.aktualisiert, uebersprungen: pr.uebersprungen },
    konten: stamm.konten, mwstSaetze: stamm.mwstSaetze,
    zaehler: { gesetztAuf, stand, untergrenze: rechnungNrUntergrenze(), gesperrt: zaehlerGesperrt(stand), hinweis },
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

// CLI: npm run migrate:fm -- [--projekte=<pfad.csv>] [--adressen=<pfad.csv>] [--apply] [--rechnung-max=33214]
// pathToFileURL statt manueller string-Bau: unter Windows braucht ein Laufwerkspfad
// "file:///C:/..." (drei Slashes) — ein simples Template-Literal liefert nur zwei.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const projekteCsv = arg('projekte');
  const adressenCsv = arg('adressen');
  // --projekte war Pflicht. Der Adressexport kommt aber erst nach dem Projekt-Import;
  // ein Nachtrag muss allein laufen koennen. Verlangt wird darum nur noch, dass es
  // ueberhaupt etwas zu tun gibt.
  if (!projekteCsv && !adressenCsv) {
    console.error(
      'Aufruf: npm run migrate:fm -- [--projekte=<pfad.csv>] [--adressen=<pfad.csv>] [--apply] [--rechnung-max=<n>]\n' +
      'Mindestens eines von --projekte / --adressen wird gebraucht. ' +
      '--adressen allein traegt die Auftraggeber-Adressen nach.');
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
    report = await fuehreMigrationAus(pool, { projekteCsv, adressenCsv, modus, rechnungMax: rechnungMax.wert });
  } catch (e) {
    const fehler = e as NodeJS.ErrnoException;
    if (fehler && typeof fehler.code === 'string' && ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR'].includes(fehler.code)) {
      // fehler.path nennt die Datei, an der es wirklich scheiterte — mit zwei moeglichen
      // Eingabedateien waere ein fest verdrahteter Name schlicht falsch.
      console.error(`CSV-Datei "${fehler.path ?? projekteCsv ?? adressenCsv}" kann nicht gelesen werden (${fehler.code}).`);
      await closePool();
      process.exit(2);
    }
    // Der Adressen-Dry-Run liest die Auftraggeber; ohne Schema gibt es nichts zu lesen.
    if (fehler && (fehler as { code?: string }).code === '42P01') {
      console.error(
        'In der Datenbank gibt es noch kein Schema. Der Adressen-Nachtrag setzt den Projekt-Import ' +
        'voraus: zuerst "npm run migrate:fm -- --projekte=<pfad.csv> --apply" laufen lassen.');
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

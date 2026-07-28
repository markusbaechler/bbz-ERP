import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import type { MigrationProjektInput } from '../domain/types';
import { fmText, fmZahl, fmProjektNummer, istProjektNummer, fmBereich } from './normalize';
import { listKonten } from '../repos/kontoRepo';
import { upsertProjektAusMigration, type ProjektSchluessel } from '../repos/projektRepo';

export type Betragssummen = { budgetChf: number; offenProv: number; abgerechnet: number };

export type ProjektImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; uebersprungen: number;
  /** Konten in der Datenbank zum Zeitpunkt des Laufs — 0 heisst: `--konten=` fehlt noch. */
  kontenBestand: number;
  csvSummen: Betragssummen;
  /**
   * Je Kennzahl die Zahl der CSV-Betraege, die beim Schreiben als numeric(12,2)
   * gerundet werden mussten (mehr als zwei Nachkommastellen). Nur sie erzeugen
   * ueberhaupt Rundungsspielraum — der Summenabgleich leitet daraus seine Toleranz ab.
   */
  csvGerundet: Betragssummen;
  /** (stammnummer, jahr) genau der Projekte, die dieser Lauf geschrieben hat. */
  schluessel: ProjektSchluessel[];
  warnungen: string[];
};

/** true, wenn der Wert als numeric(12,2) nicht verlustfrei gespeichert werden kann. */
export const wirdGerundet = (n: number | null): boolean => n !== null && Math.round(n * 100) / 100 !== n;

// Zwei Zeilen mit derselben Projekt_Nr. eroeffnen zwei Gruppen, landen wegen des
// Upserts auf (stammnummer, jahr) aber in einem einzigen Datensatz: die letzte
// gewinnt, die uebrigen sind still weg. Das ist ein Datenfehler im Export, den der
// Operator sehen muss — und zugleich der Grund, warum die Schluesselliste des
// Abgleichs dedupliziert wird (projektSummenFuerSchluessel).
export function doppelteProjektNummern(gruppen: ProjektGruppe[]): string[] {
  const zaehler = new Map<string, number>();
  for (const g of gruppen) {
    const nr = fmText(g.projekt['Projekt_Nr.']);
    if (nr === null) continue;
    zaehler.set(nr, (zaehler.get(nr) ?? 0) + 1);
  }
  return [...zaehler]
    .filter(([, n]) => n > 1)
    .map(([nr, n]) =>
      `Projekt ${nr}: ${n} Zeilen mit derselben Projekt_Nr. im Export — nur die zuletzt gelesene ` +
      `wird gespeichert, die Betraege der uebrigen fehlen in der Datenbank`);
}

// Die drei Beträge des Summenabgleichs plus die beiden weiteren Zahlfelder.
export type ProjektZahlen = {
  budgetChf: number | null; offenProv: number | null; abgerechnet: number | null;
  budgetTage: number | null; aufwandBudgetChf: number | null;
};

export type ProjektPruefung = {
  stammnummer: number; jahr: number;
  zahlen: ProjektZahlen;
  mwstModus: 'exkl' | 'inkl';
  warnungen: string[];
};

// Einheitlicher Text, damit Dry-Run und Apply dieselbe Warnung erzeugen. Beide pruefen
// seit dem Wegfall der erfundenen Kontenliste gegen dieselbe Quelle: die Datenbank.
export const kontoWarnung = (projektNr: string, feld: string, nummer: string): string =>
  `Projekt ${projektNr}: ${feld} "${nummer}" nicht im Kontenplan — Kontierung bleibt offen`;

// Ist der Kontenplan gar nicht importiert, hat jedes Projekt dieselbe Ursache. Vorher
// standen dafuer 151 gleichlautende Zeilen im Report; der Operator musste sie einzeln
// lesen, um zu merken, dass ihm eine Datei fehlt. Jetzt steht es einmal da.
export const KONTENPLAN_LEER_WARNUNG =
  'Kontenplan nicht importiert — alle Kontierungen bleiben offen; zuerst `--konten=` laufen lassen ' +
  '(npm run migrate:fm -- --konten=<pfad.csv> --apply)';

/**
 * Der Kontenplan aus der Datenbank, einmal je Lauf. Einzige Quelle der Kontierung —
 * eine im Code hinterlegte Liste gibt es nicht mehr. Dry-Run und Apply rufen dieselbe
 * Funktion, damit beide denselben Warnungssatz erzeugen; der Dry-Run liest damit die
 * Datenbank (nur lesend, ueber src/repos) und schreibt weiterhin nichts.
 */
export async function ladeKontenplan(pool: pg.Pool): Promise<{
  idNachNummer: Map<string, string>; bestand: number; warnungen: string[];
}> {
  const konten = await listKonten(pool);
  return {
    idNachNummer: new Map(konten.map((k) => [k.nummer, k.id])),
    bestand: konten.length,
    warnungen: konten.length === 0 ? [KONTENPLAN_LEER_WARNUNG] : [],
  };
}

// Alle Pruefungen eines importierbaren Projekts, die ohne Datenbank auskommen.
// Apply-Import und Dry-Run-Vorschau rufen dieselbe Funktion, damit beide Modi
// denselben Warnungssatz erzeugen (nur die Kontenpruefung hat je Modus eine
// andere Quelle und wird darum vom Aufrufer ergaenzt).
// Voraussetzung: projektUebersprungenGrund hat null geliefert.
export function pruefeProjekt(g: ProjektGruppe): ProjektPruefung {
  const p = g.projekt;
  const projektNr = fmText(p['Projekt_Nr.'])!;
  const warnungen: string[] = [];
  const { stammnummer, jahr } = fmProjektNummer(projektNr);

  const jahrSpalte = fmZahl(p['Jahr']);
  if (jahrSpalte !== null && jahrSpalte !== jahr) {
    warnungen.push(`Projekt ${projektNr}: Spalte Jahr=${jahrSpalte} weicht von der Nummer ab — ${jahr} verwendet`);
  }

  // Ein nicht lesbarer Betrag wird null und faellt damit auf beiden Seiten des
  // Abgleichs als 0 weg — der Abgleich meldet "ok", das Geld ist trotzdem weg.
  // Darum hier melden, mit Feldname und Rohwert.
  const zahl = (feld: string): number | null => {
    const roh = fmText(p[feld]);
    const n = fmZahl(p[feld]);
    if (roh !== null && n === null) {
      warnungen.push(`Projekt ${projektNr}: ${feld} "${roh}" ist keine lesbare Zahl — Wert bleibt leer und fehlt im Summenabgleich`);
    }
    return n;
  };
  const zahlen: ProjektZahlen = {
    budgetChf: zahl('Budget CHF'),
    offenProv: zahl('offen_prov.'),
    abgerechnet: zahl('abgerechnet'),
    budgetTage: zahl('Budget Tage'),
    aufwandBudgetChf: zahl('Aufw. Budget CHF'),
  };

  // mwst_modus entscheidet, ob ein Budget brutto oder netto gemeint ist. Leer ->
  // exkl (Schema-Default, korrekt); ein nicht erkannter Wert wird gemeldet.
  const mwstRoh = fmText(p['MWSt']);
  let mwstModus: 'exkl' | 'inkl' = 'exkl';
  if (mwstRoh !== null) {
    const t = mwstRoh.toLowerCase();
    if (t.startsWith('inkl')) mwstModus = 'inkl';
    else if (!t.startsWith('exkl')) {
      warnungen.push(`Projekt ${projektNr}: MWSt "${mwstRoh}" nicht erkannt — exkl. angenommen, Budget als Nettobetrag gewertet`);
    }
  }

  return { stammnummer, jahr, zahlen, mwstModus, warnungen };
}

// Reine CSV-Entscheidung, ob ein Projekt uebersprungen wuerde — ohne DB-Zugriff.
// `auftraggeberNummern` ist die Menge der Auftraggeber-Nummern, die ueberhaupt importierbar
// sind (siehe sammleAuftraggeber in auftraggeber.ts). Diese Funktion ist die einzige Stelle,
// die "uebersprungen" definiert; sowohl der Apply-Import (unten) als auch die Dry-Run-Vorschau
// (run.ts) rufen sie auf, damit beide Modi zwingend dasselbe Ergebnis liefern.
export function projektUebersprungenGrund(g: ProjektGruppe, auftraggeberNummern: Set<string>): string | null {
  const p = g.projekt;
  const name = fmText(p['Projekt_Name']);
  const auftraggeberNr = fmText(p['Auftraggeber_Nr.']);
  // Zuerst die Nummer: ohne sie gibt es weder Stammnummer noch Jahr. Frueher warf
  // erst fmProjektNummer weiter unten — das riss den ganzen Lauf mit Teilschreibungen
  // ab und liess den Dry-Run die Zeile faelschlich als importierbar zaehlen.
  if (!istProjektNummer(fmText(p['Projekt_Nr.']))) {
    return 'Projekt_Nr. hat nicht das Format <Stammnummer>.<JJ> — uebersprungen';
  }
  if (name === null) return 'ohne Projekt_Name uebersprungen';
  // Die beiden Faelle sind fuer den Leser des Reports verschieden: einmal fehlt die
  // Nummer im Export, einmal ist sie da, aber der Auftraggeber selbst nicht uebernehmbar.
  if (auftraggeberNr === null) return 'ohne Auftraggeber-Nr. — uebersprungen';
  if (!auftraggeberNummern.has(auftraggeberNr)) {
    return `Auftraggeber-Nr. ${auftraggeberNr} nicht importierbar (kein Name im Export) — uebersprungen`;
  }
  return null;
}

export async function importProjekte(
  pool: pg.Pool,
  gruppen: ProjektGruppe[],
  idNachNummer: Map<string, string>,
): Promise<ProjektImportErgebnis> {
  // Kontenplan einmal je Lauf, nicht je Kontonummer: die Datenbank fuehrt 177 Konten,
  // die passen in eine Map.
  const kontenplan = await ladeKontenplan(pool);
  const e: ProjektImportErgebnis = {
    gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0,
    kontenBestand: kontenplan.bestand,
    csvSummen: { budgetChf: 0, offenProv: 0, abgerechnet: 0 },
    csvGerundet: { budgetChf: 0, offenProv: 0, abgerechnet: 0 },
    schluessel: [], warnungen: [...doppelteProjektNummern(gruppen), ...kontenplan.warnungen],
  };
  const auftraggeberNummern = new Set(idNachNummer.keys());
  const kontoId = (nummer: string | null, projektNr: string, feld: string): string | null => {
    if (nummer === null) return null;
    const id = kontenplan.idNachNummer.get(nummer) ?? null;
    // Bei leerem Kontenplan steht der Grund schon einmal oben — nicht noch einmal je Projekt.
    if (id === null && kontenplan.bestand > 0) e.warnungen.push(kontoWarnung(projektNr, feld, nummer));
    return id;
  };

  for (const g of gruppen) {
    const p = g.projekt;
    const projektNr = fmText(p['Projekt_Nr.']) ?? '(ohne Nr.)';

    const grund = projektUebersprungenGrund(g, auftraggeberNummern);
    if (grund !== null) { e.uebersprungen++; e.warnungen.push(`Projekt ${projektNr}: ${grund}`); continue; }

    const name = fmText(p['Projekt_Name'])!;
    const auftraggeberNr = fmText(p['Auftraggeber_Nr.'])!;
    const auftraggeberId = idNachNummer.get(auftraggeberNr)!;

    const { stammnummer, jahr, zahlen, mwstModus, warnungen } = pruefeProjekt(g);
    e.warnungen.push(...warnungen);
    const { budgetChf, offenProv, abgerechnet } = zahlen;

    const input: MigrationProjektInput = {
      stammnummer, jahr, name, auftraggeberId,
      kuerzel: fmText(p['Projekt_Kürzel']),
      bereich: fmBereich(p['Bereich']),
      beschrieb: fmText(p['Beschrieb']),
      ansprechperson: fmText(p['Ansprechperson']),
      ertragskontoId: kontoId(fmText(p['Konto']), projektNr, 'Konto'),
      aufwandKontoId: kontoId(fmText(p['Aufw. Konto']), projektNr, 'Aufw. Konto'),
      budgetChf, budgetTage: zahlen.budgetTage,
      aufwandBudgetChf: zahlen.aufwandBudgetChf,
      fmOffenProv: offenProv, fmAbgerechnet: abgerechnet,
      alteProjektNr: fmText(p['alte_Projekt_Nr']),
      projektleitungKuerzel: fmText(p['Referent intern']),
      mwstModus,
      erstelltDurch: fmText(p['Erstellt durch']),
      geaendertDurch: fmText(p['geändert durch']),
    };

    const r = await upsertProjektAusMigration(pool, input);
    r.neu ? e.neu++ : e.aktualisiert++;
    e.schluessel.push({ stammnummer, jahr });
    e.csvSummen.budgetChf += budgetChf ?? 0;
    e.csvSummen.offenProv += offenProv ?? 0;
    e.csvSummen.abgerechnet += abgerechnet ?? 0;
    if (wirdGerundet(budgetChf)) e.csvGerundet.budgetChf++;
    if (wirdGerundet(offenProv)) e.csvGerundet.offenProv++;
    if (wirdGerundet(abgerechnet)) e.csvGerundet.abgerechnet++;
  }

  e.csvSummen.budgetChf = Math.round(e.csvSummen.budgetChf * 100) / 100;
  e.csvSummen.offenProv = Math.round(e.csvSummen.offenProv * 100) / 100;
  e.csvSummen.abgerechnet = Math.round(e.csvSummen.abgerechnet * 100) / 100;
  return e;
}

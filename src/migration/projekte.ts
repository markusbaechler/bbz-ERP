import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import type { MigrationProjektInput } from '../domain/types';
import { fmText, fmZahl, fmProjektNummer, istProjektNummer, fmBereich } from './normalize';
import { findKontoByNummer } from '../repos/kontoRepo';
import { upsertProjektAusMigration, type ProjektSchluessel } from '../repos/projektRepo';

export type ProjektImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; uebersprungen: number;
  csvSummen: { budgetChf: number; offenProv: number; abgerechnet: number };
  /** (stammnummer, jahr) genau der Projekte, die dieser Lauf geschrieben hat. */
  schluessel: ProjektSchluessel[];
  warnungen: string[];
};

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

// Einheitlicher Text, damit Dry-Run (gegen KONTENPLAN) und Apply (gegen die DB)
// dieselbe Warnung erzeugen.
export const kontoWarnung = (projektNr: string, feld: string, nummer: string): string =>
  `Projekt ${projektNr}: ${feld} "${nummer}" nicht im Kontenplan — Kontierung bleibt offen`;

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
  if (auftraggeberNr === null || !auftraggeberNummern.has(auftraggeberNr)) {
    return `Auftraggeber-Nr. "${auftraggeberNr}" nicht importiert — uebersprungen`;
  }
  return null;
}

export async function importProjekte(
  pool: pg.Pool,
  gruppen: ProjektGruppe[],
  idNachNummer: Map<string, string>,
): Promise<ProjektImportErgebnis> {
  const e: ProjektImportErgebnis = {
    gelesen: gruppen.length, neu: 0, aktualisiert: 0, uebersprungen: 0,
    csvSummen: { budgetChf: 0, offenProv: 0, abgerechnet: 0 }, schluessel: [], warnungen: [],
  };
  const auftraggeberNummern = new Set(idNachNummer.keys());
  // Kontonummer -> id (oder null fuer "nicht im Kontenplan"), einmal je Lauf aufgeloest
  const kontoCache = new Map<string, string | null>();
  const kontoId = async (nummer: string | null, projektNr: string, feld: string): Promise<string | null> => {
    if (nummer === null) return null;
    if (!kontoCache.has(nummer)) {
      const k = await findKontoByNummer(pool, nummer);
      kontoCache.set(nummer, k?.id ?? null);
    }
    const id = kontoCache.get(nummer)!;
    if (id === null) e.warnungen.push(kontoWarnung(projektNr, feld, nummer));
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
      ertragskontoId: await kontoId(fmText(p['Konto']), projektNr, 'Konto'),
      aufwandKontoId: await kontoId(fmText(p['Aufw. Konto']), projektNr, 'Aufw. Konto'),
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
  }

  e.csvSummen.budgetChf = Math.round(e.csvSummen.budgetChf * 100) / 100;
  e.csvSummen.offenProv = Math.round(e.csvSummen.offenProv * 100) / 100;
  e.csvSummen.abgerechnet = Math.round(e.csvSummen.abgerechnet * 100) / 100;
  return e;
}

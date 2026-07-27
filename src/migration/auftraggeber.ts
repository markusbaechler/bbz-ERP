import type pg from 'pg';
import type { ProjektGruppe } from './gruppen';
import { fmText, fmName } from './normalize';
import { upsertAuftraggeberAusMigration } from '../repos/auftraggeberRepo';

export type AuftraggeberImportErgebnis = {
  gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number;
  idNachNummer: Map<string, string>;
  warnungen: string[];
};

export type AuftraggeberEintrag = { name: string; zusatz: string | null; ansprechperson: string | null };

// Reine CSV-Auswertung, ohne DB-Zugriff: welche Auftraggeber-Nummern haben ueberhaupt
// einen Namen und sind damit importierbar? Wird sowohl vom Apply-Import (unten) als auch
// von der Dry-Run-Vorschau (run.ts) verwendet, damit beide Modi dieselbe Definition von
// "importierbarer Auftraggeber" haben und nicht auseinanderlaufen koennen.
export function sammleAuftraggeber(gruppen: ProjektGruppe[]): { gesehen: Map<string, AuftraggeberEintrag>; warnungen: string[] } {
  const warnungen: string[] = [];
  const gesehen = new Map<string, AuftraggeberEintrag>();
  // Ansprechperson ist im Export eine Projekt-, keine Auftraggeber-Eigenschaft.
  // Wir sammeln alle Auspraegungen je Nummer, um die Uebernahme der ersten als
  // Stammdatum unten offenzulegen statt sie stillschweigend zu behaupten.
  const ansprechpersonen = new Map<string, Set<string>>();

  for (const g of gruppen) {
    const projektNr = fmText(g.projekt['Projekt_Nr.']) ?? '(ohne Nr.)';
    const nummer = fmText(g.projekt['Auftraggeber_Nr.']);
    const roh = fmText(g.projekt['Auftraggeber']);
    if (nummer === null) {
      warnungen.push(`Projekt ${projektNr}: ohne Auftraggeber-Nr. — kein Auftraggeber uebernommen`);
      continue;
    }
    if (roh === null) {
      warnungen.push(`Projekt ${projektNr}: Auftraggeber-Nr. ${nummer} ohne Namen — kein Auftraggeber uebernommen`);
      continue;
    }
    const { name, zusatz } = fmName(roh);
    const ansprechperson = fmText(g.projekt['Ansprechperson']);
    if (ansprechperson !== null) {
      if (!ansprechpersonen.has(nummer)) ansprechpersonen.set(nummer, new Set());
      ansprechpersonen.get(nummer)!.add(ansprechperson);
    }
    const vorhanden = gesehen.get(nummer);
    if (!vorhanden) {
      gesehen.set(nummer, { name, zusatz, ansprechperson });
    } else if (vorhanden.name !== name) {
      warnungen.push(`Auftraggeber-Nr. ${nummer}: abweichende Namen "${vorhanden.name}" / "${name}" — erster gewinnt`);
    }
  }

  for (const [nummer, menge] of ansprechpersonen) {
    if (menge.size <= 1) continue;
    const uebernommen = gesehen.get(nummer)?.ansprechperson ?? null;
    warnungen.push(
      `Auftraggeber-Nr. ${nummer}: ${menge.size} verschiedene Ansprechpersonen im Export ` +
      `(${[...menge].map((a) => `"${a}"`).join(', ')}) — als Stammdatum uebernommen: ` +
      `${uebernommen === null ? 'keine' : `"${uebernommen}"`}; die projektbezogene Ansprechperson bleibt am Projekt erhalten`);
  }

  return { gesehen, warnungen };
}

// Der Projekt-Export nennt Auftraggeber nur mit Nummer und Namen — keine Adresse (Befund B3).
// Deshalb wird hier bewusst ohne Adresse importiert und der Datensatz markiert.
export async function importAuftraggeber(pool: pg.Pool, gruppen: ProjektGruppe[]): Promise<AuftraggeberImportErgebnis> {
  const { gesehen, warnungen } = sammleAuftraggeber(gruppen);

  const ergebnis: AuftraggeberImportErgebnis = {
    gelesen: gesehen.size, neu: 0, aktualisiert: 0, ohneAdresse: 0,
    idNachNummer: new Map(), warnungen,
  };

  for (const [nummer, daten] of gesehen) {
    const r = await upsertAuftraggeberAusMigration(pool, { nummer, ...daten });
    r.neu ? ergebnis.neu++ : ergebnis.aktualisiert++;
    if (r.auftraggeber.adresseUnvollstaendig) ergebnis.ohneAdresse++;
    ergebnis.idNachNummer.set(nummer, r.auftraggeber.id);
  }
  return ergebnis;
}

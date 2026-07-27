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

  for (const g of gruppen) {
    const projektNr = fmText(g.projekt['Projekt_Nr.']) ?? '(ohne Nr.)';
    const nummer = fmText(g.projekt['Auftraggeber_Nr.']);
    const roh = fmText(g.projekt['Auftraggeber']);
    if (nummer === null || roh === null) {
      warnungen.push(`Projekt ${projektNr}: ohne Auftraggeber-Nummer oder -Name uebersprungen`);
      continue;
    }
    const { name, zusatz } = fmName(roh);
    const vorhanden = gesehen.get(nummer);
    if (!vorhanden) {
      gesehen.set(nummer, { name, zusatz, ansprechperson: fmText(g.projekt['Ansprechperson']) });
    } else if (vorhanden.name !== name) {
      warnungen.push(`Auftraggeber-Nr. ${nummer}: abweichende Namen "${vorhanden.name}" / "${name}" — erster gewinnt`);
    }
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

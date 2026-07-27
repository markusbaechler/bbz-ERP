import { ValidationError } from '../domain/errors';

export type ProjektGruppe = {
  projekt: Record<string, string>;
  kinder: Array<Record<string, string>>;
};

// Der FileMaker-Export wiederholt die Projektfelder nicht: eine Zeile mit gefuellter
// Projekt_Nr. eroeffnet ein Projekt, alle folgenden Zeilen ohne gehoeren als
// Kindzeilen (Faktura/Schritte/Seminare) dazu.
export function gruppiereProjekte(
  records: Array<Record<string, string>>,
  schluessel = 'Projekt_Nr.',
): ProjektGruppe[] {
  const gruppen: ProjektGruppe[] = [];
  for (const rec of records) {
    const key = (rec[schluessel] ?? '').trim();
    if (key !== '') {
      gruppen.push({ projekt: rec, kinder: [] });
    } else {
      const aktuell = gruppen[gruppen.length - 1];
      if (!aktuell) throw new ValidationError(`Kindzeile ohne vorangehende Zeile mit ${schluessel}`);
      aktuell.kinder.push(rec);
    }
  }
  return gruppen;
}

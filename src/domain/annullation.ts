import { ANNULLATION, type AnnullationsStufe } from '../config/bildung';
import { rappenRunden } from './mwst';
import { tageZwischen } from './kursplanung';

export type Annullationsgebuehr = { tageVorBeginn: number; prozent: number; gebuehrChf: number };

/**
 * Annullationskosten nach Tagen vor Kursbeginn (Staffel aus der Konfiguration).
 * Massgebend ist die erste Stufe (absteigend nach Tagen), deren Schwelle erreicht ist; nach Kursbeginn gilt
 * die strengste Stufe. Betrag auf 5 Rappen gerundet; fehlender Preis = 0.
 */
export function annullationsgebuehr(
  preisChf: number | null, kursbeginn: string, stornoDatum: string, staffel: readonly AnnullationsStufe[] = ANNULLATION,
): Annullationsgebuehr {
  const tageVorBeginn = tageZwischen(stornoDatum, kursbeginn);
  const absteigend = [...staffel].sort((a, b) => b.abTagenVorBeginn - a.abTagenVorBeginn);
  const stufe = absteigend.find((s) => tageVorBeginn >= s.abTagenVorBeginn)
    ?? absteigend.reduce((a, b) => (b.prozent > a.prozent ? b : a));
  return { tageVorBeginn, prozent: stufe.prozent, gebuehrChf: rappenRunden(((preisChf ?? 0) * stufe.prozent) / 100) };
}

import { ANNULLATION_OEFFENTLICH, type AnnullationsStufe } from '../config/bildung';
import { rappenRunden } from './mwst';
import { tageZwischen } from './kursplanung';

export type Annullationsgebuehr = { tageVorBeginn: number; prozent: number; gebuehrChf: number };

/**
 * Annullationskosten nach Tagen vor Kursbeginn. Die Staffel ist ein Parameter (Default: AGB oeffentliche Kurse),
 * damit spaeter je Kursangebot eine eigene Staffel gelten kann. Massgebend ist die erste Stufe (absteigend nach
 * Schwelle), deren Schwelle ueberschritten ist; greift keine, gilt die strengste. Betrag auf 5 Rappen gerundet;
 * fehlender Preis = 0.
 */
export function annullationsgebuehr(
  preisChf: number | null, kursbeginn: string, stornoDatum: string,
  staffel: readonly AnnullationsStufe[] = ANNULLATION_OEFFENTLICH,
): Annullationsgebuehr {
  const tageVorBeginn = tageZwischen(stornoDatum, kursbeginn);
  const absteigend = [...staffel].sort((a, b) => b.mehrAlsTageVorBeginn - a.mehrAlsTageVorBeginn);
  const stufe = absteigend.find((s) => tageVorBeginn > s.mehrAlsTageVorBeginn)
    ?? absteigend.reduce((a, b) => (b.prozent > a.prozent ? b : a));
  return { tageVorBeginn, prozent: stufe.prozent, gebuehrChf: rappenRunden(((preisChf ?? 0) * stufe.prozent) / 100) };
}

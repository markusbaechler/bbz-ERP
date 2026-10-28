/**
 * Konfiguration Seminarbetrieb (Spec v2 §5.4). Als Daten gehalten, damit AGB-Aenderungen keinen Code-Umbau brauchen.
 */

export type AnnullationsStufe = {
  /** Stufe gilt, wenn die Annullation mindestens so viele Tage vor Kursbeginn eingeht. */
  abTagenVorBeginn: number;
  /** Anteil des Kurspreises in Prozent. */
  prozent: number;
};

/**
 * Annullationsstaffel [Hypothese, gegen AGB zu verifizieren]:
 * >= 30 Tage vor Beginn 0 %, 29-14 Tage 50 %, < 14 Tage (und nach Beginn) 100 %.
 * Ersatzteilnehmer:in ist kostenlos (wird als Umbuchung erfasst, nicht als Storno).
 */
export const ANNULLATION: readonly AnnullationsStufe[] = [
  { abTagenVorBeginn: 30, prozent: 0 },
  { abTagenVorBeginn: 14, prozent: 50 },
  { abTagenVorBeginn: 0, prozent: 100 },
];

/** SAQ-Rezertifizierung: 24 Lernstunden innerhalb der 36-monatigen Gueltigkeit [belegt: Positionspapier Juni 2026]. */
export const REZERTIFIZIERUNG = { lernstundenSoll: 24, gueltigkeitMonate: 36 } as const;

/** Moodle-Lernreise: Zugang ab 14 Tagen vor Kursbeginn [Hypothese] bis 60 Tage nach Kursende. */
export const MOODLE = { einschreibenTageVorBeginn: 14, zugangTageNachEnde: 60 } as const;

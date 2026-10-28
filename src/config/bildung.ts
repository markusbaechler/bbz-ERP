/**
 * Konfiguration Seminarbetrieb (Spec v2 §5.4). Als Daten gehalten, damit AGB-Aenderungen keinen Code-Umbau brauchen.
 */

export type AnnullationsStufe = {
  /** Stufe gilt, wenn die Annullation MEHR als so viele Tage vor Kursbeginn eingeht (-Infinity = immer). */
  mehrAlsTageVorBeginn: number;
  /** Anteil des Kurspreises in Prozent. */
  prozent: number;
};

/**
 * Annullation oeffentliche Kurse [belegt: AGB bbz, Oktober 2026]:
 * schriftliche Abmeldung mehr als 30 Tage vor Kursbeginn kostenlos; 30 Tage oder weniger (inkl. Nichterscheinen
 * oder Abbruch) 100 % des Kurspreises. Eine Ersatzperson ist kostenlos (Storno mit `ersatzKontakt`).
 * Bezogene Lehrmittel werden immer verrechnet (noch nicht modelliert).
 * Weitere Staffeln (SAQ-Pruefungen: fixe CHF-Betraege/Arbeitstage; Kundenprojekte: 90/60/30 Tage) koennen spaeter
 * je Kursangebot als eigene Staffel hinterlegt werden; die Domaenenfunktion nimmt die Staffel als Parameter.
 */
export const ANNULLATION_OEFFENTLICH: readonly AnnullationsStufe[] = [
  { mehrAlsTageVorBeginn: 30, prozent: 0 },
  { mehrAlsTageVorBeginn: Number.NEGATIVE_INFINITY, prozent: 100 },
];

/** SAQ-Rezertifizierung: 24 Lernstunden innerhalb der 36-monatigen Gueltigkeit [belegt: /rezertifizierung/]. */
export const REZERTIFIZIERUNG = { lernstundenSoll: 24, gueltigkeitMonate: 36 } as const;

/** Moodle-Lernreise: Zugang ab 14 Tagen vor Kursbeginn [Hypothese] bis 60 Tage nach Kursende. */
export const MOODLE = { einschreibenTageVorBeginn: 14, zugangTageNachEnde: 60 } as const;

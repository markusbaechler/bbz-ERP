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

/**
 * Kundenspezifische Projekte / Firmenkurse [belegt: AGB bbz, Oktober 2026]: bis 90 Tage vorher kostenlos;
 * 89-60 Tage 30 %, 59-30 Tage 50 %, ab 29 Tagen 100 % (Annullation; Verschiebung jeweils 10 %, hier nicht modelliert).
 */
export const ANNULLATION_PROJEKT: readonly AnnullationsStufe[] = [
  { mehrAlsTageVorBeginn: 89, prozent: 0 },
  { mehrAlsTageVorBeginn: 59, prozent: 30 },
  { mehrAlsTageVorBeginn: 29, prozent: 50 },
  { mehrAlsTageVorBeginn: Number.NEGATIVE_INFINITY, prozent: 100 },
];

/** Ohne Annullationskosten (z. B. interne Anlaesse, kostenlose Foren). */
export const ANNULLATION_KEINE: readonly AnnullationsStufe[] = [{ mehrAlsTageVorBeginn: Number.NEGATIVE_INFINITY, prozent: 0 }];

/** Staffel je Kursangebot (`kursangebot.annullationsregel`). SAQ-Pruefungen rechnen im SAQ-Modul (fixe Betraege). */
export function staffelFuer(regel: string | null | undefined): readonly AnnullationsStufe[] {
  if (regel === 'projekt') return ANNULLATION_PROJEKT;
  if (regel === 'keine') return ANNULLATION_KEINE;
  return ANNULLATION_OEFFENTLICH;
}

/** SAQ-Rezertifizierung: 24 Lernstunden innerhalb der 36-monatigen Gueltigkeit [belegt: /rezertifizierung/]. */
export const REZERTIFIZIERUNG = { lernstundenSoll: 24, gueltigkeitMonate: 36 } as const;

/** Moodle-Lernreise: Zugang ab 14 Tagen vor Kursbeginn [Hypothese] bis 60 Tage nach Kursende. */
export const MOODLE = { einschreibenTageVorBeginn: 14, zugangTageNachEnde: 60 } as const;

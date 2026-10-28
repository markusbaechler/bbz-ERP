import type { SaqProfil, SaqSprache, SaqUmfang, SaqVariante } from '../domain/saqTypes';

/**
 * SAQ-Personenzertifizierung "Kundenberater Bank" (Spec v2 §5.4b).
 * Codes, Teilpruefungen und Passerelle wie im Cockpit bbz-saq (config.js, Reporting KUBA), bestaetigt durch den
 * Auftraggeber 05./10.09.2026. Listenpreise exkl. MWST [belegt: Website /zertifizierung/, Preise je Institut variabel].
 */
export const SAQ_PROFILE: SaqProfil[] = ['PK', 'IK', 'AFFL', 'CWMA', 'KMU', 'CCoB'];

/** Bezeichnung: "Privatkunden" [belegt: Moodle-Profilfeld], "Affluent" [belegt: Website]; IK [Hypothese]; Rest = Code. */
export const SAQ_PROFIL_INFO: Record<SaqProfil, { bezeichnung: string; listenpreisChf: number }> = {
  PK: { bezeichnung: 'Privatkunden', listenpreisChf: 2025 },
  IK: { bezeichnung: 'Individualkunden', listenpreisChf: 2250 },
  AFFL: { bezeichnung: 'Affluent', listenpreisChf: 3025 },
  CWMA: { bezeichnung: 'CWMA', listenpreisChf: 3225 },
  KMU: { bezeichnung: 'KMU', listenpreisChf: 3375 },
  CCoB: { bezeichnung: 'CCoB', listenpreisChf: 3625 },
};

/** Rohwert (Formular, KUBA) -> Profil; Vergleich ohne Gross-/Kleinschreibung (bbz-saq PROFILE_ALIASES). */
export const SAQ_PROFIL_ALIASE: Record<string, SaqProfil> = {
  CCOB: 'CCoB', AFFLUENT: 'AFFL', AFFL: 'AFFL', AFF: 'AFFL', AF: 'AFFL', 'PK FRZ': 'PK',
};

/**
 * Pflicht-Teilpruefungen je Profil (bbz-saq PROFILE_PARTS, Auftraggeber 05.09.2026): schriftlich WE1..WEn,
 * muendlich immer OE1. Annahme [Hypothese wie bbz-saq]: die Teile belegen WE1..WEn von links.
 */
export const SAQ_TEILE: Record<SaqProfil, { schriftlich: number[]; muendlich: number[] }> = {
  PK: { schriftlich: [1], muendlich: [1] },
  IK: { schriftlich: [1], muendlich: [1] },
  AFFL: { schriftlich: [1, 2], muendlich: [1] },
  CWMA: { schriftlich: [1, 2, 3], muendlich: [1] },
  KMU: { schriftlich: [1, 2, 3], muendlich: [1] },
  CCoB: { schriftlich: [1, 2, 3], muendlich: [1] },
};

/**
 * Passerelle (bbz-saq PASSERELLE): Nachfolgeprofil -> Vorgaengerprofil. Mit bestandenem Vorgaengerprofil genuegt
 * ein schriftlicher Teil. Welcher Teil das ist, ist in KUBA [unklar]; das ERP fuehrt ihn als WE1 [Hypothese].
 */
export const SAQ_PASSERELLE: Partial<Record<SaqProfil, SaqProfil>> = { IK: 'PK', CWMA: 'AFFL', CCoB: 'KMU' };

export const SAQ = {
  /** Zertifikatstyp in `zertifizierung.typ` (Profil und Sprache in eigenen Spalten). */
  zertifikatTyp: 'SAQ Kundenberater Bank',
  /**
   * Bestehensgrenze: ein Run gilt AB 70 % als bestanden (>= 70), bestaetigt durch den Auftraggeber 10.09.2026
   * (bbz-saq PASS_THRESHOLD 0.70). Achtung: die Website schreibt "bestanden ab > 70 %" - Widerspruch, massgebend
   * ist die Auskunft des Auftraggebers. `bestanden` bleibt das massgebende Feld; die Grenze dient nur der Ableitung
   * bei fehlendem Wert und dem Data-Quality-Hinweis bei Widerspruch.
   */
  bestehensgrenzeProzent: 70,
  /** Zertifikat gueltig 3 Jahre, danach Rezertifizierung (24 LS / 36 Monate) [belegt: Website /rezertifizierung/]. */
  gueltigkeitJahre: 3,
  /** Hoechstens 3 Runs je Teilpruefung (KUBA RUN1-RUN3); ein nicht bestandener RUN3 ist endgueltig. */
  maxRuns: 3,
  /** "Passiver Vorgang": offen, letzte Pruefung > 365 Tage vor Stichtag, kein geplanter Termin (bbz-saq PASSIVE_DAYS). */
  passivTage: 365,
  umfaenge: ['selbststudium', 'schriftlich', 'muendlich', 'gesamtpaket'] as SaqUmfang[],
  varianten: ['erstzertifizierung', 'passerelle', 'teilpruefung', 'wiederholung'] as SaqVariante[],
  sprachen: ['DE', 'FR', 'IT', 'EN'] as SaqSprache[],
  /** Eindeutige Kuerzel -> Sprache (bbz-saq LANGUAGE_ALIASES). */
  spracheAliase: { D: 'DE', F: 'FR', I: 'IT', E: 'EN' } as Record<string, SaqSprache>,
  /** Spaltenraster der KUBA-Datei (bbz-saq CONFIG.we / CONFIG.oe) fuer den Export. */
  kuba: { we: { teile: 6, runs: 3 }, oe: { teile: 2, runs: 3 } },
};

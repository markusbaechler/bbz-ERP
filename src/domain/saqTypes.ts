// SAQ-Zertifizierung "Kundenberater Bank" (Spec v2 §5.4b). Begriffe wie Reporting KUBA / bbz-saq:
// Vorgang = saq_fall, Run = ein Versuch einer Teilpruefung (WE1-WE6 schriftlich, OE1-OE2 muendlich, RUN1-RUN3).

export type SaqProfil = 'PK' | 'IK' | 'AFFL' | 'CWMA' | 'KMU' | 'CCoB';
export type SaqUmfang = 'selbststudium' | 'schriftlich' | 'muendlich' | 'gesamtpaket';
export type SaqSprache = 'DE' | 'FR' | 'IT' | 'EN';
export type SaqVariante = 'erstzertifizierung' | 'passerelle' | 'teilpruefung' | 'wiederholung';
export type SaqStatus =
  | 'angemeldet' | 'in_pruefung' | 'schriftlich_bestanden' | 'bestanden' | 'zertifiziert' | 'nicht_bestanden' | 'abgebrochen';
export type SaqPruefungArt = 'schriftlich' | 'muendlich';

export type SaqFall = {
  id: string; kontaktId: string; organisationId: string | null; rechnungsempfaengerId: string | null;
  profil: SaqProfil; variante: SaqVariante; umfang: SaqUmfang; sprache: SaqSprache; rolle: string | null;
  kennzeichnung: string | null; status: SaqStatus; arbeitgeberbestaetigungAm: string | null;
  digitaleHilfsmittel: boolean; einwilligungRechnungBank: boolean; einwilligungWeitergabeGruppe: boolean;
  zertifizierungId: string | null; rechnungId: string | null; anfrageId: string | null; kubaHerkunft: string | null;
  bemerkung: string | null; erstelltAm: string; geaendertAm: string;
};

/** Minimale Run-Sicht fuer die reinen Regeln (SaqPruefung erfuellt sie). */
export type SaqRun = {
  art: SaqPruefungArt; teil: number; run: number; datum: string;
  bestanden: boolean | null; resultatProzent: number | null;
};

export type SaqPruefung = SaqRun & {
  id: string; fallId: string; durchfuehrungId: string | null; ort: string | null; remote: boolean;
  score: number | null; experte1Id: string | null; experte2Id: string | null;
};

export type SaqTeilStatus = 'offen' | 'bestanden' | 'endgueltig_nicht_bestanden';

export type SaqTeil = {
  art: SaqPruefungArt; teil: number; status: SaqTeilStatus;
  versuche: number;            // absolvierte Runs (mit Ergebnis)
  geplant: boolean;            // Run ohne Ergebnis vorhanden
};

export type SaqUebersicht = {
  pflichtteile: { schriftlich: number[]; muendlich: number[] };
  teile: SaqTeil[];
  schriftlichAlleBestanden: boolean;
  muendlichAlleBestanden: boolean;
  endgueltigNichtBestanden: boolean;
};

export type MuendlichZulassung = { zugelassen: boolean; gruende: string[] };

export type SaqKontaktKurz = { id: string; vorname: string | null; nachname: string; email: string | null };

export type SaqFallListeneintrag = SaqFall & {
  kontakt: SaqKontaktKurz;
  organisationName: string | null;
  letztePruefung: string | null;   // Datum des letzten absolvierten Runs
  passiv: boolean;                 // offen, letzte Pruefung > 365 Tage, kein geplanter Termin
};

export type SaqZertifikat = {
  id: string; kontaktId: string; typ: string; profil: SaqProfil | null; sprache: SaqSprache | null;
  zertifikatNr: string | null; ausgestelltAm: string; gueltigBis: string; status: 'aktiv' | 'abgelaufen' | 'entzogen';
};

export type SaqFallDetail = SaqFallListeneintrag & SaqUebersicht & {
  pruefungen: SaqPruefung[];
  muendlichZulassung: MuendlichZulassung;
  passerelleMoeglich: boolean;
  hinweise: string[];
  zertifizierung: SaqZertifikat | null;
};

/** Quote in Prozent (1 Nachkommastelle) mit Zaehler und Nenner n; quote = null bei n = 0. */
export type SaqQuote = { quote: number | null; zaehler: number; n: number };
/** Mittelwert in Prozent (1 Nachkommastelle) ueber n Vorgaenge mit Wert. */
export type SaqMittel = { mittel: number | null; n: number };

export type SaqKennzahlZeile = {
  vorgaenge: number;
  abgeschlossen: number;
  bestanden: number;
  quoteInsgesamt: SaqQuote;              // bestanden / abgeschlossene Vorgaenge
  erstversuchSchriftlich: SaqQuote;      // alle absolvierten WE RUN1 bestanden / Vorgaenge mit WE RUN1
  erstversuchMuendlich: SaqQuote;        // OE RUN1 bestanden / Vorgaenge mit OE RUN1
  resultatErstversuchSchriftlich: SaqMittel;
  resultatErstversuchMuendlich: SaqMittel;
};

export type SaqKennzahlen = {
  jahr: number;
  total: SaqKennzahlZeile;
  jeProfil: (SaqKennzahlZeile & { profil: SaqProfil })[];
};

/** Eine Zeile im Format der bbz-saq-Feldschluessel (config.js HEADER_FIELDS). */
export type KubaZeile = Record<string, string | number>;

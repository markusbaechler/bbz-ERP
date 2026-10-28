/** Typen des CRM-Moduls (Spec v2 §5.2). JSON in camelCase, Datum 'YYYY-MM-DD', Zeitpunkte ISO-8601. */

export type OrganisationKategorie = 'kunde' | 'interessent' | 'partner' | 'lieferant' | 'uebrige';
export type Klassifizierung = 'A' | 'B' | 'C' | 'akquisition';

export type Organisation = {
  id: string; name: string; kategorie: OrganisationKategorie; klassifizierung: Klassifizierung | null; vip: boolean;
  branche: string | null; strasse: string | null; plz: string | null; ort: string | null; land: string;
  telefon: string | null; email: string | null; website: string | null; betreuerId: string | null;
  bemerkung: string | null; archiviert: boolean;
};

export type OrganisationListeEintrag = Organisation & { kontakteAnzahl: number; letzteAktivitaet: string | null };

export type AktivitaetTyp = 'telefon' | 'meeting' | 'email' | 'besuch' | 'event' | 'notiz' | 'offerte' | 'brief';

export type Aktivitaet = {
  id: string; typ: AktivitaetTyp; datum: string; betreff: string; notizen: string | null;
  kontaktId: string | null; organisationId: string | null; projektId: string | null;
  verkaufschanceId: string | null; mitarbeitendeId: string | null;
};

export type Phase = 'lead' | 'qualifiziert' | 'offeriert' | 'verhandlung' | 'gewonnen' | 'verloren';

export type Verkaufschance = {
  id: string; titel: string; organisationId: string; kontaktId: string | null; bereich: string | null;
  phase: Phase; wertChf: number | null; wahrscheinlichkeit: number | null; erwarteterAbschluss: string | null;
  verantwortlichId: string | null; quelle: string | null; verlustgrund: string | null;
  projektId: string | null; abgeschlossenAm: string | null;
};

export type AnfrageQuelle = 'homepage' | 'email' | 'telefon' | 'event' | 'import';
export type AnfrageTyp = 'kontakt' | 'offerte' | 'tailormade' | 'newsletter' | 'rueckruf';
export type AnfrageStatus = 'neu' | 'in_bearbeitung' | 'uebernommen' | 'verworfen';

export type Anfrage = {
  id: string; quelle: AnfrageQuelle; typ: AnfrageTyp; status: AnfrageStatus;
  anrede: string | null; vorname: string | null; nachname: string | null; email: string | null; telefon: string | null;
  organisationName: string | null; funktion: string | null; interesse: string | null; nachricht: string | null;
  newsletter: boolean; einwilligung: boolean; payload: Record<string, unknown>;
  kontaktId: string | null; verkaufschanceId: string | null; bearbeitetDurchId: string | null;
  eingegangenAm: string; erledigtAm: string | null;
};

/** Aufgabe aus Sicht CRM (Wiedervorlage oder Aufgabe in der 360°-Sicht). Tabelle `aufgabe` gehoert dem PM-Modul. */
export type CrmAufgabe = {
  id: string; titel: string; status: string; prioritaet: string; faelligAm: string | null; zustaendigId: string | null;
  projektId: string | null; kontaktId: string | null; organisationId: string | null; verkaufschanceId: string | null;
  kontaktName: string | null; organisationName: string | null; verkaufschanceTitel: string | null;
};

export type PipelineSumme = { anzahl: number; summeChf: number; gewichtetChf: number };

export type Pipeline = {
  phasen: (PipelineSumme & { phase: Phase })[];
  offen: PipelineSumme;
  forecast: (PipelineSumme & { monat: string })[];
  ohneTermin: PipelineSumme;
};

export type PflegeabdeckungZeile = {
  klassifizierung: Klassifizierung | 'ohne'; organisationen: number; gepflegt: number; abdeckungProzent: number | null;
};

export type Wiedervorlagen<T> = { ueberfaellig: T[]; dieseWoche: T[]; spaeter: T[]; ohneTermin: T[] };

export type NewsletterEmpfaenger = {
  email: string; anrede: string | null; vorname: string | null; nachname: string; organisation: string | null;
};

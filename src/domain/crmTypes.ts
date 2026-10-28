/** Typen des CRM-Moduls (Spec v2 §5.2). JSON in camelCase, Datum 'YYYY-MM-DD', Zeitpunkte ISO-8601. */
import type { Kontakt, Auftraggeber } from './types';

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

/* ---------- 360°-Sichten und Dashboard ---------- */

export type ProjektKurz = {
  id: string; nummer: string; name: string; jahr: number; status: string; bereich: string | null; auftraggeberId: string;
};

export type Organisation360 = Organisation & {
  kontakte: Kontakt[];
  /** Letzte 20 Aktivitaeten (direkt oder an Kontakten der Organisation). */
  aktivitaeten: Aktivitaet[];
  offeneAufgaben: CrmAufgabe[];
  verkaufschancen: Verkaufschance[];
  projekte: ProjektKurz[];
  auftraggeber: Auftraggeber | null;
  /** Festgeschriebene Rechnungen (abgerechnet/bezahlt), Summe netto je Rechnungsjahr, neuestes zuerst. */
  umsatzProJahr: { jahr: number; nettoChf: number }[];
};

export type AnmeldungKurz = {
  id: string; durchfuehrungId: string; durchfuehrungCode: string | null; titel: string; startDatum: string; endDatum: string;
  status: string; preisChf: number | null; angemeldetAm: string;
};
export type LernnachweisKurz = {
  id: string; anmeldungId: string | null; datum: string; titel: string; lernstunden: number; kategorie: string; quelle: string;
};
export type ZertifizierungKurz = {
  id: string; typ: string; zertifikatNr: string | null; ausgestelltAm: string; gueltigBis: string; status: string;
};

export type Kontakt360 = Kontakt & {
  organisation: Organisation | null;
  aktivitaeten: Aktivitaet[];
  aufgaben: CrmAufgabe[];
  verkaufschancen: Verkaufschance[];
  anmeldungen: AnmeldungKurz[];
  lernnachweise: LernnachweisKurz[];
  zertifizierungen: ZertifizierungKurz[];
  /** SAQ-Zertifizierungsvorgaenge (Profil, Status) – Kundenberatung sieht laufende Zertifizierungen */
  saqVorgaenge: { id: string; profil: string; variante: string; status: string; erstelltAm: string }[];
};

export type CrmDashboard = {
  stichtag: string;
  neueAnfragen: { anzahl: number; neueste: Anfrage[] };
  wiedervorlagen: { ueberfaellig: number; dieseWoche: number; spaeter: number; ohneTermin: number };
  /** Offene Pipeline (gewichtet). */
  pipeline: PipelineSumme;
  aktivitaeten30Tage: { anzahl: number; jeTyp: Partial<Record<AktivitaetTyp, number>> };
  pflegeabdeckung: PflegeabdeckungZeile[];
};

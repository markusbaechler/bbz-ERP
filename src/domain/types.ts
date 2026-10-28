export type Konto = { id: string; nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand'; aktiv: boolean };

export type MwstSatz = { id: string; satz: number; bezeichnung: string; gueltigAb: string; gueltigBis: string | null };

export type Auftraggeber = {
  id: string; nummer: string | null; name: string;
  strasse: string; plz: string; ort: string; land: string;
  ansprechperson: string | null; email: string | null; telefon: string | null; aktiv: boolean;
};

export type Projekt = {
  id: string; nummer: string; stammnummer: number; jahr: number;
  kuerzel: string | null; name: string; bereich: string | null;
  auftraggeberId: string; ertragskontoId: string | null;
  budgetChf: number | null; budgetTage: number | null; mwstModus: 'exkl' | 'inkl';
  fortsetzungVonId: string | null;
  // PM-Erweiterung (Migration 009, Spec v2 §5.3)
  status: 'akquise' | 'offeriert' | 'laufend' | 'abgeschlossen' | 'abgesagt' | 'archiviert';
  projektleitungId: string | null; ansprechpersonKontaktId: string | null;
  startDatum: string | null; endDatum: string | null; beschrieb: string | null;
  budgetStunden: number | null; aufwandBudgetChf: number | null; aufwandkontoId: string | null;
};

export type RechnungStatus = 'offen_prov' | 'def_vereinbart' | 'abgerechnet' | 'bezahlt' | 'storniert';

export type Rechnungsposition = {
  id: string; rechnungId: string; position: number; beschreibung: string;
  menge: number; einheit: string; einzelpreis: number; mwstSatz: number;
  kontoId: string | null; betragNetto: number;
};

export type Rechnung = {
  id: string; projektId: string; auftraggeberId: string; datum: string;
  betreff: string | null; mwstModus: 'exkl' | 'inkl'; waehrung: string;
  lfdNr: number | null; nummer: string | null; status: RechnungStatus;
  totalNetto: number; totalMwst: number; totalBrutto: number;
};

export type Zahlungseingang = {
  id: string; rechnungId: string; datum: string; betrag: number;
  bemerkung: string | null; erfasstDurch: string | null;
};

export type OffenerPosten = {
  rechnungId: string; nummer: string | null; auftraggeberId: string; datum: string;
  totalBrutto: number; bezahlt: number; offen: number;
};

export type Rolle = 'admin' | 'standard';

export type Mitarbeitende = {
  id: string; kuerzel: string; vorname: string | null; nachname: string; email: string | null;
  rolle: Rolle; entraOid: string | null; stundensatzIntern: number | null; stundensatzVerrechnung: number | null;
  aktiv: boolean;
};

export type Referent = {
  id: string; typ: 'intern' | 'extern'; mitarbeitendeId: string | null; kontaktId: string | null;
  anzeigename: string; fachgebiete: string[]; tagessatzChf: number | null; halbtagessatzChf: number | null;
  aktiv: boolean; bemerkung: string | null;
};

export type Interesse = 'nachwuchs' | 'tailormade' | 'weiterbildung' | 'zertifizierung' | 'beratung';

export type Kontakt = {
  id: string; organisationId: string | null; anrede: 'Frau' | 'Herr' | 'Divers' | null; titel: string | null;
  vorname: string | null; nachname: string; funktion: string | null; abteilung: string | null;
  email: string | null; email2: string | null; telefon: string | null; mobile: string | null;
  sprache: string; geburtsdatum: string | null; rolle: string | null; zielgruppe: string | null;
  betreuerId: string | null; interessen: Interesse[]; prioritaet: 'hoch' | 'mittel' | 'tief' | null;
  newsletter: boolean; einwilligungAm: string | null; einwilligungQuelle: string | null;
  moodleUserId: number | null; bemerkung: string | null; archiviert: boolean;
};

export type EinsatzStatus = 'angefragt' | 'bestaetigt' | 'abgesagt' | 'durchgefuehrt';

export type Einsatz = {
  id: string; referentId: string; projektId: string; kurstagId: string | null; datum: string;
  dauerTage: number; rolle: string; honorarChf: number | null; status: EinsatzStatus; bemerkung: string | null;
};

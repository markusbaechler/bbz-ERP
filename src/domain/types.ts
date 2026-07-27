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

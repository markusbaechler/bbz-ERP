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

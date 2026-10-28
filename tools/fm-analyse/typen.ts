/** Inventar einer FileMaker-Loesung, gewonnen aus dem Datenbank-Designreport (DDR) oder "Kopie als XML speichern". */
export type FmFeld = {
  id: string; name: string; typ: string; art: 'Normal' | 'Calculated' | 'Summary' | string;
  formel: string | null; autoEingabe: string[]; validierung: string[]; global: boolean; wiederholungen: number;
  kommentar: string | null;
};

export type FmTabelle = { id: string; name: string; datensaetze: number | null; felder: FmFeld[] };
export type FmTabellenvorkommen = { name: string; basisTabelle: string; datei: string | null };
export type FmBeziehung = {
  links: string; rechts: string; bedingungen: { links: string; rechts: string; typ: string }[];
  kaskadeErstellenRechts: boolean; kaskadeLoeschenRechts: boolean;
};
export type FmLayout = { id: string; name: string; tabelle: string | null; ordner: string[]; felder: string[]; scripts: string[] };
export type FmSchritt = { id: number | null; name: string; aktiv: boolean; details: string };
export type FmScript = { id: string; name: string; ordner: string[]; imMenue: boolean; schritte: FmSchritt[] };
export type FmWerteliste = { name: string; quelle: string; werte: string[]; feld: string | null };
export type FmEigeneFunktion = { name: string; parameter: string[]; formel: string };
export type FmKonto = { name: string; berechtigung: string; aktiv: boolean; typ: string };
export type FmDateiReferenz = { name: string; pfad: string };

export type FmDatei = {
  name: string;
  tabellen: FmTabelle[];
  tabellenvorkommen: FmTabellenvorkommen[];
  beziehungen: FmBeziehung[];
  layouts: FmLayout[];
  scripts: FmScript[];
  wertelisten: FmWerteliste[];
  eigeneFunktionen: FmEigeneFunktion[];
  konten: FmKonto[];
  berechtigungssaetze: string[];
  erweiterteBerechtigungen: string[];
  dateiReferenzen: FmDateiReferenz[];
};

export type FmInventar = {
  format: 'DDR' | 'SaveAsXML';
  version: string | null;
  dateien: FmDatei[];
};

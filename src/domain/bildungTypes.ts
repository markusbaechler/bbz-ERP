import { ValidationError, ConflictError } from './errors';
import type { Einsatz } from './types';

export type KursFormat = 'praesenz' | 'blended' | 'online' | 'e_learning';
export const KURS_FORMATE: KursFormat[] = ['praesenz', 'blended', 'online', 'e_learning'];

export type Kursangebot = {
  id: string; code: string; titel: string; untertitel: string | null; bereich: string; format: KursFormat;
  beschreibung: string | null; lernziele: string | null; zielgruppe: string | null; voraussetzungen: string | null;
  dauerTage: number | null; lernstunden: number | null; preisChf: number | null; mwstSatz: number;
  ertragskontoId: string | null; saqAnerkannt: boolean; moodleVorlageKursId: number | null;
  oeffentlich: boolean; slug: string | null; aktiv: boolean;
  /** v2 (Website/AGB): Homepage-Verknuepfung, Rezertifizierung, Nebenkosten, Annullationsregel */
  homepagePostId: number | null; rezertProfile: string[]; rezertKomponenten: ('fachwissen' | 'verhalten')[];
  nebenkostenProTagChf: number | null; nebenkostenMwstSatz: number; annullationsregel: 'oeffentlich' | 'saq' | 'projekt' | 'keine';
};

export type DurchfuehrungStatus = 'geplant' | 'ausgeschrieben' | 'bestaetigt' | 'durchgefuehrt' | 'abgesagt';

export type Belegung = { kapazitaet: number; aktiv: number; warteliste: number; frei: number };

export type Durchfuehrung = {
  id: string; kursangebotId: string; kursangebotCode: string; kursangebotTitel: string; projektId: string | null;
  code: string | null; titel: string | null; startDatum: string; endDatum: string; ort: string | null;
  kapazitaet: number; minTeilnehmende: number; anmeldeschluss: string | null; preisChf: number | null;
  status: DurchfuehrungStatus; oeffentlich: boolean; auftraggeberId: string | null; moodleKursId: number | null; moodleSessionId: number | null;
  leitungId: string | null;
  /** Seminarnummer des Moodle-Face-to-Face-Termins (Schluessel fuer den Moodle-Bericht und die FileMaker-"Seminar Nr.") */
  seminarnummer: string | null;
};

export type Kurstag = {
  id: string; durchfuehrungId: string; datum: string; von: string | null; bis: string | null;
  ort: string | null; thema: string | null;
};

export type DurchfuehrungDetail = Durchfuehrung & { kurstage: Kurstag[]; einsaetze: Einsatz[]; belegung: Belegung };

export type AnmeldeStatus =
  | 'angemeldet' | 'bestaetigt' | 'warteliste' | 'storniert' | 'teilgenommen' | 'abgeschlossen' | 'nicht_bestanden';
export type AnmeldeQuelle = 'manuell' | 'homepage' | 'import' | 'moodle';
export type MoodleStatus = 'nicht_relevant' | 'ausstehend' | 'eingeschrieben' | 'fehler' | 'ausgeschrieben';

export type Anmeldung = {
  id: string; durchfuehrungId: string; kontaktId: string; rechnungsempfaengerId: string | null; status: AnmeldeStatus;
  quelle: AnmeldeQuelle; angemeldetAm: string; bestaetigtAm: string | null; storniertAm: string | null;
  stornogrund: string | null; preisChf: number | null; stornogebuehrChf: number | null; wartelistenPosition: number | null;
  rechnungsreferenz: string | null; bemerkung: string | null; rechnungId: string | null; moodleStatus: MoodleStatus;
  moodleFehler: string | null; abgeschlossenAm: string | null;
};

export type Lernnachweis = {
  id: string; kontaktId: string; anmeldungId: string | null; datum: string; titel: string; lernstunden: number;
  kategorie: string; quelle: 'kurs' | 'extern' | 'moodle';
};

export type ZertifizierungStatus = 'aktiv' | 'abgelaufen' | 'entzogen';
export type Zertifizierung = {
  id: string; kontaktId: string; typ: string; zertifikatNr: string | null; ausgestelltAm: string; gueltigBis: string;
  status: ZertifizierungStatus;
};

/** Oeffentliches Lesemodell fuer Homepage/Widget: bewusst ohne Personendaten (nDSG, Spec §7). */
export type OeffentlicheDurchfuehrung = {
  id: string; code: string | null; startDatum: string; endDatum: string; ort: string | null;
  kurstage: { datum: string; von: string | null; bis: string | null }[];
  preisChf: number | null; freiePlaetze: number; wartelisteMoeglich: true; anmeldeschluss: string | null;
};
export type OeffentlicherKurs = {
  code: string; slug: string | null; titel: string; untertitel: string | null; bereich: string; format: KursFormat;
  beschreibung: string | null; lernziele: string | null; zielgruppe: string | null; dauerTage: number | null;
  lernstunden: number | null; preisChf: number | null; saqAnerkannt: boolean; durchfuehrungen: OeffentlicheDurchfuehrung[];
};

// ---------------------------------------------------------------------------------------------
// Regeln Anmeldung
// ---------------------------------------------------------------------------------------------

/** Status, die einen Platz belegen (Kapazitaet). Warteliste, Storno und nicht_bestanden zaehlen nicht. */
export const AKTIVE_ANMELDESTATUS: AnmeldeStatus[] = ['angemeldet', 'bestaetigt', 'teilgenommen', 'abgeschlossen'];

/** Durchfuehrungsstatus, in denen Anmeldungen angenommen werden (`geplant` nur bei manueller Erfassung). */
export const ANMELDUNG_OFFEN: DurchfuehrungStatus[] = ['ausgeschrieben', 'bestaetigt'];

/** Storno ist moeglich, solange die Person nicht teilgenommen hat. */
export const STORNIERBAR: AnmeldeStatus[] = ['angemeldet', 'bestaetigt', 'warteliste'];

/** Verrechenbare Anmeldungen: alle mit Platz (inkl. nicht bestanden); Stornos nur mit Gebuehr. */
export const VERRECHENBAR: AnmeldeStatus[] = ['angemeldet', 'bestaetigt', 'teilgenommen', 'abgeschlossen', 'nicht_bestanden'];

export function berechneBelegung(kapazitaet: number, aktiv: number, warteliste: number): Belegung {
  return { kapazitaet, aktiv, warteliste, frei: Math.max(0, kapazitaet - aktiv) };
}

export type TeilnahmeStatus = 'teilgenommen' | 'abgeschlossen' | 'nicht_bestanden';
const TEILNAHME: TeilnahmeStatus[] = ['teilgenommen', 'abgeschlossen', 'nicht_bestanden'];
const TEILNAHME_VON: AnmeldeStatus[] = ['angemeldet', 'bestaetigt', 'teilgenommen', 'nicht_bestanden'];

/** Teilnahme setzen: nur fuer Personen mit Platz; ein Abschluss (Lernnachweis erstellt) ist endgueltig. */
export function pruefeTeilnahmeStatus(von: AnmeldeStatus, nach: TeilnahmeStatus): void {
  if (!TEILNAHME.includes(nach)) throw new ValidationError(`Teilnahmestatus muss ${TEILNAHME.join('/')} sein`);
  if (von === 'abgeschlossen' && nach === 'abgeschlossen') return;
  if (!TEILNAHME_VON.includes(von)) throw new ConflictError(`Teilnahme aus Status ${von} nicht moeglich`);
}

// Typen des Projektmanagement-Moduls (Spec v2 §5.3). Der Projekt-Stamm selbst liegt in ./types.ts.
import type { Projekt } from './types';

export type ProjektStatus = Projekt['status'];
export const PROJEKT_STATUS: readonly ProjektStatus[] = ['akquise', 'offeriert', 'laufend', 'abgeschlossen', 'abgesagt', 'archiviert'];

export type PhaseStatus = 'geplant' | 'aktiv' | 'abgeschlossen';
export const PHASE_STATUS: readonly PhaseStatus[] = ['geplant', 'aktiv', 'abgeschlossen'];

export type Phase = {
  id: string; projektId: string; name: string; reihenfolge: number;
  startDatum: string | null; endDatum: string | null; status: PhaseStatus;
};

export type Meilenstein = {
  id: string; projektId: string; phaseId: string | null; titel: string;
  faelligAm: string; erreichtAm: string | null; beschreibung: string | null;
};

export type AufgabeStatus = 'offen' | 'in_arbeit' | 'review' | 'erledigt' | 'abgebrochen';
export const AUFGABE_STATUS: readonly AufgabeStatus[] = ['offen', 'in_arbeit', 'review', 'erledigt', 'abgebrochen'];
/** Kanban-Spalten in Anzeige-Reihenfolge (abgebrochen wird nicht angezeigt). */
export const KANBAN_SPALTEN: readonly AufgabeStatus[] = ['offen', 'in_arbeit', 'review', 'erledigt'];
/** Status, die als "begonnen" gelten: nur erlaubt, wenn der Vorgaenger erledigt ist. */
export const GESTARTETE_STATUS: readonly AufgabeStatus[] = ['in_arbeit', 'review', 'erledigt'];

export type AufgabePrioritaet = 'tief' | 'normal' | 'hoch' | 'kritisch';
export const AUFGABE_PRIORITAET: readonly AufgabePrioritaet[] = ['tief', 'normal', 'hoch', 'kritisch'];

/** Aufgabe eines Projekts ODER CRM-Wiedervorlage (Kontakt/Organisation/Verkaufschance). */
export type Aufgabe = {
  id: string; titel: string; beschreibung: string | null; status: AufgabeStatus; prioritaet: AufgabePrioritaet;
  startDatum: string | null; faelligAm: string | null; zustaendigId: string | null;
  projektId: string | null; phaseId: string | null; kontaktId: string | null; organisationId: string | null;
  verkaufschanceId: string | null; vorgaengerId: string | null; schaetzungStunden: number | null;
  sortierung: number; erledigtAm: string | null; erstelltDurch: string | null; erstelltAm: string; geaendertAm: string;
};

export type Zeiterfassung = {
  id: string; mitarbeitendeId: string; projektId: string; aufgabeId: string | null; datum: string;
  stunden: number; taetigkeit: string; verrechenbar: boolean; ansatzChf: number | null;
  rechnungspositionId: string | null;
  /** abgeleitet: rechnungspositionId gesetzt -> Eintrag ist verrechnet und gesperrt */
  verrechnet: boolean;
};

export type ZeitGruppierung = 'mitarbeitende' | 'taetigkeit' | 'einzeln';
export const ZEIT_GRUPPIERUNG: readonly ZeitGruppierung[] = ['mitarbeitende', 'taetigkeit', 'einzeln'];

export type Ampel = 'gruen' | 'gelb' | 'rot';

export type Cockpit = {
  projektId: string;
  budgetChf: number | null; budgetStunden: number | null; aufwandBudgetChf: number | null;
  abgerechnetChf: number; leistungenChf: number; unverrechnetChf: number;
  stundenIst: number; stundenVerrechenbar: number;
  internKostenChf: number; honorareChf: number; deckungsbeitragChf: number;
  /** (leistungenChf + honorareChf) / budgetChf in %, 1 Nachkommastelle; null ohne Budget */
  budgetverbrauchProzent: number | null;
  /** stundenIst / budgetStunden in %, 1 Nachkommastelle; null ohne Stundenbudget (nur Info, nicht ampelrelevant) */
  stundenverbrauchProzent: number | null;
  fortschritt: { total: number; erledigt: number; prozent: number };
  meilensteine: { total: number; erreicht: number; ueberfaellig: number; maxVerzugTage: number };
  ampel: Ampel; ampelGruende: string[];
};

export type PortfolioEintrag = Cockpit & {
  nummer: string; name: string; jahr: number; status: ProjektStatus;
  auftraggeberId: string; projektleitungId: string | null;
};

export type KanbanSpalte = { status: AufgabeStatus; aufgaben: Aufgabe[] };
export type Kanban = { projektId: string; spalten: KanbanSpalte[] };

export type GanttTyp = 'phase' | 'aufgabe' | 'meilenstein' | 'einsatz';
export type GanttItem = {
  typ: GanttTyp; id: string; titel: string; start: string | null; ende: string | null;
  status: string; vorgaengerId?: string | null; phaseId?: string | null;
};
export type Gantt = { projektId: string; start: string | null; ende: string | null; items: GanttItem[] };

export type AuslastungTag = { datum: string; verplantTage: number };
export type Auslastung = { referentId: string; anzeigename: string; tage: AuslastungTag[]; summeTage: number };

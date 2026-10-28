-- Projektmanagement (Spec v2 §5.3): Projektstatus, Phasen, Meilensteine, Aufgaben (auch CRM-Wiedervorlagen),
-- Zeiterfassung (-> Verrechnung) und Einsatzplanung (Referent:innen).

alter table projekt
  add column status text not null default 'laufend'
    check (status in ('akquise','offeriert','laufend','abgeschlossen','abgesagt','archiviert')),
  add column projektleitung_id uuid references mitarbeitende(id),
  add column ansprechperson_kontakt_id uuid references kontakt(id),
  add column start_datum date,
  add column end_datum date,
  add column beschrieb text,
  add column budget_stunden numeric(8,2),             -- interner Stundenrahmen
  add column aufwand_budget_chf numeric(12,2),        -- Fremdkosten-Budget (Referenten, Material, Raum)
  add column aufwandkonto_id uuid references konto(id),
  add constraint projekt_zeitraum_chk check (end_datum is null or start_datum is null or end_datum >= start_datum);
create index projekt_status_idx on projekt (status);

create table projekt_phase (
  id uuid primary key default gen_random_uuid(),
  projekt_id uuid not null references projekt(id) on delete cascade,
  name text not null,
  reihenfolge integer not null default 0,
  start_datum date,
  end_datum date,
  status text not null default 'geplant' check (status in ('geplant','aktiv','abgeschlossen')),
  check (end_datum is null or start_datum is null or end_datum >= start_datum)
);
create index projekt_phase_projekt_idx on projekt_phase (projekt_id, reihenfolge);

create table meilenstein (
  id uuid primary key default gen_random_uuid(),
  projekt_id uuid not null references projekt(id) on delete cascade,
  phase_id uuid references projekt_phase(id) on delete set null,
  titel text not null,
  faellig_am date not null,
  erreicht_am date,
  beschreibung text
);
create index meilenstein_projekt_idx on meilenstein (projekt_id, faellig_am);

-- Eine Aufgabe gehoert zu einem Projekt ODER ist eine CRM-Wiedervorlage (Kontakt/Organisation/Verkaufschance).
create table aufgabe (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  beschreibung text,
  status text not null default 'offen' check (status in ('offen','in_arbeit','review','erledigt','abgebrochen')),
  prioritaet text not null default 'normal' check (prioritaet in ('tief','normal','hoch','kritisch')),
  start_datum date,
  faellig_am date,
  zustaendig_id uuid references mitarbeitende(id),
  projekt_id uuid references projekt(id) on delete cascade,
  phase_id uuid references projekt_phase(id) on delete set null,
  kontakt_id uuid references kontakt(id) on delete cascade,
  organisation_id uuid references organisation(id) on delete cascade,
  verkaufschance_id uuid references verkaufschance(id) on delete cascade,
  vorgaenger_id uuid references aufgabe(id) on delete set null,     -- Abhaengigkeit (Gantt)
  schaetzung_stunden numeric(8,2),
  sortierung integer not null default 0,                           -- Reihenfolge innerhalb Kanban-Spalte
  erledigt_am timestamptz,
  erstellt_durch text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  check (vorgaenger_id is null or vorgaenger_id <> id)
);
create index aufgabe_projekt_idx on aufgabe (projekt_id, status);
create index aufgabe_zustaendig_idx on aufgabe (zustaendig_id, status, faellig_am);
create index aufgabe_kontakt_idx on aufgabe (kontakt_id);

create table zeiterfassung (
  id uuid primary key default gen_random_uuid(),
  mitarbeitende_id uuid not null references mitarbeitende(id),
  projekt_id uuid not null references projekt(id),
  aufgabe_id uuid references aufgabe(id) on delete set null,
  datum date not null,
  stunden numeric(5,2) not null check (stunden > 0 and stunden <= 24),
  taetigkeit text not null,
  verrechenbar boolean not null default true,
  ansatz_chf numeric(10,2),                                        -- Verrechnungsansatz pro Stunde
  rechnungsposition_id uuid references rechnungsposition(id) on delete set null,   -- gesetzt = verrechnet
  erstellt_am timestamptz not null default now()
);
create index zeiterfassung_projekt_idx on zeiterfassung (projekt_id, datum);
create index zeiterfassung_ma_idx on zeiterfassung (mitarbeitende_id, datum);

-- Einsatzplanung: Referent:in an einem Datum fuer ein Projekt (optional einem Kurstag, FK in 010).
create table einsatz (
  id uuid primary key default gen_random_uuid(),
  referent_id uuid not null references referent(id),
  projekt_id uuid not null references projekt(id) on delete cascade,
  kurstag_id uuid,
  datum date not null,
  dauer_tage numeric(4,2) not null default 1 check (dauer_tage > 0 and dauer_tage <= 1),
  rolle text not null default 'Referent',
  honorar_chf numeric(10,2),                                       -- Kosten (Aufwand)
  status text not null default 'angefragt' check (status in ('angefragt','bestaetigt','abgesagt','durchgefuehrt')),
  bemerkung text,
  erstellt_am timestamptz not null default now()
);
create index einsatz_referent_idx on einsatz (referent_id, datum);
create index einsatz_projekt_idx on einsatz (projekt_id, datum);

-- CRM (Spec v2 §5.2). Begriffe an crm-spa angelehnt: Firma -> organisation, Kontakt, Aktivitaet (History), Aufgabe (Tasks).

create table organisation (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kategorie text not null default 'kunde'
    check (kategorie in ('kunde','interessent','partner','lieferant','uebrige')),
  klassifizierung text check (klassifizierung in ('A','B','C','akquisition')),   -- crm-spa: A-/B-/C-Kunde, Akquisition
  vip boolean not null default false,
  branche text,                                       -- z. B. Kantonalbank, Raiffeisen, Privatbank, Verband
  strasse text,
  plz text,
  ort text,
  land text not null default 'CH',
  telefon text,
  email text,
  website text,
  betreuer_id uuid references mitarbeitende(id),      -- "Lead bbz"
  bemerkung text,
  archiviert boolean not null default false,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create index organisation_name_idx on organisation (lower(name));

-- Debitor (auftraggeber) und CRM-Firma verknuepfen: eine Firma wird erst mit vollstaendiger Adresse zum Debitor.
alter table auftraggeber add column organisation_id uuid unique references organisation(id);

create table kontakt (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisation(id),   -- leer erlaubt (Privatperson, z. B. Quereinsteiger)
  anrede text check (anrede in ('Frau','Herr','Divers')),
  titel text,
  vorname text,
  nachname text not null,
  funktion text,
  abteilung text,
  email text,
  email2 text,
  telefon text,
  mobile text,
  sprache text not null default 'de',
  geburtsdatum date,
  rolle text,                                         -- Entscheider, HR/L&D, Teilnehmende, Referent ...
  zielgruppe text,                                    -- z. B. Geschaeftspartner, bbz-Netzwerk
  betreuer_id uuid references mitarbeitende(id),      -- "Lead bbz"
  interessen text[] not null default '{}'
    check (interessen <@ array['nachwuchs','tailormade','weiterbildung','zertifizierung','beratung']::text[]),
  prioritaet text check (prioritaet in ('hoch','mittel','tief')),
  newsletter boolean not null default false,
  einwilligung_am timestamptz,                        -- nDSG-Nachweis fuer Newsletter/Marketing
  einwilligung_quelle text,
  moodle_user_id integer unique,
  bemerkung text,
  archiviert boolean not null default false,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create unique index kontakt_email_uq on kontakt (lower(email)) where email is not null and not archiviert;
create index kontakt_organisation_idx on kontakt (organisation_id);
create index kontakt_name_idx on kontakt (lower(nachname), lower(vorname));

create table verkaufschance (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  organisation_id uuid not null references organisation(id),
  kontakt_id uuid references kontakt(id),
  bereich text,
  phase text not null default 'lead'
    check (phase in ('lead','qualifiziert','offeriert','verhandlung','gewonnen','verloren')),
  wert_chf numeric(12,2),
  wahrscheinlichkeit integer check (wahrscheinlichkeit between 0 and 100),
  erwarteter_abschluss date,
  verantwortlich_id uuid references mitarbeitende(id),
  quelle text,                                        -- homepage, empfehlung, bestandskunde, event, ausschreibung
  verlustgrund text,
  projekt_id uuid references projekt(id),             -- gesetzt, sobald gewonnen und Projekt eroeffnet
  abgeschlossen_am date,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create index verkaufschance_phase_idx on verkaufschance (phase);

create table aktivitaet (
  id uuid primary key default gen_random_uuid(),
  typ text not null check (typ in ('telefon','meeting','email','besuch','event','notiz','offerte','brief')),
  datum timestamptz not null default now(),
  betreff text not null,
  notizen text,
  kontakt_id uuid references kontakt(id) on delete cascade,
  organisation_id uuid references organisation(id) on delete cascade,
  projekt_id uuid references projekt(id) on delete set null,           -- "Projektbezug"
  verkaufschance_id uuid references verkaufschance(id) on delete set null,
  mitarbeitende_id uuid references mitarbeitende(id),                  -- Record-Lead
  erstellt_am timestamptz not null default now(),
  check (kontakt_id is not null or organisation_id is not null)
);
create index aktivitaet_kontakt_idx on aktivitaet (kontakt_id, datum desc);
create index aktivitaet_organisation_idx on aktivitaet (organisation_id, datum desc);

-- Eingang von Homepage-Formularen, E-Mail, Telefon: wird qualifiziert und in Kontakt/Verkaufschance ueberfuehrt.
create table anfrage (
  id uuid primary key default gen_random_uuid(),
  quelle text not null default 'homepage' check (quelle in ('homepage','email','telefon','event','import')),
  typ text not null default 'kontakt' check (typ in ('kontakt','offerte','tailormade','newsletter','rueckruf')),
  status text not null default 'neu' check (status in ('neu','in_bearbeitung','uebernommen','verworfen')),
  anrede text,
  vorname text,
  nachname text,
  email text,
  telefon text,
  organisation_name text,
  funktion text,
  interesse text,
  nachricht text,
  newsletter boolean not null default false,
  einwilligung boolean not null default false,
  payload jsonb not null default '{}',
  kontakt_id uuid references kontakt(id),
  verkaufschance_id uuid references verkaufschance(id),
  bearbeitet_durch_id uuid references mitarbeitende(id),
  eingegangen_am timestamptz not null default now(),
  erledigt_am timestamptz
);
create index anfrage_status_idx on anfrage (status, eingegangen_am desc);

-- Referent:innen / Trainer:innen (Spec v1 §4.9): intern = Mitarbeitende, extern = CRM-Kontakt
create table referent (
  id uuid primary key default gen_random_uuid(),
  typ text not null check (typ in ('intern','extern')),
  mitarbeitende_id uuid unique references mitarbeitende(id),
  kontakt_id uuid unique references kontakt(id),
  anzeigename text not null,
  fachgebiete text[] not null default '{}',
  tagessatz_chf numeric(10,2),
  halbtagessatz_chf numeric(10,2),
  aktiv boolean not null default true,
  bemerkung text,
  check ((typ = 'intern' and mitarbeitende_id is not null) or (typ = 'extern' and kontakt_id is not null))
);

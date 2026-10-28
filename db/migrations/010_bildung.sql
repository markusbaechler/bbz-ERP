-- Bildung / Seminarbetrieb (Spec v2 §5.4): Kursangebot (Katalog), Durchfuehrung, Kurstage, Anmeldungen,
-- Lernnachweise und SAQ-Zertifizierungen (Rezertifizierung ueber Lernstunden).

create table kursangebot (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                          -- z. B. "BEF" (Eigenheimfinanzierung)
  titel text not null,
  untertitel text,
  bereich text not null,                              -- Banking, Kundenberaterausbildung, Leadership, Zertifizierung, Nachwuchs, ...
  format text not null default 'praesenz' check (format in ('praesenz','blended','online','e_learning')),
  beschreibung text,
  lernziele text,
  zielgruppe text,
  voraussetzungen text,
  dauer_tage numeric(4,1),
  lernstunden numeric(5,1),                           -- anrechenbare Lernstunden (Rezertifizierung)
  preis_chf numeric(10,2),
  mwst_satz numeric(5,2) not null default 0,          -- Bildungsleistungen i. d. R. von der MWSt ausgenommen
  ertragskonto_id uuid references konto(id),
  saq_anerkannt boolean not null default false,
  moodle_vorlage_kurs_id integer,
  oeffentlich boolean not null default false,         -- auf Homepage publiziert
  slug text unique,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);

create table durchfuehrung (
  id uuid primary key default gen_random_uuid(),
  kursangebot_id uuid not null references kursangebot(id),
  projekt_id uuid references projekt(id),             -- Kostentraeger (Verrechnung/Kontierung)
  code text unique,                                   -- z. B. "BEF-2026-1"
  titel text,                                         -- optionaler Override des Angebotstitels
  start_datum date not null,
  end_datum date not null,
  ort text,
  kapazitaet integer not null default 16 check (kapazitaet > 0),
  min_teilnehmende integer not null default 1 check (min_teilnehmende >= 0),
  anmeldeschluss date,
  preis_chf numeric(10,2),                            -- optionaler Override des Angebotspreises
  status text not null default 'geplant'
    check (status in ('geplant','ausgeschrieben','bestaetigt','durchgefuehrt','abgesagt')),
  oeffentlich boolean not null default true,          -- false = geschlossener Firmenkurs (Tailor-made)
  auftraggeber_id uuid references auftraggeber(id),   -- bei Firmenkurs: bestellende Bank
  moodle_kurs_id integer,
  leitung_id uuid references mitarbeitende(id),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  check (end_datum >= start_datum)
);
create index durchfuehrung_start_idx on durchfuehrung (start_datum);
create index durchfuehrung_angebot_idx on durchfuehrung (kursangebot_id);

create table kurstag (
  id uuid primary key default gen_random_uuid(),
  durchfuehrung_id uuid not null references durchfuehrung(id) on delete cascade,
  datum date not null,
  von time,
  bis time,
  ort text,
  thema text,
  unique (durchfuehrung_id, datum, von)
);
alter table einsatz add constraint einsatz_kurstag_fk foreign key (kurstag_id) references kurstag(id) on delete cascade;

create table anmeldung (
  id uuid primary key default gen_random_uuid(),
  durchfuehrung_id uuid not null references durchfuehrung(id),
  kontakt_id uuid not null references kontakt(id),
  rechnungsempfaenger_id uuid references auftraggeber(id),          -- Arbeitgeber-Bank oder Person
  status text not null default 'angemeldet'
    check (status in ('angemeldet','bestaetigt','warteliste','storniert','teilgenommen','abgeschlossen','nicht_bestanden')),
  quelle text not null default 'manuell' check (quelle in ('manuell','homepage','import','moodle')),
  angemeldet_am timestamptz not null default now(),
  bestaetigt_am timestamptz,
  storniert_am timestamptz,
  stornogrund text,
  preis_chf numeric(10,2),                            -- Preis-Snapshot zum Anmeldezeitpunkt
  stornogebuehr_chf numeric(10,2),
  wartelisten_position integer,
  rechnungsreferenz text,                             -- Kostenstelle / Bestell-Nr. der Bank
  bemerkung text,
  rechnung_id uuid references rechnung(id),
  moodle_status text not null default 'ausstehend'
    check (moodle_status in ('nicht_relevant','ausstehend','eingeschrieben','fehler','ausgeschrieben')),
  moodle_fehler text,
  abgeschlossen_am timestamptz,                       -- aus Moodle-Kursabschluss oder manuell
  idempotenz_schluessel text unique,                  -- Doppel-Submit-Schutz (Homepage)
  erstellt_am timestamptz not null default now()
);
create unique index anmeldung_aktiv_uq on anmeldung (durchfuehrung_id, kontakt_id) where status <> 'storniert';
create index anmeldung_durchfuehrung_idx on anmeldung (durchfuehrung_id, status);
create index anmeldung_kontakt_idx on anmeldung (kontakt_id);

create table lernnachweis (
  id uuid primary key default gen_random_uuid(),
  kontakt_id uuid not null references kontakt(id),
  anmeldung_id uuid unique references anmeldung(id),
  datum date not null,
  titel text not null,
  lernstunden numeric(5,1) not null check (lernstunden >= 0),
  kategorie text not null default 'weiterbildung',
  quelle text not null default 'kurs' check (quelle in ('kurs','extern','moodle')),
  erstellt_am timestamptz not null default now()
);
create index lernnachweis_kontakt_idx on lernnachweis (kontakt_id, datum);

create table zertifizierung (
  id uuid primary key default gen_random_uuid(),
  kontakt_id uuid not null references kontakt(id),
  typ text not null,                                  -- z. B. "SAQ Kundenberater Bank – Individualkunden"
  zertifikat_nr text,
  ausgestellt_am date not null,
  gueltig_bis date not null,
  status text not null default 'aktiv' check (status in ('aktiv','abgelaufen','entzogen')),
  unique (kontakt_id, typ, ausgestellt_am),
  check (gueltig_bis > ausgestellt_am)
);

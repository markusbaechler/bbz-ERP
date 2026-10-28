-- Erweiterungen aus der Website-/AGB-Analyse (Spec v2 §2.3, §5.4b, §5.5, §6)

-- Bankengruppen (Raiffeisen, Clientis ...): Organisation kann einer Gruppe angehoeren
alter table organisation add column gruppe_id uuid references organisation(id);
create index organisation_gruppe_idx on organisation (gruppe_id);

-- Kursangebot: Homepage-Verknuepfung, Rezertifizierung, Nebenkosten, Annullationsregel
alter table kursangebot
  add column homepage_post_id integer,                               -- WordPress CPT "kurs"
  add column rezert_profile text[] not null default '{}',            -- anrechenbare SAQ-Profile (PK, IK, AFF, CWMA, KMU, CCOB)
  add column rezert_komponenten text[] not null default '{}'
    check (rezert_komponenten <@ array['fachwissen','verhalten']::text[]),
  add column nebenkosten_pro_tag_chf numeric(10,2),                  -- Verpflegung/Infrastruktur, separat ausgewiesen
  add column nebenkosten_mwst_satz numeric(5,2) not null default 8.1,
  add column annullationsregel text not null default 'oeffentlich'
    check (annullationsregel in ('oeffentlich','saq','projekt','keine'));

-- Durchfuehrung: Moodle-Face-to-Face-Session (heutiger Buchungskanal)
alter table durchfuehrung add column moodle_session_id integer unique;

-- Lernnachweis: SAQ-Komponenten
alter table lernnachweis add column komponenten text[] not null default '{}'
  check (komponenten <@ array['fachwissen','verhalten']::text[]);

-- Zertifizierung: SAQ-Profil
alter table zertifizierung add column profil text check (profil in ('PK','IK','AFF','CWMA','KMU','CCOB'));

-- SAQ-Zertifizierungsfall (Anmeldung -> Pruefungen -> Zertifikat)
create table saq_fall (
  id uuid primary key default gen_random_uuid(),
  kontakt_id uuid not null references kontakt(id),
  organisation_id uuid references organisation(id),                -- Arbeitgeber-Bank
  rechnungsempfaenger_id uuid references auftraggeber(id),
  profil text not null check (profil in ('PK','IK','AFF','CWMA','KMU','CCOB')),
  variante text not null default 'erstzertifizierung',              -- erstzertifizierung, tp1, tp2, tp3, passerelle, ...
  umfang text not null default 'gesamtpaket'
    check (umfang in ('selbststudium','schriftlich','muendlich','gesamtpaket')),
  sprache text not null default 'de' check (sprache in ('de','fr','it')),
  status text not null default 'angemeldet'
    check (status in ('angemeldet','in_vorbereitung','schriftlich_bestanden','zertifiziert','nicht_bestanden','abgebrochen')),
  arbeitgeberbestaetigung_am date,
  digitale_hilfsmittel boolean not null default false,
  einwilligung_rechnung_bank boolean not null default false,
  einwilligung_weitergabe_gruppe boolean not null default false,    -- z. B. Raiffeisen Schweiz
  zertifizierung_id uuid references zertifizierung(id),
  rechnung_id uuid references rechnung(id),
  anfrage_id uuid references anfrage(id),
  bemerkung text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create index saq_fall_kontakt_idx on saq_fall (kontakt_id);
create index saq_fall_status_idx on saq_fall (status, profil);

create table saq_pruefung (
  id uuid primary key default gen_random_uuid(),
  fall_id uuid not null references saq_fall(id) on delete cascade,
  art text not null check (art in ('schriftlich','muendlich')),
  durchfuehrung_id uuid references durchfuehrung(id),                -- Pruefungstermin (Kapazitaet)
  datum date not null,
  ort text,
  remote boolean not null default false,
  versuch integer not null default 1,
  resultat_prozent numeric(5,2) check (resultat_prozent between 0 and 100),
  bestanden boolean,
  erstellt_am timestamptz not null default now()
);
create index saq_pruefung_fall_idx on saq_pruefung (fall_id, art);

-- Mahnwesen (AGB: 30 Tage Zahlungsfrist, Erinnerung 10 Tage, ab 2. Erinnerung CHF 50)
alter table rechnung add column zahlungsfrist_tage integer not null default 30 check (zahlungsfrist_tage between 0 and 365);

create table mahnung (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnung(id),
  stufe integer not null check (stufe between 1 and 3),
  datum date not null,
  frist_bis date not null,
  gebuehr_chf numeric(10,2) not null default 0,
  offen_chf numeric(12,2) not null,                                 -- offener Betrag zum Mahnzeitpunkt
  erstellt_durch text,
  erstellt_am timestamptz not null default now(),
  unique (rechnung_id, stufe)
);

-- Protokoll der Integrationslaeufe (Moodle-Sync, Importe) fuer die Admin-Oberflaeche
create table integration_lauf (
  id bigserial primary key,
  typ text not null,                                                -- moodle.abschluss, moodle.buchungen, fm.import, ...
  gestartet_am timestamptz not null default now(),
  beendet_am timestamptz,
  status text not null default 'laeuft' check (status in ('laeuft','ok','teilweise','fehler')),
  ergebnis jsonb not null default '{}'
);

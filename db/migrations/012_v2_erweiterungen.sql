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

-- SAQ "Kundenberater Bank": Begriffe und Codes wie Reporting KUBA / bbz-saq (config.js PROFILES, PROFILE_PARTS)
-- Profile: PK, IK, AFFL, CWMA, KMU, CCoB · Sprachen DE, FR, IT, EN
alter table zertifizierung
  add column profil text check (profil in ('PK','IK','AFFL','CWMA','KMU','CCoB')),
  add column sprache text check (sprache in ('DE','FR','IT','EN'));

-- Zertifizierungsvorgang: eine Person durchlaeuft die Zertifizierung fuer ein Profil (KUBA: eine Zeile)
create table saq_fall (
  id uuid primary key default gen_random_uuid(),
  kontakt_id uuid not null references kontakt(id),
  organisation_id uuid references organisation(id),                -- Arbeitgeber-Bank (KUBA "Employer")
  rechnungsempfaenger_id uuid references auftraggeber(id),
  profil text not null check (profil in ('PK','IK','AFFL','CWMA','KMU','CCoB')),
  variante text not null default 'erstzertifizierung'
    check (variante in ('erstzertifizierung','passerelle','teilpruefung','wiederholung')),
  umfang text not null default 'gesamtpaket'
    check (umfang in ('selbststudium','schriftlich','muendlich','gesamtpaket')),
  sprache text not null default 'DE' check (sprache in ('DE','FR','IT','EN')),
  rolle text,                                                       -- Funktion gemaess SAQ-Rollenschluessel (KUBA "Role")
  kennzeichnung text,                                               -- VSS/VSM aus KUBA-Kommentar, Bedeutung [unklar]
  status text not null default 'angemeldet'
    check (status in ('angemeldet','in_pruefung','schriftlich_bestanden','bestanden','zertifiziert','nicht_bestanden','abgebrochen')),
  arbeitgeberbestaetigung_am date,
  digitale_hilfsmittel boolean not null default false,
  einwilligung_rechnung_bank boolean not null default false,
  einwilligung_weitergabe_gruppe boolean not null default false,    -- z. B. Raiffeisen Schweiz
  zertifizierung_id uuid references zertifizierung(id),
  rechnung_id uuid references rechnung(id),
  anfrage_id uuid references anfrage(id),
  kuba_herkunft text,                                               -- "Sheet:Zeile" bei Import aus Reporting_KUBA.xlsx
  bemerkung text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create index saq_fall_kontakt_idx on saq_fall (kontakt_id);
create index saq_fall_status_idx on saq_fall (status, profil);

-- Ein Run einer Teilpruefung (KUBA: WE1-WE6 schriftlich, OE1-OE2 muendlich, je RUN1-RUN3)
create table saq_pruefung (
  id uuid primary key default gen_random_uuid(),
  fall_id uuid not null references saq_fall(id) on delete cascade,
  art text not null check (art in ('schriftlich','muendlich')),
  teil integer not null check (teil between 1 and 6),
  run integer not null check (run between 1 and 3),
  durchfuehrung_id uuid references durchfuehrung(id),                -- Pruefungstermin (Kapazitaet)
  datum date not null,
  ort text,
  remote boolean not null default false,
  score numeric(6,2),                                               -- Punkte (KUBA "Score")
  resultat_prozent numeric(5,2) check (resultat_prozent between 0 and 100),   -- KUBA "Result"
  bestanden boolean,                                                -- massgebend (KUBA "Passed"); null = geplant/offen
  experte1_id uuid references referent(id),                         -- muendlich: Experte 1 / 2 (KUBA ab 2018)
  experte2_id uuid references referent(id),
  erstellt_am timestamptz not null default now(),
  unique (fall_id, art, teil, run),
  check (art = 'schriftlich' or teil <= 2)
);
create index saq_pruefung_fall_idx on saq_pruefung (fall_id, art, teil);
create index saq_pruefung_datum_idx on saq_pruefung (datum);

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

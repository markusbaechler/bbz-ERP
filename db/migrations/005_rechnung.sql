create table rechnung (
  id uuid primary key default gen_random_uuid(),
  projekt_id uuid not null references projekt(id),
  auftraggeber_id uuid not null references auftraggeber(id),
  datum date not null,
  betreff text,
  mwst_modus text not null default 'exkl' check (mwst_modus in ('exkl','inkl')),
  waehrung text not null default 'CHF',
  lfd_nr integer unique,                 -- erst bei Festschreibung vergeben; lueckenlos
  nummer text unique,                    -- Anzeige, z. B. "6231.26 - 33214 ml"
  status text not null default 'offen_prov'
    check (status in ('offen_prov','def_vereinbart','abgerechnet','bezahlt','storniert')),
  total_netto numeric(12,2) not null default 0,
  total_mwst  numeric(12,2) not null default 0,
  total_brutto numeric(12,2) not null default 0,
  erstellt_am timestamptz not null default now(),
  festgeschrieben_am timestamptz
);

create table rechnungsposition (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnung(id) on delete cascade,
  position integer not null,
  beschreibung text not null,
  menge numeric(12,2) not null default 1,
  einheit text not null default 'Pauschal',
  einzelpreis numeric(12,2) not null default 0,
  mwst_satz numeric(5,2) not null,
  konto_id uuid references konto(id),
  betrag_netto numeric(12,2) not null,
  unique (rechnung_id, position)
);

-- Lueckenloser Zaehler (FOR UPDATE gesperrt in der Festschreibungs-Transaktion)
create table zaehler (
  name text primary key,
  wert integer not null
);
insert into zaehler(name, wert) values ('rechnung_lfd_nr', 0);

create table projekt (
  id uuid primary key default gen_random_uuid(),
  nummer text not null,
  stammnummer integer not null,          -- 4-stellig; identifiziert das Projekt jahresuebergreifend
  jahr integer not null,                 -- 4-stellig
  kuerzel text,
  name text not null,
  bereich text,
  auftraggeber_id uuid not null references auftraggeber(id),
  ertragskonto_id uuid references konto(id),
  budget_chf numeric(12,2),
  budget_tage numeric(6,2),
  mwst_modus text not null default 'exkl' check (mwst_modus in ('exkl','inkl')),
  fortsetzung_von_id uuid references projekt(id),   -- optional, nur Sonderfaelle
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (stammnummer, jahr)             -- ein Projekt pro Stammnummer+Jahr
);
create index projekt_stammnummer_idx on projekt(stammnummer);  -- Jahresverlauf
create index projekt_jahr_idx on projekt(jahr);
create index projekt_auftraggeber_idx on projekt(auftraggeber_id);

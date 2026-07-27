create table zahlungseingang (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnung(id),
  datum date not null,
  betrag numeric(12,2) not null check (betrag > 0),
  bemerkung text,
  erfasst_durch text,
  erstellt_am timestamptz not null default now()
);
create index zahlungseingang_rechnung_idx on zahlungseingang(rechnung_id);

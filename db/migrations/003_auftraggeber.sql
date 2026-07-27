create table auftraggeber (
  id uuid primary key default gen_random_uuid(),
  nummer text unique,
  name text not null,
  strasse text not null,
  plz text not null,
  ort text not null,
  land text not null default 'CH',
  ansprechperson text,
  email text,
  telefon text,
  aktiv boolean not null default true
);

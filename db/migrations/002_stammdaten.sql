create table konto (
  id uuid primary key default gen_random_uuid(),
  nummer text not null unique,
  bezeichnung text not null,
  typ text not null check (typ in ('Ertrag','Aufwand')),
  aktiv boolean not null default true
);

create table mwst_satz (
  id uuid primary key default gen_random_uuid(),
  satz numeric(5,2) not null,
  bezeichnung text not null,
  gueltig_ab date not null,
  gueltig_bis date
);

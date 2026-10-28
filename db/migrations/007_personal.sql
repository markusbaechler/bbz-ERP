-- Mitarbeitende (User) gemaess Spec v1 §4.8 / Spec v2 §5.1
create table mitarbeitende (
  id uuid primary key default gen_random_uuid(),
  kuerzel text not null unique,                       -- z. B. "ml", "ph" (erscheint in der Rechnungsnummer)
  vorname text,
  nachname text not null,
  email text,
  rolle text not null default 'standard' check (rolle in ('admin','standard')),
  entra_oid text unique,                              -- Object-ID aus Entra ID (Token-Claim "oid")
  stundensatz_intern numeric(10,2),                   -- Kostensatz (PM-Cockpit)
  stundensatz_verrechnung numeric(10,2),              -- Default-Verkaufsansatz (Zeiterfassung)
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now()
);
create unique index mitarbeitende_email_uq on mitarbeitende (lower(email)) where email is not null;

-- Revisionsspur fuer fachlich relevante Aktionen (Spec v1 §6.6)
create table audit_log (
  id bigserial primary key,
  zeitpunkt timestamptz not null default now(),
  benutzer text,
  aktion text not null,
  entitaet text not null,
  entitaet_id text,
  details jsonb not null default '{}'
);
create index audit_log_entitaet_idx on audit_log (entitaet, entitaet_id);

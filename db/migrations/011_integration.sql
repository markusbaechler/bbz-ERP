-- Integrationen (Spec v2 §6): Homepage-API-Clients, Outbox (Moodle-Sync, Webhooks, Mail), Webhook-Abos, Idempotenz.

create table api_client (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null unique,                    -- sichtbarer Teil zur Zuordnung ("bbz_pk_ab12cd34")
  key_hash text not null,                             -- sha256 des vollstaendigen Schluessels
  scopes text[] not null default '{}',                -- public:read, public:anmeldung, public:anfrage, moodle:events
  erlaubte_origins text[] not null default '{}',      -- CORS-Whitelist (z. B. https://www.bankenberatungszentrum.ch)
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  zuletzt_genutzt_am timestamptz
);

-- Transaktionale Outbox: fachliche Aenderung + Folgeauftrag in derselben Transaktion; Worker arbeitet mit Retry ab.
create table outbox (
  id bigserial primary key,
  typ text not null,                                  -- moodle.einschreiben, moodle.ausschreiben, webhook, mail
  aggregat_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'offen' check (status in ('offen','in_arbeit','erledigt','fehler','tot')),
  versuche integer not null default 0,
  max_versuche integer not null default 8,
  naechster_versuch_am timestamptz not null default now(),
  letzter_fehler text,
  erstellt_am timestamptz not null default now(),
  erledigt_am timestamptz
);
create index outbox_faellig_idx on outbox (status, naechster_versuch_am);

create table webhook_abo (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  secret text not null,                               -- HMAC-SHA256-Schluessel fuer x-bbz-signature
  ereignisse text[] not null,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now()
);

create table idempotenz (
  schluessel text primary key,
  client_id uuid references api_client(id),
  status_code integer not null,
  antwort jsonb not null,
  erstellt_am timestamptz not null default now()
);

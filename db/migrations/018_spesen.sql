-- Spesen je Projekt, an den Kunden weiterverrechnet (FileMaker "Spesen Importieren" / pos_fak1_P: Datum, Anzahl_km,
-- Strecke, Betrag). km: menge = Kilometer, ansatz = CHF/km; auslage: menge 1, ansatz = Betrag.
create table spesen (
  id uuid primary key default gen_random_uuid(),
  projekt_id uuid not null references projekt(id),
  einsatz_id uuid references einsatz(id) on delete set null,
  datum date not null,
  art text not null check (art in ('km','auslage')),
  beschreibung text not null,
  menge numeric(10,2) not null default 1 check (menge > 0),
  ansatz_chf numeric(10,2) not null check (ansatz_chf >= 0),
  verrechenbar boolean not null default true,
  rechnungsposition_id uuid references rechnungsposition(id) on delete set null,   -- gesetzt = verrechnet
  erfasst_durch text,
  erstellt_am timestamptz not null default now()
);
create index spesen_projekt_idx on spesen (projekt_id, datum);

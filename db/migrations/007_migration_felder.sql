alter table auftraggeber
  add column zusatz text,
  add column adresse_unvollstaendig boolean not null default false;

alter table projekt
  add column alte_projekt_nr text,
  add column ansprechperson text,
  add column beschrieb text,
  add column projektleitung_kuerzel text,
  add column aufwand_budget_chf numeric(12,2),
  add column aufwand_konto_id uuid references konto(id),
  add column fm_offen_prov numeric(12,2),      -- FileMaker-Stand "offen_prov.", nur Abgleich/Historie
  add column fm_abgerechnet numeric(12,2),     -- FileMaker-Stand "abgerechnet", nur Abgleich/Historie
  add column erstellt_durch text,
  add column geaendert_durch text;

-- Idempotenz-Schluessel des Stammdaten-Imports
create unique index mwst_satz_satz_ab_idx on mwst_satz(satz, gueltig_ab);

-- Storno-Beleg (Spec v1 §6.1: "Storno erzeugt Storno-Beleg, keine Loeschung/Luecke"): Gutschrift mit eigener,
-- lueckenloser Nummer aus demselben Zaehler, Beträge gespiegelt, Verweis auf die Originalrechnung.
alter table rechnung
  add column typ text not null default 'rechnung' check (typ in ('rechnung','gutschrift')),
  add column bezug_rechnung_id uuid references rechnung(id);
create unique index rechnung_gutschrift_uq on rechnung (bezug_rechnung_id) where typ = 'gutschrift';

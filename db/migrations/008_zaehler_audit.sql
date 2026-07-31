-- Nachweis, wer den Rechnungszaehler wann gesetzt hat.
-- Der Zaehler festzulegen ist ein folgenreicher Akt: die daraus vergebenen
-- Rechnungsnummern sind nach Spec §6.1 unwiderruflich. Beide Spalten bleiben NULL,
-- solange niemand gesetzt hat — genau das ist der Zustand "noch nicht auf den
-- FileMaker-Stand gebracht" (siehe Untergrenze in src/config/rechnungszaehler.ts).
alter table zaehler
  add column gesetzt_am timestamptz,
  add column gesetzt_durch text;

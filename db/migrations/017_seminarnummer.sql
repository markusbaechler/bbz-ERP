-- Seminarnummer = fachlicher Schluessel eines Termins zwischen Moodle (Face-to-Face-Feld "Seminarnummer"),
-- der FileMaker-Loesung ("Seminar Nr.") und dem ERP. Grundlage fuer den Import des Moodle-Berichts
-- "Anmeldungen Kursdaten V2" (docs/integration/MOODLE.md §5).
alter table durchfuehrung add column seminarnummer text unique;

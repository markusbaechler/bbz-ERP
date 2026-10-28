-- Zwei SAQ-Profile derselben Person koennen am selben Tag zertifiziert werden (KUBA-Import, Rueckfrage 3):
-- Eindeutigkeit je Kontakt, Typ, Profil und Ausstellungsdatum.
alter table zertifizierung drop constraint zertifizierung_kontakt_id_typ_ausgestellt_am_key;
create unique index zertifizierung_eindeutig_uq on zertifizierung (kontakt_id, typ, coalesce(profil, ''), ausgestellt_am);

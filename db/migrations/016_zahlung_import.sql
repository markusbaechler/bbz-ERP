-- camt.054-Import (loest den ESR-Bankfile-Import der FileMaker-Loesung ab): Referenz der Bank je Zahlung,
-- damit derselbe Bankauszug nie doppelt verbucht wird. Manuell erfasste Zahlungen haben keine.
alter table zahlungseingang add column bank_referenz text;
create unique index zahlungseingang_bank_referenz_uq on zahlungseingang (bank_referenz) where bank_referenz is not null;

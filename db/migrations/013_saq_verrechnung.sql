-- SAQ-Verrechnung und -Annullation (AGB bbz Oktober 2026)
alter table saq_fall
  add column storniert_am date,
  add column stornogebuehr_chf numeric(10,2);

// bbz Creditor-Stammdaten (aus echtem Beleg). QR-IBAN SZKB, IID 30777.
export const CREDITOR = {
  account: 'CH4430777003713211030',
  name: 'Bankenberatungszentrum bbz st.gallen ag',
  address: 'Zürcherstrasse',
  buildingNumber: '202',
  zip: 9014,
  city: 'St. Gallen',
  country: 'CH',
  qrrPrefix: '7610400', // TODO gegen SZKB-ISR-Vertrag verifizieren
} as const;

import type { Data } from 'swissqrbill/types';
import type { Rechnung, Auftraggeber } from './types';
import { CREDITOR } from '../config/creditor';
import { qrReferenzRoh } from './qrReferenz';
import { ValidationError } from './errors';

export function baueQrDaten(rechnung: Rechnung, auftraggeber: Auftraggeber): Data {
  if (rechnung.lfdNr === null) throw new ValidationError('QR nur fuer festgeschriebene Rechnung (lfdNr fehlt)');
  return {
    currency: 'CHF',
    amount: rechnung.totalBrutto,
    reference: qrReferenzRoh(rechnung.lfdNr),
    creditor: {
      account: CREDITOR.account, name: CREDITOR.name, address: CREDITOR.address,
      buildingNumber: CREDITOR.buildingNumber, zip: CREDITOR.zip, city: CREDITOR.city, country: CREDITOR.country,
    },
    debtor: {
      name: auftraggeber.name, address: auftraggeber.strasse, zip: auftraggeber.plz,
      city: auftraggeber.ort, country: auftraggeber.land,
    },
  };
}

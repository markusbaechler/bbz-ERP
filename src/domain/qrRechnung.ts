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
    // Bewusst ohne auftraggeber.zusatz: das Debitor-Feld "name" ist auf 70 Zeichen
    // begrenzt und kennt keine eigene Zusatzzeile. Ein Zusammenfuegen von Name und
    // Zusatz wuerde bei anderen Auftraggebern unvorhersehbar an dieser Grenze
    // scheitern (swissqrbill validiert das und wirft dann einen Fehler) - fuer
    // einen Zahlteil, den die Bank zur Zahlungsverarbeitung nutzt, nicht zur
    // Postzustellung. Die Zustellung an die richtige Abteilung wird ueber den
    // Adressblock im Brief sichergestellt (siehe rechnungPdf.ts), der die
    // Zusatzzeile separat druckt.
    debtor: {
      name: auftraggeber.name, address: auftraggeber.strasse, zip: auftraggeber.plz,
      city: auftraggeber.ort, country: auftraggeber.land,
    },
  };
}

import { calculateQRReferenceChecksum, formatQRReference } from 'swissqrbill/utils';
import { CREDITOR } from '../config/creditor';

export function qrReferenzRoh(lfdNr: number, prefix: string = CREDITOR.qrrPrefix): string {
  const body = prefix + String(lfdNr).padStart(26 - prefix.length, '0'); // 26-stellig
  return body + calculateQRReferenceChecksum(body); // + Mod10-Pruefziffer -> 27
}

export function qrReferenzFormatiert(lfdNr: number, prefix: string = CREDITOR.qrrPrefix): string {
  return formatQRReference(qrReferenzRoh(lfdNr, prefix));
}

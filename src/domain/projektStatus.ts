import { ValidationError, ConflictError } from './errors';
import { PROJEKT_STATUS, type ProjektStatus } from './pmTypes';

/**
 * Erlaubte Projektstatus-Wechsel (Spec v2 §5.3):
 * akquise -> offeriert -> laufend -> abgeschlossen -> archiviert; abgesagt aus akquise/offeriert/laufend;
 * abgeschlossen -> laufend (Wiedereroeffnung). abgesagt und archiviert sind Endzustaende.
 */
export const STATUS_UEBERGAENGE: Readonly<Record<ProjektStatus, readonly ProjektStatus[]>> = {
  akquise: ['offeriert', 'abgesagt'],
  offeriert: ['laufend', 'abgesagt'],
  laufend: ['abgeschlossen', 'abgesagt'],
  abgeschlossen: ['archiviert', 'laufend'],
  abgesagt: [],
  archiviert: [],
};

export function istProjektStatus(s: unknown): s is ProjektStatus {
  return typeof s === 'string' && (PROJEKT_STATUS as readonly string[]).includes(s);
}

export function istErlaubterUebergang(von: ProjektStatus, nach: ProjektStatus): boolean {
  return STATUS_UEBERGAENGE[von]?.includes(nach) ?? false;
}

/**
 * Prueft einen Statuswechsel. Abschluss ist blockiert (Konflikt), solange verrechenbare, unverrechnete
 * Zeiteintraege existieren; `force` uebersteuert das (die Berechtigung dafuer prueft der Aufrufer).
 * Liefert `forciert: true`, wenn die Sperre tatsaechlich uebersteuert wurde (fuer das Audit-Log).
 */
export function pruefeStatusWechsel(p: { von: ProjektStatus; nach: ProjektStatus; unverrechneteEintraege: number; force: boolean }): { forciert: boolean } {
  if (!istProjektStatus(p.nach)) throw new ValidationError(`Unbekannter Projektstatus: ${String(p.nach)}`);
  if (!istErlaubterUebergang(p.von, p.nach)) {
    throw new ValidationError(`Statuswechsel ${p.von} -> ${p.nach} nicht erlaubt`);
  }
  if (p.nach === 'abgeschlossen' && p.unverrechneteEintraege > 0) {
    if (!p.force) {
      throw new ConflictError(`Abschluss blockiert: ${p.unverrechneteEintraege} verrechenbare Zeiteintraege sind noch nicht verrechnet`);
    }
    return { forciert: true };
  }
  return { forciert: false };
}

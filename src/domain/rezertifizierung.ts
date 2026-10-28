import { REZERTIFIZIERUNG } from '../config/bildung';
import { addMonate, heuteIso, tageZwischen } from './kursplanung';

export type RezertifizierungsStatus = {
  ausgestelltAm: string; gueltigBis: string; lernstundenIst: number; lernstundenSoll: number; fehlend: number;
  erfuellt: boolean; abgelaufen: boolean; tageBisAblauf: number;
};

/** Gueltigkeitsende eines Zertifikats, wenn nicht explizit angegeben (Default 36 Monate). */
export function standardGueltigBis(ausgestelltAm: string, monate: number = REZERTIFIZIERUNG.gueltigkeitMonate): string {
  return addMonate(ausgestelltAm, monate);
}

/** Lernstunden innerhalb [ausgestelltAm, gueltigBis] gegen das Soll (Default 24 Std.). */
export function rezertifizierungsStatus(
  z: { ausgestelltAm: string; gueltigBis: string },
  nachweise: { datum: string; lernstunden: number }[],
  opt: { heute?: string; soll?: number } = {},
): RezertifizierungsStatus {
  const heute = opt.heute ?? heuteIso();
  const soll = opt.soll ?? REZERTIFIZIERUNG.lernstundenSoll;
  const summe = nachweise
    .filter((n) => n.datum >= z.ausgestelltAm && n.datum <= z.gueltigBis)
    .reduce((s, n) => s + n.lernstunden, 0);
  const ist = Math.round(summe * 10) / 10;
  const fehlend = Math.max(0, Math.round((soll - ist) * 10) / 10);
  return {
    ausgestelltAm: z.ausgestelltAm, gueltigBis: z.gueltigBis, lernstundenIst: ist, lernstundenSoll: soll, fehlend,
    erfuellt: fehlend === 0, abgelaufen: heute > z.gueltigBis, tageBisAblauf: tageZwischen(heute, z.gueltigBis),
  };
}

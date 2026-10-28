// Reine Gruppierung von Zeiteintraegen zu Rechnungspositionen (Spec v2 §5.3 "Zeit -> Rechnung").
import { ValidationError } from './errors';
import { ZEIT_GRUPPIERUNG, type ZeitGruppierung } from './pmTypes';

export type ZeitEintragRoh = {
  id: string; mitarbeitendeId: string; kuerzel: string; datum: string;
  stunden: number; taetigkeit: string; ansatzChf: number | null;
};

/** Eine zu erzeugende Rechnungsposition: menge = Stunden, einzelpreis = Ansatz (CHF/Std). */
export type ZeitPosition = { beschreibung: string; menge: number; einzelpreis: number; eintragIds: string[] };

const runde2 = (x: number): number => Math.round(x * 100) / 100;

/** 12.5 -> "12.5", 8 -> "8", 0.25 -> "0.25" */
export function formatStunden(h: number): string {
  return String(runde2(h));
}

const datumCh = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Gruppiert Eintraege zu Positionen. Innerhalb einer Gruppe wird zusaetzlich nach Ansatz getrennt, damit
 * menge x einzelpreis exakt bleibt (unterschiedliche Ansaetze ergeben eigene Positionen).
 * - mitarbeitende: "Aufwand ml (12.5 Std)", sortiert nach Kuerzel, dann Ansatz absteigend
 * - taetigkeit:    "Konzept (8.5 Std)",     sortiert nach Taetigkeit, dann Ansatz absteigend
 * - einzeln:       "01.10.2026 ml: Konzept", chronologisch
 */
export function gruppiereZeit(eintraege: readonly ZeitEintragRoh[], gruppierung: ZeitGruppierung): ZeitPosition[] {
  if (!ZEIT_GRUPPIERUNG.includes(gruppierung)) throw new ValidationError(`gruppierung muss ${ZEIT_GRUPPIERUNG.join('|')} sein`);
  if (!eintraege.length) throw new ValidationError('Keine Zeiteintraege zu verrechnen');
  const ohneAnsatz = eintraege.filter((e) => e.ansatzChf === null || e.ansatzChf === undefined);
  if (ohneAnsatz.length) {
    throw new ValidationError(`Zeiteintraege ohne Ansatz: ${ohneAnsatz.map((e) => `${e.datum} ${e.kuerzel}`).join(', ')}`);
  }

  if (gruppierung === 'einzeln') {
    return [...eintraege]
      .sort((a, b) => a.datum.localeCompare(b.datum) || a.kuerzel.localeCompare(b.kuerzel))
      .map((e) => ({
        beschreibung: `${datumCh(e.datum)} ${e.kuerzel}: ${e.taetigkeit.trim()}`,
        menge: runde2(e.stunden), einzelpreis: e.ansatzChf as number, eintragIds: [e.id],
      }));
  }

  const label = (e: ZeitEintragRoh) => (gruppierung === 'mitarbeitende' ? e.kuerzel : e.taetigkeit.trim());
  const gruppen = new Map<string, { label: string; ansatz: number; stunden: number; ids: string[]; erstesDatum: string }>();
  for (const e of eintraege) {
    const ansatz = e.ansatzChf as number;
    const schluessel = `${gruppierung === 'mitarbeitende' ? e.mitarbeitendeId : label(e)}|${ansatz}`;
    const g = gruppen.get(schluessel) ?? { label: label(e), ansatz, stunden: 0, ids: [], erstesDatum: e.datum };
    g.stunden += e.stunden;
    g.ids.push(e.id);
    if (e.datum < g.erstesDatum) g.erstesDatum = e.datum;
    gruppen.set(schluessel, g);
  }
  return [...gruppen.values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'de') || b.ansatz - a.ansatz)
    .map((g) => {
      const menge = runde2(g.stunden);
      const beschreibung = gruppierung === 'mitarbeitende'
        ? `Aufwand ${g.label} (${formatStunden(menge)} Std)` : `${g.label} (${formatStunden(menge)} Std)`;
      return { beschreibung, menge, einzelpreis: g.ansatz, eintragIds: g.ids };
    });
}

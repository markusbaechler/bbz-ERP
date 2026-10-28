// Reine Aufgaben-Logik: Vorgaenger-Abhaengigkeiten (Gantt) und Kanban-Reihenfolge.

/**
 * Erzeugt "aufgabeId bekommt Vorgaenger neuerVorgaengerId" einen Zyklus?
 * `vorgaengerVon` bildet die bestehenden Kanten ab (Aufgabe -> ihr Vorgaenger). Da jede Aufgabe hoechstens
 * einen Vorgaenger hat, genuegt es, der Kette ab dem neuen Vorgaenger zu folgen: trifft sie auf aufgabeId,
 * entstuende ein Zyklus. Bereits zyklische Fremddaten fuehren nicht zu einer Endlosschleife.
 */
export function erzeugtZyklus(aufgabeId: string, neuerVorgaengerId: string | null | undefined,
  vorgaengerVon: ReadonlyMap<string, string | null>): boolean {
  const besucht = new Set<string>();
  let k: string | null | undefined = neuerVorgaengerId;
  while (k) {
    if (k === aufgabeId) return true;
    if (besucht.has(k)) return false;
    besucht.add(k);
    k = vorgaengerVon.get(k) ?? null;
  }
  return false;
}

/**
 * Kanban-Drag&Drop: setzt `id` an Position `index` (0-basiert) der Spalte `spalte` (aktuelle Reihenfolge der
 * Geschwister). Eine bereits enthaltene `id` wird verschoben; ungueltige Positionen werden an den Rand geklemmt.
 * Ergebnis ist die neue, dicht nummerierbare Reihenfolge der Spalte.
 */
export function kanbanEinordnen(spalte: readonly string[], id: string, index: number): string[] {
  const ohne = spalte.filter((x) => x !== id);
  const i = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : ohne.length, ohne.length));
  return [...ohne.slice(0, i), id, ...ohne.slice(i)];
}

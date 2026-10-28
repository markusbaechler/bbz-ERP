/** Ein:e Referent:in kann pro Tag hoechstens 1.0 Tage verplant werden (z. B. 2 x Halbtag). */
export const MAX_TAGE_PRO_DATUM = 1;

/** Status, die Kapazitaet belegen (abgesagt gibt den Tag frei). */
export const BELEGENDE_STATUS = ['angefragt', 'bestaetigt', 'durchgefuehrt'] as const;

export function istUeberbucht(bereitsVerplantTage: number, neuTage: number): boolean {
  // Auf Hundertstel runden, damit 0.5 + 0.5 nicht an Fliesskomma scheitert.
  return Math.round((bereitsVerplantTage + neuTage) * 100) > MAX_TAGE_PRO_DATUM * 100;
}

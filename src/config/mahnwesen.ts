/**
 * Mahnwesen (Spec v2 §5.5). Quelle: AGB bbz, Oktober 2026 (Website-Analyse §2.4): "Rechnung nach Ende der
 * Veranstaltung, zahlbar innert 30 Tagen. Danach 1. Erinnerung mit 10 Tagen Frist, ab der 2. Erinnerung CHF 50
 * Mahngebuehr."
 *
 * Die Gebuehr ist informativ auf der Mahnung (Brief/Mail) ausgewiesen; es entsteht KEINE automatische
 * Gebuehrenrechnung und `mahnung.offen_chf` enthaelt die Gebuehr nicht. Eine Verrechnung erfolgt bei Bedarf manuell.
 */
export type MahnStufe = { stufe: number; bezeichnung: string; fristTage: number; gebuehrChf: number };

export const MAHNWESEN: { zahlungsfristTage: number; stufen: MahnStufe[] } = {
  /** Default fuer `rechnung.zahlungsfrist_tage` [belegt: AGB]. */
  zahlungsfristTage: 30,
  /** Hoechste Stufe = letzte Mahnung; nach Ablauf ihrer Frist steht die Rechnung auf der Inkasso-Liste. */
  stufen: [
    { stufe: 1, bezeichnung: 'Zahlungserinnerung', fristTage: 10, gebuehrChf: 0 }, // [belegt: AGB] 10 Tage, ohne Gebuehr
    { stufe: 2, bezeichnung: '2. Mahnung', fristTage: 10, gebuehrChf: 50 },        // Frist [Hypothese], CHF 50 [belegt: AGB]
    { stufe: 3, bezeichnung: 'Letzte Mahnung', fristTage: 10, gebuehrChf: 50 },    // Frist [Hypothese], CHF 50 [belegt: AGB "ab der 2."]
  ],
};

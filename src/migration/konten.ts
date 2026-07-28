import type pg from 'pg';
import { csvRecords } from './csv';
import { fmText } from './normalize';
import { listKonten, upsertKonto } from '../repos/kontoRepo';

// Import des echten Kundenkontenplans ("Kontoplan 2024.xlsx", Blatt Erfolgsrechnung,
// exportiert nach kontoplan_erfolgsrechnung.csv).
//
// Bis hierher stand in src/migration/stammdaten.ts eine handverlesene Liste von elf
// Konten, deren Bezeichnungen aus der Bereichs-Spalte des Projekt-Exports abgeleitet —
// also erfunden — waren. Sie ist ersatzlos weg: die Migration erfindet keine Daten,
// auch keine Stammdaten. Der Kontenplan kommt jetzt ausschliesslich aus dieser Datei.
//
// Zwei Eigenheiten der Quelle:
//   * Der Kopf laeuft ueber zwei Zeilen ("MWST-" / "Code") und steht nicht auf Zeile 1
//     — csvRecords findet ihn ueber kopfSpalte: 'Nummer'.
//   * Zwischen den Konten stehen Gruppenzeilen (1- bis 3-stellige Nummern wie "3"
//     Betriebsertrag, "30" Leadership, "301" Ueberbetriebliche Leistungen) sowie Banner
//     ("E r f o l g s r e c h n u n g", "Total ..."). Konto ist nur, was eine 4- oder
//     5-stellige Nummer traegt.
//
// Die fuenfstelligen Nummern sind keine Fehler: der Plan ist MWSt-differenziert, eine
// angehaengte 1 ergibt den Zwilling des vierstelligen Kontos fuer die andere
// MWSt-Behandlung (3100 "Ausbildung von Lernenden" -> 31001 "... 7.7%").

export const istKontoNummer = (nummer: string | null): boolean =>
  nummer !== null && /^\d{4,5}$/.test(nummer);

export type KontoZeile = {
  nummer: string;
  bezeichnung: string;
  typ: 'Ertrag' | 'Aufwand';
  /** Roher MWST-Code der Quelle (510, 700, U00, ...) — nicht in einen Satz uebersetzt. */
  mwstCode: string | null;
  /** false, wenn die Quelle "Inaktiv" markiert hat. Die Zeile wird trotzdem importiert. */
  aktiv: boolean;
};

// Typ aus der fuehrenden Ziffer: 3 = Ertrag, alles andere (4-9) = Aufwand. Das ist die
// Gliederung des Blatts, nicht die betriebswirtschaftliche Wahrheit jeder einzelnen
// Zeile — "8000 Ausserordentlicher Ertrag" und "6810 Finanzertrag" sind der Sache nach
// Ertrag und landen hier unter Aufwand. Sie kommen im Projekt-Export nicht vor; eine
// feinere Regel waere ohne Vorgabe des Kunden geraten.
const typAusNummer = (nummer: string): 'Ertrag' | 'Aufwand' =>
  nummer.startsWith('3') ? 'Ertrag' : 'Aufwand';

export function leseKonten(text: string): {
  /** Datenzeilen der Datei unterhalb des Kopfs — Konten und Nicht-Konten zusammen. */
  zeilenGesamt: number;
  konten: KontoZeile[];
  /** Gruppen-, Banner- und Leerzeilen: gelesen, aber bewusst kein Konto. */
  uebersprungen: number;
  warnungen: string[];
} {
  const { records } = csvRecords(text, ';', { kopfSpalte: 'Nummer' });
  const warnungen: string[] = [];
  const konten: KontoZeile[] = [];
  const gesehen = new Set<string>();
  let uebersprungen = 0;

  for (const r of records) {
    const nummer = fmText(r['Nummer']);
    if (!istKontoNummer(nummer)) { uebersprungen++; continue; }
    const bezeichnung = fmText(r['Bezeichnung']);
    if (bezeichnung === null) {
      // Ein Konto ohne Bezeichnung waere in der Oberflaeche eine leere Zeile — und die
      // Bezeichnung ist genau das, wofuer diese Datei geholt wurde.
      warnungen.push(`Kontenplan: Konto ${nummer} ohne Bezeichnung — uebersprungen`);
      uebersprungen++;
      continue;
    }
    if (gesehen.has(nummer!)) {
      warnungen.push(`Kontenplan: Nummer ${nummer} kommt mehrfach vor — die erste Zeile gilt`);
      uebersprungen++;
      continue;
    }
    gesehen.add(nummer!);
    konten.push({
      nummer: nummer!,
      bezeichnung,
      typ: typAusNummer(nummer!),
      mwstCode: fmText(r['MWST-Code']),
      aktiv: fmText(r['Inaktiv']) === null,
    });
  }
  return { zeilenGesamt: records.length, konten, uebersprungen, warnungen };
}

export type KontenErgebnis = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  /** Alle Datenzeilen der Datei. */
  zeilenGesamt: number;
  /** Davon Kontozeilen (4- oder 5-stellige Nummer, mit Bezeichnung). */
  gelesen: number;
  /** Davon Gruppen-, Banner- und Leerzeilen. */
  uebersprungen: number;
  /** Neu angelegt (im Dry-Run: was ein --apply anlegen wuerde). */
  angelegt: number;
  /** Schon vorhanden und aufgefrischt (im Dry-Run: was ein --apply auffrischen wuerde). */
  aktualisiert: number;
  ertrag: number;
  aufwand: number;
  /** Stillgelegte Konten: importiert, aber aktiv=false. */
  inaktiv: number;
  warnungen: string[];
};

export async function importKonten(pool: pg.Pool, opts: {
  quelle: string; text: string; modus: 'dry-run' | 'apply';
}): Promise<KontenErgebnis> {
  const { zeilenGesamt, konten, uebersprungen, warnungen } = leseKonten(opts.text);

  // Einziger Lesezugriff, in beiden Modi: der Bestand. Der Dry-Run schreibt nichts,
  // kann so aber sagen, wie viele Konten wirklich dazukaemen — wie beim Adress-Nachtrag.
  const vorhanden = new Set((await listKonten(pool)).map((k) => k.nummer));

  const e: KontenErgebnis = {
    quelle: opts.quelle, modus: opts.modus, zeilenGesamt, gelesen: konten.length, uebersprungen,
    angelegt: 0, aktualisiert: 0, ertrag: 0, aufwand: 0, inaktiv: 0, warnungen,
  };

  for (const k of konten) {
    k.typ === 'Ertrag' ? e.ertrag++ : e.aufwand++;
    if (!k.aktiv) e.inaktiv++;
    if (opts.modus === 'apply') {
      // upsertKonto ist der einzige Schreibpfad fuer Konten — hier gibt es keinen zweiten.
      const r = await upsertKonto(pool, k);
      r.neu ? e.angelegt++ : e.aktualisiert++;
    } else {
      vorhanden.has(k.nummer) ? e.aktualisiert++ : e.angelegt++;
    }
  }
  return e;
}

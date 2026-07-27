import type pg from 'pg';
import type { Auftraggeber } from '../domain/types';
import { csvRecords } from './csv';
import { fmText, fmName } from './normalize';
import { wortabstand } from './auftraggeber';
import { listAuftraggeber, updateAuftraggeber } from '../repos/auftraggeberRepo';

// Nachtrag der Auftraggeber-Adressen aus dem separaten FileMaker-Adressexport
// (Adressen_Export.xlsx -> adressen_export.csv). Der Projekt-Export fuehrt keine
// Adressfelder (Befund B3), deshalb wurden alle 49 Auftraggeber mit
// adresse_unvollstaendig = true importiert und sind bis hierher nicht fakturierbar.
//
// Die Verknuepfung laeuft ueber "Kunden Nr." -> auftraggeber.nummer. Das ist derselbe
// Nummernkreis wie Auftraggeber_Nr. (49 von 49 treffen, je genau eine Zeile, kein
// widersprochener Name) — im Unterschied zu Bank_Nr. aus dem Faktura-Export, der
// bewusst nicht gejoint wurde.
//
// Geschrieben werden ausschliesslich strasse/plz/ort/land, und zwar ueber
// updateAuftraggeber: dort und nur dort wird adresse_unvollstaendig aus den Daten
// abgeleitet. name und zusatz stammen aus dem Projekt-Export und bleiben unberuehrt.

export type AdressZeile = {
  nummer: string;
  /** "Firma" der Adressdatei — nur fuer den Abgleich, wird nie geschrieben. */
  firma: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  /** true, wenn "CH" nicht in der Datei stand, sondern erschlossen wurde. */
  landAngenommen: boolean;
};

// Strasse ist im Export mehrzeilig moeglich ("Gurtengasse 6\nPostfach"). Das Adressfeld
// der QR-Rechnung ist einzeilig; beide Zeilen sind fuer die Zustellung relevant, darum
// werden sie mit Komma verbunden statt eine wegzuwerfen.
// Strasse_Nr. ist nur in 3 von 49 Zeilen gefuellt — sonst steht die Hausnummer schon in
// Strasse. Wenn sie separat gefuehrt wird, gehoert sie an die Strasse selbst, also an die
// erste Zeile, nicht hinter ein nachfolgendes "Postfach".
export function fmStrasse(strasse: string | undefined, strasseNr: string | undefined): string | null {
  const zeilen = (strasse ?? '').split('\n').map((z) => z.trim()).filter((z) => z !== '');
  if (zeilen.length === 0) return null;
  const nr = fmText(strasseNr);
  if (nr !== null) zeilen[0] = `${zeilen[0]} ${nr}`;
  return zeilen.join(', ');
}

// Ein vorhandenes Land wird nie angefasst: es steht im QR-Beleg, und die eine
// FL-Adresse (Liechtenstein) darf nicht still zu CH werden. Fehlt es, wird CH nur
// dann erschlossen, wenn PLZ vierstellig und Ort gefuellt ist — und der Aufrufer
// meldet jeden solchen Fall einzeln als Datenbefund.
export function fmLand(land: string | undefined, plz: string | undefined, ort: string | undefined):
  { wert: string | null; angenommen: boolean } {
  const l = fmText(land);
  if (l !== null) return { wert: l, angenommen: false };
  if (/^\d{4}$/.test(fmText(plz) ?? '') && fmText(ort) !== null) return { wert: 'CH', angenommen: true };
  return { wert: null, angenommen: false };
}

// Reine CSV-Auswertung ohne DB-Zugriff. Der Export fuehrt je Adresse eine Kopfzeile mit
// "Kunden Nr." und darunter Folgezeilen fuer Personen/Kommunikation, in denen alle
// Adressfelder leer sind — die zaehlen nicht als Adresse.
export function leseAdressen(text: string): {
  zeilenGesamt: number; adressen: AdressZeile[]; warnungen: string[];
} {
  const { records } = csvRecords(text);
  const warnungen: string[] = [];
  const adressen: AdressZeile[] = [];
  const gesehen = new Set<string>();
  for (const r of records) {
    const nummer = fmText(r['Kunden Nr.']);
    if (nummer === null) continue;
    if (gesehen.has(nummer)) {
      warnungen.push(`Adressdatei: Kunden Nr. ${nummer} kommt mehrfach vor — die erste Zeile gilt`);
      continue;
    }
    gesehen.add(nummer);
    const land = fmLand(r['Land'], r['PLZ'], r['Ort']);
    adressen.push({
      nummer,
      firma: fmText(r['Firma']),
      strasse: fmStrasse(r['Strasse'], r['Strasse_Nr.']),
      plz: fmText(r['PLZ']),
      ort: fmText(r['Ort']),
      land: land.wert,
      landAngenommen: land.angenommen,
    });
  }
  return { zeilenGesamt: records.length, adressen, warnungen };
}

export type AdressenErgebnis = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  /** Alle Datenzeilen der Datei, auch die Folgezeilen ohne eigene Adresse. */
  zeilenGesamt: number;
  /** Zeilen mit "Kunden Nr." — die Adressen selbst. */
  eintraege: number;
  /** Eintraege, zu denen es einen Auftraggeber gibt. */
  getroffen: number;
  /** Eintraege ohne Auftraggeber — erwartet, es wird nie einer angelegt. */
  ohneTreffer: number;
  /** Adressen, die dieser Lauf geschrieben hat (im Dry-Run: geschrieben haette). */
  geschrieben: number;
  /** Bereits identisch hinterlegt — der Beleg fuer die Idempotenz. */
  unveraendert: number;
  /** Eintrag ohne Strasse/PLZ/Ort: nicht geschrieben, Kennzeichen bleibt. */
  unvollstaendig: number;
  /** Wer danach weiterhin adresse_unvollstaendig traegt und nicht fakturierbar ist. */
  nochOhneAdresse: Array<{ nummer: string; name: string }>;
  warnungen: string[];
  datenbefunde: string[];
};

const fehlendeFelder = (a: AdressZeile): string[] => {
  const fehlt: string[] = [];
  if (a.strasse === null) fehlt.push('Strasse');
  if (a.plz === null) fehlt.push('PLZ');
  if (a.ort === null) fehlt.push('Ort');
  return fehlt;
};

// Bereits gleich hinterlegt? Dann wird nicht geschrieben — der zweite Lauf meldet
// "unveraendert" statt derselben Zahl noch einmal als Erfolg.
const istGleich = (ag: Auftraggeber, a: AdressZeile): boolean =>
  !ag.adresseUnvollstaendig
  && ag.strasse === a.strasse && ag.plz === a.plz && ag.ort === a.ort
  && (a.land === null || ag.land === a.land);

export async function importAdressen(pool: pg.Pool, opts: {
  quelle: string; text: string; modus: 'dry-run' | 'apply';
}): Promise<AdressenErgebnis> {
  const { zeilenGesamt, adressen, warnungen } = leseAdressen(opts.text);
  const datenbefunde: string[] = [];

  // Einziger Lesezugriff: der Bestand. Anders als der Projekt-Dry-Run liest der
  // Adress-Dry-Run die Datenbank, weil die Zuordnung ueberhaupt erst an ihr entsteht —
  // geschrieben wird auch dort nichts.
  const bestand = await listAuftraggeber(pool);
  const nachNummer = new Map<string, Auftraggeber>();
  for (const ag of bestand) if (ag.nummer !== null) nachNummer.set(ag.nummer, ag);

  const ergebnis: AdressenErgebnis = {
    quelle: opts.quelle, modus: opts.modus, zeilenGesamt, eintraege: adressen.length,
    getroffen: 0, ohneTreffer: 0, geschrieben: 0, unveraendert: 0, unvollstaendig: 0,
    nochOhneAdresse: [], warnungen, datenbefunde,
  };
  // Wer nach diesem Lauf eine vollstaendige Adresse traegt — im Dry-Run die Menge,
  // die ein Apply vervollstaendigen wuerde.
  const vervollstaendigt = new Set<string>();
  const unvollstaendigeZeile = new Map<string, string[]>();

  for (const a of adressen) {
    const ag = nachNummer.get(a.nummer);
    if (ag === undefined) { ergebnis.ohneTreffer++; continue; }
    ergebnis.getroffen++;

    // Der Adressexport fuehrt einen eigenen Firmennamen. Name und Zusatz stammen aus dem
    // Projekt-Export und sind gesetzt — eine Abweichung wird festgehalten, nicht ueberschrieben.
    const firma = a.firma === null ? null : fmName(a.firma).name;
    if (firma !== null && wortabstand(firma) !== wortabstand(ag.name)) {
      datenbefunde.push(
        `Auftraggeber ${a.nummer}: Name im Projekt-Export "${ag.name}", in der Adressdatei "${firma}" — ` +
        `Name und Zusatz bleiben unveraendert, uebernommen wird nur die Adresse`);
    }

    const fehlt = fehlendeFelder(a);
    if (fehlt.length > 0) {
      // Eine halbe Adresse saehe in der Datenbank aus wie eine ganze und gaebe die
      // Festschreibung frei — darum gar nichts schreiben.
      ergebnis.unvollstaendig++;
      unvollstaendigeZeile.set(a.nummer, fehlt);
      continue;
    }

    if (a.landAngenommen) {
      datenbefunde.push(
        `Auftraggeber ${a.nummer} "${ag.name}": Adressdatei ohne Land — "CH" angenommen ` +
        `(PLZ ${a.plz} vierstellig, Ort "${a.ort}"). Angenommen, nicht belegt.`);
    }

    vervollstaendigt.add(a.nummer);
    if (istGleich(ag, a)) { ergebnis.unveraendert++; continue; }
    if (opts.modus === 'apply') {
      await updateAuftraggeber(pool, ag.id, {
        strasse: a.strasse!, plz: a.plz!, ort: a.ort!,
        ...(a.land === null ? {} : { land: a.land }),
      });
    }
    ergebnis.geschrieben++;
  }

  // Handlungsbedarf: wer danach immer noch gesperrt ist — mit Grund, damit der Operator
  // nicht raten muss, ob die Zeile fehlt oder unbrauchbar war.
  for (const ag of bestand) {
    if (!ag.adresseUnvollstaendig || (ag.nummer !== null && vervollstaendigt.has(ag.nummer))) continue;
    const nummer = ag.nummer ?? '(ohne Nr.)';
    ergebnis.nochOhneAdresse.push({ nummer, name: ag.name });
    const fehlt = ag.nummer === null ? undefined : unvollstaendigeZeile.get(ag.nummer);
    warnungen.push(
      fehlt === undefined
        ? `Auftraggeber ${nummer} "${ag.name}": keine Zeile in der Adressdatei — ohne Adresse, ` +
          `die Festschreibung weist ihn weiterhin ab`
        : `Auftraggeber ${nummer} "${ag.name}": Adressdatei ohne ${fehlt.join('/')} — nichts uebernommen, ` +
          `die Festschreibung weist ihn weiterhin ab`);
  }
  ergebnis.nochOhneAdresse.sort((a, b) => a.nummer.localeCompare(b.nummer));

  return ergebnis;
}

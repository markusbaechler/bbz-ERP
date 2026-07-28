// Auswertung von Formulareingaben — bewusst ohne DOM, damit sie ohne
// Browser-Umgebung pruefbar ist (die Ein-Abhaengigkeits-Regel verbietet jsdom).

/**
 * Wandelt eine Benutzereingabe in eine Zahl oder in `null`.
 *
 * Das Komma ist auf der Schweizer Tastatur das naheliegende Dezimalzeichen:
 * „33,5" ist keine Fehleingabe, sondern die Tastatur. Apostroph und (schmales)
 * geschuetztes Leerzeichen sind die ueblichen Tausendertrenner („1'250.00").
 *
 * `null` statt `NaN`, weil `NaN` durch `JSON.stringify` zu `null` wird und
 * erst in der Datenbank auffaellt — als englisches 500.
 */
export function zahl(eingabe) {
  const roh = String(eingabe ?? '').trim()
    .replace(/['’\s  ]/g, '')
    .replace(',', '.');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(roh)) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

// Menge und Einzelpreis stehen als numeric(12,2) in der Datenbank. Mehr
// Nachkommastellen rundet Postgres beim Insert still — der gedruckte Betrag
// stuende dann im Widerspruch zu den ebenfalls gedruckten Faktoren (Befund C1).
function nachkommastellen(n) {
  const s = String(n);
  const punkt = s.indexOf('.');
  return s.includes('e') ? 99 : punkt < 0 ? 0 : s.length - punkt - 1;
}

function pruefeZahl(feld, bezeichnung, roh) {
  const n = zahl(roh);
  if (n === null) return { feld, meldung: `${bezeichnung} muss eine Zahl sein.` };
  if (n <= 0) return { feld, meldung: `${bezeichnung} muss grösser als 0 sein.` };
  if (nachkommastellen(n) > 2) {
    return { feld, meldung: `${bezeichnung} darf höchstens zwei Nachkommastellen haben — ${n} lässt sich nicht speichern.` };
  }
  return { wert: n };
}

/**
 * Prueft die Eingaben des Positionsformulars und gibt entweder
 * `{ fehler: { feld, meldung } }` oder `{ werte: { … } }` zurueck.
 *
 * Dieselben Regeln stehen ein zweites Mal in `addPosition`
 * (`src/repos/rechnungRepo.ts`) — massgeblich ist der Server; hier geht es
 * darum, die Meldung auf Deutsch am richtigen Feld zu zeigen statt als roten
 * Balken nach einem vergeblichen Rundlauf.
 */
export function pruefePosition(roh) {
  const beschreibung = String(roh?.beschreibung ?? '').trim();
  if (!beschreibung) return { fehler: { feld: 'beschreibung', meldung: 'Beschreibung ist Pflicht.' } };

  const menge = pruefeZahl('menge', 'Menge', roh.menge);
  if (menge.wert === undefined) return { fehler: menge };
  const einzelpreis = pruefeZahl('einzelpreis', 'Einzelpreis', roh.einzelpreis);
  if (einzelpreis.wert === undefined) return { fehler: einzelpreis };

  return { werte: { beschreibung, menge: menge.wert, einzelpreis: einzelpreis.wert } };
}

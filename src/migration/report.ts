export type SummenVergleich = { csv: number; db: number | null; differenz: number | null; ok: boolean };

export type ImportReport = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  /** Gesetzt, wenn der Lauf genau einen Jahrgang betrifft — sonst null. */
  jahr: number | null;
  /** Alle Jahrgaenge, die dieser Lauf uebernommen hat, aufsteigend. */
  jahre: number[];
  auftraggeber: { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number };
  projekte: { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number };
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
  zaehler: { gesetztAuf: number | null; hinweis: string | null };
  summen: { budgetChf: SummenVergleich; offenProv: SummenVergleich; abgerechnet: SummenVergleich };
  warnungen: string[];
  /** Erlaeuterungen zum Lauf selbst (z.B. was der Dry-Run nicht pruefen kann). */
  hinweise: string[];
};

// Toleranz des Summenabgleichs, `anzahl` = Zahl der summierten Projekte.
// Regel: jeder Betrag liegt als numeric(12,2) in der DB. Ein CSV-Wert mit mehr als
// zwei Nachkommastellen wird beim Schreiben je Projekt um bis zu einen halben Rappen
// gerundet, ueber n Projekte also um bis zu n * 0.005. Dazu kommt ein Rappen fuer die
// Rundung der Gesamtsumme selbst. Eine feste Toleranz von 0.01 wuerde beim
// angekuendigten Vollexport (~4967 Projekte) einen korrekten Lauf als ABWEICHUNG
// melden; ohne den n-Anteil waere die Regel nicht skalierbar.
export function vergleiche(csv: number, db: number | null, anzahl = 0): SummenVergleich {
  if (db === null) return { csv, db: null, differenz: null, ok: true };
  const differenz = Math.round((db - csv) * 100) / 100;
  const toleranz = 0.01 + anzahl * 0.005;
  return { csv, db, differenz, ok: Math.abs(differenz) <= toleranz };
}

const chf = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Ein Jahrgang -> "Jahr: 2026"; mehrere -> Spanne, damit nie ein einzelnes Jahr
// behauptet wird, das bloss aus der ersten Zeile stammt.
const jahrgangText = (jahre: number[]): string => {
  if (jahre.length === 0) return '';
  if (jahre.length === 1) return ` · **Jahr:** ${jahre[0]}`;
  return ` · **Jahrgaenge:** ${jahre[0]}–${jahre[jahre.length - 1]} (${jahre.length})`;
};

export function formatReport(r: ImportReport): string {
  const zeile = (name: string, v: SummenVergleich) =>
    `| ${name} | ${chf(v.csv)} | ${chf(v.db)} | ${v.differenz === null ? '—' : chf(v.differenz)} | ${v.ok ? 'ok' : '**ABWEICHUNG**'} |`;
  return [
    `# Migrations-Report`,
    ``,
    `**Quelle:** \`${r.quelle}\` · **Modus:** ${r.modus}${jahrgangText(r.jahre)}`,
    ``,
    `## Uebernommene Datensaetze`,
    ``,
    `| Bereich | gelesen | neu | aktualisiert | Hinweis |`,
    `|---|---:|---:|---:|---|`,
    `| Auftraggeber | ${r.auftraggeber.gelesen} | ${r.auftraggeber.neu} | ${r.auftraggeber.aktualisiert} | ${r.auftraggeber.ohneAdresse} ohne Adresse |`,
    `| Projekte | ${r.projekte.gelesen} | ${r.projekte.neu} | ${r.projekte.aktualisiert} | ${r.projekte.uebersprungen} uebersprungen |`,
    `| Konten | ${r.konten.angelegt + r.konten.vorhanden} | ${r.konten.angelegt} | ${r.konten.vorhanden} | Kontenplan |`,
    `| MWSt-Saetze | ${r.mwstSaetze.angelegt + r.mwstSaetze.vorhanden} | ${r.mwstSaetze.angelegt} | ${r.mwstSaetze.vorhanden} | Satzhistorie |`,
    ``,
    `## Summenabgleich gegen FileMaker`,
    ``,
    `| Kennzahl | CSV | Datenbank | Differenz | Status |`,
    `|---|---:|---:|---:|---|`,
    zeile('Budget CHF', r.summen.budgetChf),
    zeile('offen_prov.', r.summen.offenProv),
    zeile('abgerechnet', r.summen.abgerechnet),
    ``,
    `## Rechnungszaehler`,
    ``,
    r.zaehler.gesetztAuf === null
      ? `Nicht gesetzt. ${r.zaehler.hinweis ?? ''}`.trim()
      : `Gesetzt auf **${r.zaehler.gesetztAuf}**.`,
    ``,
    `## Warnungen (${r.warnungen.length})`,
    ``,
    ...(r.warnungen.length === 0 ? ['Keine.'] : r.warnungen.map((w) => `- ${w}`)),
    ``,
    ...(r.hinweise.length === 0 ? [] : [`## Hinweise zum Lauf`, ``, ...r.hinweise.map((h) => `- ${h}`), ``]),
  ].join('\n');
}

import type { AdressenErgebnis } from './adressen';

export type SummenVergleich = { csv: number; db: number | null; differenz: number | null; ok: boolean };

export type ImportReport = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  /** false bei einem reinen Adressen-Nachtrag (--adressen ohne --projekte). */
  projekteLauf: boolean;
  /** Nur gesetzt, wenn --adressen uebergeben wurde — sonst waechst kein leerer Abschnitt. */
  adressen: AdressenErgebnis | null;
  /** Gesetzt, wenn der Lauf genau einen Jahrgang betrifft — sonst null. */
  jahr: number | null;
  /** Alle Jahrgaenge, die dieser Lauf uebernommen hat, aufsteigend. */
  jahre: number[];
  auftraggeber: { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number };
  projekte: { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number };
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
  zaehler: {
    /** Wert, den *dieser* Lauf gesetzt hat — null, wenn er den Zaehler nicht angefasst hat. */
    gesetztAuf: number | null;
    /** Stand nach dem Lauf. Im Dry-Run null: der liest die Datenbank nicht. */
    stand: number | null;
    /** Untergrenze aus src/config/rechnungszaehler.ts. */
    untergrenze: number;
    /** Blockt die Untergrenze die Festschreibung? Im Dry-Run null (Stand unbekannt). */
    gesperrt: boolean | null;
    hinweis: string | null;
  };
  summen: { budgetChf: SummenVergleich; offenProv: SummenVergleich; abgerechnet: SummenVergleich };
  /** Handlungsbeduerftig: hier fehlt etwas oder muss jemand entscheiden. */
  warnungen: string[];
  /** Reine Datenbefunde: festgehalten, aber es geht nichts verloren. */
  datenbefunde: string[];
  /** Erlaeuterungen zum Lauf selbst (z.B. was der Dry-Run nicht pruefen kann). */
  hinweise: string[];
};

// Toleranz des Summenabgleichs. `gerundeteWerte` = Zahl der summierten Betraege, die
// beim Schreiben als numeric(12,2) tatsaechlich gerundet werden mussten (mehr als zwei
// Nachkommastellen). Nur solche Werte erzeugen ueberhaupt Spielraum, und zwar bis zu
// einem halben Rappen je Wert; dazu kommt ein Rappen fuer die Rundung der Gesamtsumme.
// Bewusst nicht an der Projektzahl aufgehaengt: der reale Export fuehrt durchweg zwei
// Nachkommastellen, dort waere ein Term von n * 0.005 beim angekuendigten Vollexport
// (~4967 Projekte) ein Spielraum von +/- 24.84 CHF — genug, um ein verlorenes
// Kleinprojekt als "ok" durchzuwinken. So bleibt die Toleranz dort bei einem Rappen und
// waechst nur, wenn ein Export wirklich feinere Betraege liefert.
export function vergleiche(csv: number, db: number | null, gerundeteWerte = 0): SummenVergleich {
  if (db === null) return { csv, db: null, differenz: null, ok: true };
  const differenz = Math.round((db - csv) * 100) / 100;
  const toleranz = 0.01 + gerundeteWerte * 0.005;
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

// Was der Lauf gesetzt hat, ist nur die halbe Auskunft — der Operator will wissen,
// ob er jetzt fakturieren kann. Darum zusaetzlich Stand, Untergrenze und Sperre.
const zaehlerStandZeile = (z: ImportReport['zaehler']): string => {
  if (z.stand === null) {
    return `Aktueller Stand: im Dry-Run nicht gelesen (der Dry-Run fasst die Datenbank nicht an). ` +
      `Untergrenze: **${z.untergrenze}**.`;
  }
  if (z.gesperrt) {
    return `Aktueller Stand: **${z.stand}**, Untergrenze **${z.untergrenze}** — die Festschreibung ist ` +
      `**gesperrt**: der Zaehler steht noch nicht auf dem FileMaker-Stand. Hoechststand in FileMaker ablesen ` +
      `und setzen: \`npm run zaehler -- --rechnung-max=<n>\` oder \`PUT /zaehler/rechnung\`.`;
  }
  return `Aktueller Stand: **${z.stand}**, ueber der Untergrenze **${z.untergrenze}** — die Festschreibung ist ` +
    `moeglich. Die Untergrenze ist nur der aus dem Faktura-Export belegbare Boden (26.06.2025); der reale ` +
    `Hoechststand steht in FileMaker und liegt darueber.`;
};

// Der Adress-Nachtrag muss fuer einen Menschen genau eine Frage beantworten: wer ist
// jetzt fakturierbar und wer nicht. Darum die Trichter-Zahlen von der Datei bis zur
// geschriebenen Adresse — und danach namentlich, wer weiterhin gesperrt ist.
const adressenAbschnitt = (a: AdressenErgebnis): string[] => [
  `## Adressen-Nachtrag`,
  ``,
  `**Quelle:** \`${a.quelle}\` · **Modus:** ${a.modus}` +
    (a.modus === 'dry-run' ? ' (nichts geschrieben — die Zahlen zeigen, was ein `--apply` taete)' : ''),
  ``,
  `| Kennzahl | Anzahl |`,
  `|---|---:|`,
  `| Zeilen in der Datei | ${a.zeilenGesamt} |`,
  `| davon Adressen (mit Kunden Nr.) | ${a.eintraege} |`,
  `| davon einem Auftraggeber zugeordnet | ${a.getroffen} |`,
  `| ohne Auftraggeber (bewusst nicht angelegt) | ${a.ohneTreffer} |`,
  `| Adressen ${a.modus === 'apply' ? 'geschrieben' : 'zu schreiben'} | ${a.geschrieben} |`,
  `| bereits identisch hinterlegt | ${a.unveraendert} |`,
  `| unvollstaendig, nicht uebernommen | ${a.unvollstaendig} |`,
  ``,
  a.nochOhneAdresse.length === 0
    ? `Alle zugeordneten Auftraggeber haben eine vollstaendige Adresse — keiner ist mehr wegen ` +
      `\`adresse_unvollstaendig\` von der Festschreibung ausgeschlossen.`
    : `Weiterhin ohne Adresse und damit **nicht fakturierbar** (${a.nochOhneAdresse.length}): ` +
      a.nochOhneAdresse.map((x) => `**${x.nummer}** „${x.name}"`).join(', ') +
      `. Die Festschreibung weist diese Auftraggeber ab, bis die Adresse nachgetragen ist ` +
      `(\`PUT /auftraggeber/:id\`).`,
  ``,
];

export function formatReport(r: ImportReport): string {
  const zeile = (name: string, v: SummenVergleich) =>
    `| ${name} | ${chf(v.csv)} | ${chf(v.db)} | ${v.differenz === null ? '—' : chf(v.differenz)} | ${v.ok ? 'ok' : '**ABWEICHUNG**'} |`;
  return [
    `# Migrations-Report`,
    ``,
    `**Quelle:** \`${r.quelle}\` · **Modus:** ${r.modus}${r.projekteLauf ? jahrgangText(r.jahre) : ''}`,
    ``,
    // Bei einem reinen Adressen-Nachtrag stuenden hier lauter Nullen und ein leerer
    // Summenabgleich — das saehe aus wie ein misslungener Projekt-Import.
    ...(!r.projekteLauf ? [] : [
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
    ]),
    ...(r.adressen === null ? [] : adressenAbschnitt(r.adressen)),
    `## Rechnungszaehler`,
    ``,
    r.zaehler.gesetztAuf === null
      ? `Nicht gesetzt. ${r.zaehler.hinweis ?? ''}`.trim()
      : `Gesetzt auf **${r.zaehler.gesetztAuf}**.`,
    ``,
    zaehlerStandZeile(r.zaehler),
    ``,
    // Zuerst das, was jemanden braucht (unbekanntes Konto, uebersprungenes Projekt,
    // unlesbarer Betrag, doppelte Projekt_Nr. ...), erst danach die reinen Befunde.
    // Umgekehrt stand der Operator vor einer Wand von Kontaktnamen, bevor er die
    // Kontonummern sah, die tatsaechlich zu klaeren sind.
    `## Warnungen (${r.warnungen.length})`,
    ``,
    ...(r.warnungen.length === 0 ? ['Keine.'] : r.warnungen.map((w) => `- ${w}`)),
    ``,
    `## Datenbefunde (${r.datenbefunde.length})`,
    ``,
    `Festgehalten, aber ohne Handlungsbedarf — es geht nichts verloren.`,
    ``,
    ...(r.datenbefunde.length === 0 ? ['Keine.'] : r.datenbefunde.map((d) => `- ${d}`)),
    ``,
    ...(r.hinweise.length === 0 ? [] : [`## Hinweise zum Lauf`, ``, ...r.hinweise.map((h) => `- ${h}`), ``]),
  ].join('\n');
}

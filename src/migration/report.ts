export type SummenVergleich = { csv: number; db: number | null; differenz: number | null; ok: boolean };

export type ImportReport = {
  quelle: string;
  modus: 'dry-run' | 'apply';
  jahr: number | null;
  auftraggeber: { gelesen: number; neu: number; aktualisiert: number; ohneAdresse: number };
  projekte: { gelesen: number; neu: number; aktualisiert: number; uebersprungen: number };
  konten: { angelegt: number; vorhanden: number };
  mwstSaetze: { angelegt: number; vorhanden: number };
  zaehler: { gesetztAuf: number | null; hinweis: string | null };
  summen: { budgetChf: SummenVergleich; offenProv: SummenVergleich; abgerechnet: SummenVergleich };
  warnungen: string[];
};

export function vergleiche(csv: number, db: number | null): SummenVergleich {
  if (db === null) return { csv, db: null, differenz: null, ok: true };
  const differenz = Math.round((db - csv) * 100) / 100;
  return { csv, db, differenz, ok: Math.abs(differenz) <= 0.01 };
}

const chf = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatReport(r: ImportReport): string {
  const zeile = (name: string, v: SummenVergleich) =>
    `| ${name} | ${chf(v.csv)} | ${chf(v.db)} | ${v.differenz === null ? '—' : chf(v.differenz)} | ${v.ok ? 'ok' : '**ABWEICHUNG**'} |`;
  return [
    `# Migrations-Report`,
    ``,
    `**Quelle:** \`${r.quelle}\` · **Modus:** ${r.modus}${r.jahr === null ? '' : ` · **Jahr:** ${r.jahr}`}`,
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
  ].join('\n');
}

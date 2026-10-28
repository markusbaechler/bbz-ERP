import type { FmInventar } from './typen';
import type { Analyse } from './analyse';
import { ERP_ABDECKUNG } from './analyse';

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown-Bericht "Funktionsumfang FileMaker" inkl. Abdeckungsmatrix. Kontennamen nur mit Opt-in (Personendaten). */
export function berichtMarkdown(inv: FmInventar, a: Analyse, opts: { mitKonten?: boolean; titel?: string; quelle?: string } = {}): string {
  const k = a.kennzahlen;
  const z: string[] = [];
  z.push(`# ${opts.titel ?? 'Funktionsumfang der FileMaker-Loesung'}`, '');
  z.push(`Quelle: ${opts.quelle ?? 'Datenbank-Designreport'} · Format ${inv.format}${inv.version ? ` · FileMaker ${inv.version}` : ''} · erzeugt mit \`tools/fm-analyse\``, '');
  if (inv.format === 'DataAPI') {
    z.push('> **Quelle Data API:** Tabellen sind Tabellenvorkommen und nur sichtbar, soweit sie auf einem Layout liegen. Script-Schritte, Formeln,',
      '> Beziehungsschluessel und Konten liefert nur der Designreport (DDR). Datensatzinhalte wurden nicht uebernommen.', '');
  }
  if (inv.format === 'ScriptDruck') {
    z.push('> **Quelle Script-Ausdruck (ohne Vollzugriff):** Scripts und Schritte wie im DDR, soweit das Konto sie ansehen darf. Je Datei',
      '> eine Tabelle mit dem Namen der Datei [Hypothese]; Felder nur, soweit Scripts sie nennen. Formeln, Beziehungen, Wertelisten',
      '> und Konten fehlen; dafuer braucht es den DDR mit [Vollzugriff]. Kommentare und Kontonamen wurden nicht uebernommen.', '');
  }
  z.push('## 1. Kennzahlen', '');
  z.push('| Dateien | Tabellen | Felder | davon berechnet | Datensaetze | Tabellenvorkommen | Beziehungen | Layouts | Scripts | Script-Schritte | Wertelisten | Eigene Funktionen | Konten |');
  z.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  z.push(`| ${k.dateien} | ${k.tabellen} | ${k.felder} | ${k.berechneteFelder} | ${k.datensaetze} | ${k.tabellenvorkommen} | ${k.beziehungen} | ${k.layouts} | ${k.scripts} | ${k.scriptSchritte} | ${k.wertelisten} | ${k.eigeneFunktionen} | ${k.konten} |`, '');

  z.push('## 2. Dateien und Querverweise', '');
  for (const d of inv.dateien) {
    const refs = d.dateiReferenzen.map((r) => r.name).join(', ') || '–';
    const gesperrt = d.gesperrteScripts ? ` (+ ${d.gesperrteScripts} Scripts ohne Leserecht)` : '';
    z.push(`- **${esc(d.name)}**: ${d.tabellen.length} Tabellen, ${d.layouts.length} Layouts, ${d.scripts.length} Scripts${gesperrt}; Dateiverweise: ${esc(refs)}; Berechtigungssaetze: ${esc(d.berechtigungssaetze.join(', ') || '–')}`);
  }
  z.push('');

  z.push('## 3. Datenmodell und Zuordnung zum ERP', '');
  z.push('| Datei | Tabelle | Datensaetze | Felder (berechnet/Statistik) | ERP-Modul | Zieltabelle | Feld-Mapping (exakt/Synonym/offen) |');
  z.push('|---|---|---|---|---|---|---|');
  for (const t of a.tabellen) {
    const ex = t.feldMapping.filter((f) => f.sicherheit === 'exakt').length;
    const sy = t.feldMapping.filter((f) => f.sicherheit === 'synonym').length;
    const of = t.feldMapping.filter((f) => f.sicherheit === 'keine').length;
    z.push(`| ${esc(t.datei)} | ${esc(t.tabelle)} | ${t.datensaetze ?? '?'} | ${t.felder} (${t.berechnet}/${t.statistik}) | ${t.modul ?? '⚠ offen'} | ${t.zielTabelle ?? '–'}${t.zielTabelle && !t.zielExistiert ? ' ⚠' : ''} | ${t.feldMapping.length ? `${ex}/${sy}/${of}` : '–'} |`);
  }
  z.push('');

  const serien = inv.dateien.flatMap((d) => d.tabellen.flatMap((t) => t.felder.filter((f) => f.naechsterSerienwert !== null)
    .map((f) => `- ${esc(d.name)}::${esc(t.name)}::${esc(f.name)} – naechster Wert **${f.naechsterSerienwert}**`)));
  if (serien.length) {
    z.push('### Zaehlerstaende (Seriennummern)', '', 'Fuer die Migration: der naechste Wert der Rechnungsnummer ist der `--zaehler-start` von `npm run fm:import`.', '', ...serien, '');
  }

  z.push('## 4. Beziehungen', '');
  for (const d of inv.dateien) for (const b of d.beziehungen) {
    const bed = b.bedingungen.map((x) => `${x.links} ${x.typ === 'Equal' ? '=' : x.typ} ${x.rechts}`).join(' UND ') || 'auf Layout verwendet, Schluessel nur im DDR';
    z.push(`- ${esc(d.name)}: **${esc(b.links)} → ${esc(b.rechts)}** (${esc(bed)})${b.kaskadeLoeschenRechts ? ' · loescht kaskadierend' : ''}${b.kaskadeErstellenRechts ? ' · erstellt Bezugsdatensaetze' : ''}`);
  }
  z.push('');

  z.push('## 5. Funktionsumfang aus Scripts', '');
  z.push('| Funktion | Scripts | Ablösung im ERP |');
  z.push('|---|---|---|');
  for (const f of a.funktionen) {
    const bsp = f.scripts.slice(0, 6).map(esc).join('<br>') + (f.scripts.length > 6 ? `<br>… (+${f.scripts.length - 6})` : '');
    z.push(`| **${f.funktion}** (${f.scripts.length}) | ${bsp} | ${ERP_ABDECKUNG[f.funktion] ?? '⚠ keine Entsprechung'} |`);
  }
  z.push('');
  z.push('### Scripts je Geschaeftsbereich', '');
  for (const g of a.scriptsJeModul) z.push(`- **${g.modul}** (${g.scripts.length}): ${g.scripts.slice(0, 12).map(esc).join(', ')}${g.scripts.length > 12 ? ' …' : ''}`);
  z.push('');
  z.push('### Groesste Scripts (Komplexitaets-Hotspots)', '');
  for (const h of a.hotspots) z.push(`- ${esc(h.datei)}: ${esc(h.script)} – ${h.schritte} Schritte`);
  z.push('');

  z.push('## 6. Layouts (Benutzeroberflaeche)', '');
  for (const d of inv.dateien) {
    const gruppen = new Map<string, string[]>();
    for (const l of d.layouts) { const g = l.ordner.join(' / ') || '(ohne Ordner)'; gruppen.set(g, [...(gruppen.get(g) ?? []), `${l.name}${l.tabelle ? ` [${l.tabelle}]` : ''}`]); }
    for (const [g, ls] of gruppen) z.push(`- ${esc(d.name)} · ${esc(g)}: ${ls.map(esc).join(', ')}`);
  }
  z.push('');

  z.push('## 7. Wertelisten und eigene Funktionen', '');
  for (const d of inv.dateien) for (const v of d.wertelisten) {
    z.push(`- Werteliste **${esc(v.name)}** (${esc(v.quelle)}): ${v.werte.length ? esc(v.werte.slice(0, 15).join(', ')) : esc(v.feld ?? '–')}`);
  }
  for (const d of inv.dateien) for (const f of d.eigeneFunktionen) z.push(`- Funktion **${esc(f.name)}**(${esc(f.parameter.join('; '))})`);
  z.push('');

  z.push('## 8. Zugriff', '');
  for (const d of inv.dateien) {
    const proSatz = new Map<string, number>();
    for (const kto of d.konten) proSatz.set(kto.berechtigung, (proSatz.get(kto.berechtigung) ?? 0) + 1);
    z.push(`- ${esc(d.name)}: ${d.konten.length} Konten (${[...proSatz].map(([s, n]) => `${esc(s)}: ${n}`).join(', ') || '–'}); erweiterte Rechte: ${esc(d.erweiterteBerechtigungen.join(', ') || '–')}`);
    if (opts.mitKonten) for (const kto of d.konten) z.push(`  - ${esc(kto.name)} (${esc(kto.berechtigung)}, ${kto.aktiv ? 'aktiv' : 'inaktiv'})`);
  }
  z.push('');

  z.push('## 9. Luecken / zu klaeren', '');
  if (!a.luecken.length) z.push('Keine – alle Tabellen und Script-Funktionen haben eine ERP-Entsprechung.');
  for (const l of a.luecken) z.push(`- ⚠ ${esc(l)}`);
  z.push('');
  return z.join('\n');
}

/** Mapping-Entwurf fuer die Datenmigration (tools/fm-import): je FM-Tabelle die vorgeschlagenen Spalten. */
export function mappingEntwurf(a: Analyse): Record<string, { zielTabelle: string; felder: Record<string, string | null> }> {
  const out: Record<string, { zielTabelle: string; felder: Record<string, string | null> }> = {};
  for (const t of a.tabellen) {
    if (!t.zielTabelle || !t.zielExistiert) continue;
    out[`${t.datei}::${t.tabelle}`] = {
      zielTabelle: t.zielTabelle,
      felder: Object.fromEntries(t.feldMapping.map((f) => [f.fmFeld, f.erpSpalte])),
    };
  }
  return out;
}

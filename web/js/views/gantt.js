// Gantt als Inline-SVG aus GET /projekt/:id/gantt: Phasen (Balken), Aufgaben (Balken nach Status, Abhaengigkeitspfeile),
// Meilensteine (Rauten), Einsaetze (Punkte), Monats-/Wochenraster und Heute-Linie. Alle Texte laufen durchs html-Tag.
import { html, datum, label, tageZwischen, addTage, wochentag, MONATE, leerHinweis, tabelle } from '../ui.js';

const LABEL_W = 230;
const ZEILE = 26;
const KOPF = 36;

const kurz = (t, n = 32) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const typLabel = { phase: 'Phase', aufgabe: 'Aufgabe', meilenstein: 'Meilenstein', einsatz: 'Einsatz' };

/** Zeilen hierarchisch: je Phase die Phase, dann ihre Aufgaben/Meilensteine; danach Rest; Einsaetze am Ende. */
function ordne(items) {
  const phasen = items.filter((i) => i.typ === 'phase');
  const rest = items.filter((i) => i.typ !== 'phase');
  const zeilen = [];
  for (const p of phasen) {
    zeilen.push({ ...p, ebene: 0 });
    for (const i of rest.filter((r) => r.phaseId === p.id && r.typ !== 'einsatz')) zeilen.push({ ...i, ebene: 1 });
  }
  const ohnePhase = rest.filter((r) => r.typ !== 'einsatz' && !phasen.some((p) => p.id === r.phaseId));
  for (const i of ohnePhase) zeilen.push({ ...i, ebene: 0 });
  for (const e of rest.filter((r) => r.typ === 'einsatz')) zeilen.push({ ...e, ebene: 0 });
  return zeilen;
}

export function gantt(g, { heute, breite = 1150 } = {}) {
  const geplant = g.items.filter((i) => i.start);
  const ungeplant = g.items.filter((i) => !i.start);
  if (!geplant.length) return { svg: leerHinweis('Noch keine terminierten Phasen, Aufgaben oder Meilensteine.'), ungeplant, tabelle: '' };
  let von = g.start ?? geplant[0].start;
  let bis = g.ende ?? geplant[0].ende ?? von;
  if (heute && heute >= addTage(von, -45) && heute < von) von = heute;
  if (heute && heute <= addTage(bis, 45) && heute > bis) bis = heute;
  von = addTage(von, -3);
  bis = addTage(bis, 3);
  const tage = tageZwischen(von, bis) + 1;
  const px = Math.max(3, Math.min(28, (breite - LABEL_W - 16) / tage));
  const zeilen = ordne(geplant);
  const W = Math.round(LABEL_W + tage * px + 16);
  const H = KOPF + zeilen.length * ZEILE + 8;
  const x = (iso) => LABEL_W + tageZwischen(von, iso) * px;
  const y = (i) => KOPF + i * ZEILE;
  const pos = new Map(zeilen.map((z, i) => [z.id, i]));

  // Raster: Monatsanfaenge (Label) und Montage (fein)
  const raster = [];
  const monate = [];
  for (let t = 0; t < tage; t += 1) {
    const d = addTage(von, t);
    const xd = LABEL_W + t * px;
    const monatsanfang = d.slice(8) === '01';
    // Erstes Label nur, wenn bis zum naechsten Monatsanfang genug Platz bleibt (sonst ueberlappen die Texte)
    const randLabel = t === 0 && !monatsanfang && (32 - Number(d.slice(8))) * px > 64;
    if (monatsanfang || randLabel) {
      monate.push(html`<line class="grid-month" x1="${xd}" y1="${KOPF - 14}" x2="${xd}" y2="${H}"/><text class="axis" x="${xd + 4}" y="${KOPF - 18}">${MONATE[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}</text>`);
    } else if (wochentag(d) === 1 && px >= 5) {
      raster.push(html`<line class="grid" x1="${xd}" y1="${KOPF - 6}" x2="${xd}" y2="${H}"/>`);
      if (px >= 12) raster.push(html`<text class="axis" x="${xd + 2}" y="${KOPF - 4}">${Number(d.slice(8))}.</text>`);
    }
  }

  const hintergrund = zeilen.map((_, i) => (i % 2 ? html`<rect class="row-alt" x="0" y="${y(i)}" width="${W}" height="${ZEILE}"/>` : ''));
  const beschriftung = zeilen.map((z, i) => html`<text class="${z.typ === 'phase' ? 'lbl-phase' : 'lbl'}" x="${10 + z.ebene * 14}" y="${y(i) + 17}">${kurz(z.titel, z.ebene ? 30 : 33)}<title>${typLabel[z.typ]}: ${z.titel}</title></text>`);

  const formen = zeilen.map((z, i) => {
    const ende = z.ende && z.ende >= z.start ? z.ende : z.start;
    const x1 = x(z.start);
    const w = Math.max(px, (tageZwischen(z.start, ende) + 1) * px);
    const tip = `${typLabel[z.typ]}: ${z.titel} · ${datum(z.start)}${ende !== z.start ? ` – ${datum(ende)}` : ''} · ${statusText(z)}`;
    if (z.typ === 'phase') return html`<rect class="bar-phase" x="${x1}" y="${y(i) + 6}" width="${w}" height="14" rx="3"><title>${tip}</title></rect>`;
    if (z.typ === 'aufgabe') return html`<rect class="bar-task st-${z.status}" x="${x1}" y="${y(i) + 8}" width="${w}" height="10" rx="2"><title>${tip}</title></rect>`;
    if (z.typ === 'meilenstein') {
      const cx = x1 + px / 2; const cy = y(i) + 13; const r = 7;
      return html`<polygon class="ms st-${z.status}" points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}"><title>${tip}</title></polygon>`;
    }
    return html`<circle class="einsatz" cx="${x1 + px / 2}" cy="${y(i) + 13}" r="5"><title>${tip}</title></circle>`;
  });

  // Abhaengigkeiten: Ende Vorgaenger -> Start Nachfolger (orthogonal, Pfeilspitze)
  const pfeile = zeilen.filter((z) => z.typ === 'aufgabe' && z.vorgaengerId && pos.has(z.vorgaengerId)).map((z) => {
    const v = zeilen[pos.get(z.vorgaengerId)];
    const vEnde = v.ende && v.ende >= v.start ? v.ende : v.start;
    const x1 = x(vEnde) + px; const y1 = y(pos.get(v.id)) + 13;
    const x2 = x(z.start); const y2 = y(pos.get(z.id)) + 13;
    const mx = x1 + 6;
    const d = x2 - 8 >= mx ? `M${x1},${y1} H${mx} V${y2} H${x2 - 1}` : `M${x1},${y1} H${mx} V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2 - 1}`;
    return html`<path class="dep" d="${d}" marker-end="url(#pfeil)"><title>${v.titel} → ${z.titel}</title></path>`;
  });

  const heuteLinie = heute && heute >= von && heute <= bis
    ? html`<line class="today" x1="${x(heute) + px / 2}" y1="${KOPF - 14}" x2="${x(heute) + px / 2}" y2="${H}"/><text class="today-lbl" x="${x(heute) + px / 2 + 3}" y="${H - 4}">Heute</text>`
    : '';

  const svg = html`<svg class="bbz-gantt" data-testid="gantt-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="gantt-t gantt-d" xmlns="http://www.w3.org/2000/svg">
    <title id="gantt-t">Gantt-Diagramm</title><desc id="gantt-d">${zeilen.length} Einträge von ${datum(von)} bis ${datum(bis)}; Details in der Tabelle unter dem Diagramm.</desc>
    <defs><marker id="pfeil" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
    ${hintergrund}${raster}${monate}
    <line class="grid-month" x1="${LABEL_W}" y1="${KOPF - 2}" x2="${W}" y2="${KOPF - 2}"/>
    ${beschriftung}${pfeile}${formen}${heuteLinie}</svg>`;

  const namen = new Map(g.items.map((i) => [i.id, i.titel]));
  const tab = tabelle({
    zeilen: [...zeilen, ...ungeplant], beschriftung: 'Gantt-Einträge als Tabelle',
    spalten: [
      { titel: 'Typ', wert: (z) => typLabel[z.typ] },
      { titel: 'Titel', wert: (z) => z.titel },
      { titel: 'Start', klasse: 'nowrap', wert: (z) => datum(z.start) },
      { titel: 'Ende', klasse: 'nowrap', wert: (z) => datum(z.ende) },
      { titel: 'Status', wert: (z) => statusText(z) },
      { titel: 'Vorgänger', wert: (z) => (z.vorgaengerId ? namen.get(z.vorgaengerId) ?? '–' : '–') },
    ],
  });
  return { svg, ungeplant, tabelle: tab };
}

function statusText(z) {
  if (z.typ === 'aufgabe') return label('aufgabeStatus', z.status);
  if (z.typ === 'phase') return label('phaseStatus', z.status);
  if (z.typ === 'einsatz') return label('einsatzStatus', z.status);
  return { erreicht: 'erreicht', ueberfaellig: 'überfällig', offen: 'offen' }[z.status] ?? z.status;
}

export const ganttLegende = () => html`<div class="bbz-legend" aria-hidden="true">
  <span><i class="lg-phase"></i>Phase</span><span><i class="lg-task"></i>Aufgabe offen</span><span><i class="lg-arbeit"></i>in Arbeit</span>
  <span><i class="lg-review"></i>Review</span><span><i class="lg-erledigt"></i>erledigt</span><span>◆ Meilenstein (grün erreicht, rot überfällig)</span>
  <span>● Einsatz</span><span>→ Abhängigkeit</span><span class="bbz-danger">┆ Heute</span></div>`;

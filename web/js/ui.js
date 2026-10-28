// UI-Bausteine: Escaping, Formatierung, Begriffe (je EINE Quelle), Tabellen/Karten, Modal, Formulare, Toast.
// Escaping-Disziplin: HTML entsteht nur ueber das Tag `html` – jede Interpolation wird escaped,
// ausser sie ist selbst ein `html`-Ergebnis (Safe). `raw()` nur fuer statische, eigene Strings.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v)).replace(/[&<>"'`]/g, (c) => ESC[c]);

export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const wert = (v) => (v === null || v === undefined || v === false ? ''
  : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(wert).join('') : esc(v));
export function html(strings, ...werte) {
  let out = strings[0];
  for (let i = 0; i < werte.length; i += 1) out += wert(werte[i]) + strings[i + 1];
  return new Safe(out);
}
export const setHtml = (el, inhalt) => { el.innerHTML = wert(inhalt); };
export const join = (teile, trenner = ' · ') => {
  const da = teile.filter((t) => t !== null && t !== undefined && t !== '' && t !== false);
  return html`${da.map((t, i) => (i ? html`${trenner}${t}` : t))}`;
};

/** Nur http(s)/mailto/tel als Link-Ziel zulassen (Website-Felder aus Fremdquellen). */
export function sichereUrl(u) {
  const s = String(u ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

/* ---------- Formatierung (de-CH) ---------- */
const nf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const leer = (n) => n === null || n === undefined || n === '' || Number.isNaN(Number(n));
export const chf = (n) => (leer(n) ? '–' : `CHF ${nf2.format(Number(n))}`);
export const betrag = (n) => (leer(n) ? '–' : nf2.format(Number(n)));
export const chfKurz = (n) => (leer(n) ? '–' : `CHF ${nf0.format(Number(n))}`);
export const zahl = (n, stellen = 1) => (leer(n) ? '–' : (stellen === 0 ? nf0 : stellen === 2 ? nf2 : nf1).format(Number(n)));
export const prozent = (n) => (leer(n) ? '–' : `${nf1.format(Number(n))} %`);
export const stunden = (n) => (leer(n) ? '–' : `${nf2.format(Number(n))} h`);

const tz = 'Europe/Zurich';
export function heute() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
/** 'YYYY-MM-DD' -> 'TT.MM.JJJJ'; ISO-Zeitpunkte werden in Zuerich-Ortszeit umgerechnet. */
export function datum(v) {
  if (!v) return '–';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('de-CH', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
export function datumZeit(v) {
  if (!v) return '–';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('de-CH', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
/** Zeitpunkt -> Kalendertag in Zuerich (YYYY-MM-DD). */
export function tagVon(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
}
const utc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const isoAus = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addTage = (iso, n) => isoAus(utc(iso) + n * 86400000);
export const tageZwischen = (von, bis) => Math.round((utc(bis) - utc(von)) / 86400000);
export const wochentag = (iso) => new Date(utc(iso)).getUTCDay();
export const montag = (iso) => addTage(iso, -((wochentag(iso) + 6) % 7));
export const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monatLabel = (ym) => `${MONATE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export function relativTage(iso) {
  if (!iso) return '';
  const t = tageZwischen(heute(), iso);
  if (t === 0) return 'heute';
  if (t === 1) return 'morgen';
  if (t === -1) return 'gestern';
  return t > 0 ? `in ${t} Tagen` : `vor ${-t} Tagen`;
}
export const personName = (p) => (p ? [p.vorname, p.nachname].filter(Boolean).join(' ') : '');

/* ---------- Begriffe: je EINE Quelle ---------- */
export const LABEL = {
  projektStatus: { akquise: 'Akquise', offeriert: 'Offeriert', laufend: 'Laufend', abgeschlossen: 'Abgeschlossen', abgesagt: 'Abgesagt', archiviert: 'Archiviert' },
  aufgabeStatus: { offen: 'Offen', in_arbeit: 'In Arbeit', review: 'Review', erledigt: 'Erledigt', abgebrochen: 'Abgebrochen' },
  prioritaet: { tief: 'Tief', normal: 'Normal', hoch: 'Hoch', kritisch: 'Kritisch' },
  vkPhase: { lead: 'Lead', qualifiziert: 'Qualifiziert', offeriert: 'Offeriert', verhandlung: 'Verhandlung', gewonnen: 'Gewonnen', verloren: 'Verloren' },
  kategorie: { kunde: 'Kunde', interessent: 'Interessent', partner: 'Partner', lieferant: 'Lieferant', uebrige: 'Übrige' },
  klassifizierung: { A: 'A-Kunde', B: 'B-Kunde', C: 'C-Kunde', akquisition: 'Akquisition' },
  aktivitaetTyp: { telefon: 'Telefon', meeting: 'Meeting', email: 'E-Mail', besuch: 'Besuch', event: 'Event', notiz: 'Notiz', offerte: 'Offerte', brief: 'Brief' },
  interesse: { nachwuchs: 'Nachwuchs', tailormade: 'Tailor-made', weiterbildung: 'Weiterbildung', zertifizierung: 'Zertifizierung', beratung: 'Beratung' },
  anfrageStatus: { neu: 'Neu', in_bearbeitung: 'In Bearbeitung', uebernommen: 'Übernommen', verworfen: 'Verworfen' },
  anfrageTyp: { kontakt: 'Kontakt', offerte: 'Offerte', tailormade: 'Tailor-made', newsletter: 'Newsletter', rueckruf: 'Rückruf' },
  anfrageQuelle: { homepage: 'Homepage', email: 'E-Mail', telefon: 'Telefon', event: 'Event', import: 'Import' },
  durchfuehrungStatus: { geplant: 'Geplant', ausgeschrieben: 'Ausgeschrieben', bestaetigt: 'Bestätigt', durchgefuehrt: 'Durchgeführt', abgesagt: 'Abgesagt' },
  anmeldeStatus: { angemeldet: 'Angemeldet', bestaetigt: 'Bestätigt', warteliste: 'Warteliste', storniert: 'Storniert', teilgenommen: 'Teilgenommen', abgeschlossen: 'Abgeschlossen', nicht_bestanden: 'Nicht bestanden' },
  rechnungStatus: { offen_prov: 'Entwurf (prov.)', def_vereinbart: 'Entwurf (def. vereinbart)', abgerechnet: 'Festgeschrieben, offen', bezahlt: 'Bezahlt', storniert: 'Storniert' },
  einsatzStatus: { angefragt: 'Angefragt', bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt', durchgefuehrt: 'Durchgeführt' },
  phaseStatus: { geplant: 'Geplant', aktiv: 'Aktiv', abgeschlossen: 'Abgeschlossen' },
  kursFormat: { praesenz: 'Präsenz', blended: 'Blended', online: 'Online', e_learning: 'E-Learning' },
  saqStatus: { angemeldet: 'Angemeldet', in_pruefung: 'In Prüfung', schriftlich_bestanden: 'Schriftlich bestanden', bestanden: 'Bestanden', zertifiziert: 'Zertifiziert', nicht_bestanden: 'Nicht bestanden', abgebrochen: 'Abgebrochen' },
  saqVariante: { erstzertifizierung: 'Erstzertifizierung', passerelle: 'Passerelle', teilpruefung: 'Teilprüfung', wiederholung: 'Wiederholung' },
  saqUmfang: { selbststudium: 'Selbststudium', schriftlich: 'Schriftlich', muendlich: 'Mündlich', gesamtpaket: 'Gesamtpaket' },
  outboxStatus: { offen: 'Offen', in_arbeit: 'In Arbeit', erledigt: 'Erledigt', fehler: 'Fehler', tot: 'Tot' },
  zertStatus: { aktiv: 'Aktiv', abgelaufen: 'Abgelaufen', entzogen: 'Entzogen' },
  ampel: { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' },
};
export const label = (gruppe, w) => (w === null || w === undefined || w === '' ? '–' : LABEL[gruppe]?.[w] ?? String(w));
export const optionenAus = (gruppe) => Object.entries(LABEL[gruppe]);

const FARBE = {
  projektStatus: { akquise: 'grey', offeriert: 'amber', laufend: 'blue', abgeschlossen: 'green', abgesagt: 'red', archiviert: 'grey' },
  aufgabeStatus: { offen: 'grey', in_arbeit: 'blue', review: 'amber', erledigt: 'green', abgebrochen: 'grey' },
  prioritaet: { tief: 'grey', normal: '', hoch: 'amber', kritisch: 'red' },
  vkPhase: { gewonnen: 'green', verloren: 'grey', verhandlung: 'amber' },
  anfrageStatus: { neu: 'red', in_bearbeitung: 'amber', uebernommen: 'green', verworfen: 'grey' },
  durchfuehrungStatus: { geplant: 'grey', ausgeschrieben: 'blue', bestaetigt: 'green', durchgefuehrt: 'grey', abgesagt: 'red' },
  anmeldeStatus: { angemeldet: 'blue', bestaetigt: 'green', warteliste: 'amber', storniert: 'grey', teilgenommen: 'green', abgeschlossen: 'green', nicht_bestanden: 'red' },
  rechnungStatus: { offen_prov: 'grey', def_vereinbart: 'grey', abgerechnet: 'amber', bezahlt: 'green', storniert: 'red' },
  einsatzStatus: { angefragt: 'amber', bestaetigt: 'green', abgesagt: 'grey', durchgefuehrt: 'blue' },
  phaseStatus: { geplant: 'grey', aktiv: 'blue', abgeschlossen: 'green' },
  saqStatus: { angemeldet: 'grey', in_pruefung: 'blue', schriftlich_bestanden: 'blue', bestanden: 'green', zertifiziert: 'green', nicht_bestanden: 'red', abgebrochen: 'grey' },
  outboxStatus: { offen: 'grey', in_arbeit: 'blue', erledigt: 'green', fehler: 'amber', tot: 'red' },
  zertStatus: { aktiv: 'green', abgelaufen: 'red', entzogen: 'grey' },
};
export function chip(text, farbe = '') { return html`<span class="bbz-chip ${farbe ? `bbz-chip-${farbe}` : ''}">${text}</span>`; }
export function statusChip(gruppe, w) { return chip(label(gruppe, w), FARBE[gruppe]?.[w] ?? ''); }
export function ampel(a) { return a ? html`<span class="bbz-ampel bbz-ampel-${a}">${label('ampel', a)}</span>` : '–'; }
export function klassPill(k) {
  if (!k) return '';
  const cls = { A: 'bbz-pill-a', B: 'bbz-pill-b', C: 'bbz-pill-c', akquisition: 'bbz-pill-akq' }[k] ?? '';
  return html`<span class="bbz-pill ${cls}">${label('klassifizierung', k)}</span>`;
}
export const anzahl = (n) => html`<span class="bbz-count">${n}</span>`;

/* ---------- Layout-Bausteine ---------- */
export function seitenkopf({ titel, untertitel, krumen, aktionen }) {
  return html`<div class="bbz-page-head"><div>
    ${krumen ? html`<nav class="bbz-breadcrumb" aria-label="Pfad">${krumen}</nav>` : ''}
    <h1 class="bbz-page-title" tabindex="-1">${titel}</h1>
    ${untertitel ? html`<div class="bbz-page-sub">${untertitel}</div>` : ''}
  </div>${aktionen ? html`<div class="bbz-page-actions">${aktionen}</div>` : ''}</div>`;
}
export function tabs(eintraege, aria = 'Bereiche') {
  return html`<nav class="bbz-tabs" aria-label="${aria}">${eintraege.filter(Boolean).map((t) => html`<a class="bbz-tab" href="${t.href}" ${t.aktiv ? raw('aria-current="page"') : ''}>${t.label}${t.anzahl !== undefined ? html` ${anzahl(t.anzahl)}` : ''}</a>`)}</nav>`;
}
export function sektion({ titel, untertitel, aktionen, inhalt, flush = false, id, testid }) {
  return html`<section class="bbz-section" ${id ? raw(`id="${esc(id)}"`) : ''} ${testid ? raw(`data-testid="${esc(testid)}"`) : ''}>
    ${titel ? html`<div class="bbz-section-header"><div><h2 class="bbz-section-title">${titel}</h2>${untertitel ? html`<div class="bbz-section-subtitle">${untertitel}</div>` : ''}</div>${aktionen ? html`<div class="bbz-section-actions">${aktionen}</div>` : ''}</div>` : ''}
    <div class="bbz-section-body ${flush ? 'flush' : ''}">${inhalt}</div></section>`;
}
export const leerHinweis = (text = 'Keine Einträge') => html`<div class="bbz-empty">${text}</div>`;
export const ladeanzeige = (text = 'Wird geladen …') => html`<div class="bbz-loading" role="status"><span class="bbz-loader" aria-hidden="true"></span>${text}</div>`;
export const banner = (text, typ = 'info') => html`<div class="bbz-banner bbz-banner-${typ}" ${typ === 'error' ? raw('role="alert"') : ''}>${text}</div>`;
export function modulFehlt(name) {
  return html`<section class="bbz-section" data-testid="modul-fehlt"><div class="bbz-panel-na">
    <h2>Modul noch nicht verfügbar</h2>
    <p>Das Modul «${name}» ist auf diesem Server noch nicht aktiviert. Sobald die Schnittstelle bereitsteht, erscheinen die Daten hier ohne weitere Anpassung.</p>
  </div></section>`;
}
export function kpi({ titel, zahl: z, sub, testid }) {
  return html`<div class="bbz-kpi" ${testid ? raw(`data-testid="${esc(testid)}"`) : ''}><div class="k-t">${titel}</div><div class="k-n">${z}</div>${sub ? html`<div class="k-s">${sub}</div>` : ''}</div>`;
}
export function balken(prozentWert, { variante, label: lbl } = {}) {
  const p = Math.max(0, Math.min(100, Number(prozentWert) || 0));
  const v = variante ?? (prozentWert > 100 ? 'red' : prozentWert > 85 ? 'amber' : '');
  return html`<div class="bbz-bar ${v ? `is-${v}` : ''}" role="img" aria-label="${lbl ?? `${zahl(prozentWert)} %`}"><span style="width:${p.toFixed(1)}%"></span></div>`;
}
export function belegung(b) {
  if (!b) return '–';
  const p = b.kapazitaet ? (b.aktiv / b.kapazitaet) * 100 : 0;
  const v = b.aktiv >= b.kapazitaet ? 'red' : p >= 75 ? 'amber' : 'green';
  return html`<div class="bbz-belegung">${balken(p, { variante: v, label: `Belegung ${b.aktiv} von ${b.kapazitaet}` })}<span class="t">${b.aktiv}/${b.kapazitaet}${b.warteliste ? html` · WL ${b.warteliste}` : ''}</span></div>`;
}

/**
 * Tabelle (Desktop) + Kartenliste (Mobile, <=640px). spalten: [{ titel, wert(z), klasse }].
 * href(z) macht Zeilen klickbar (die erste Zelle sollte zusaetzlich einen Link fuer Tastatur/Screenreader tragen).
 * karte(z) -> { titel, sub, rechts }; ohne karte wird sie aus den ersten Spalten abgeleitet.
 */
export function tabelle({ spalten, zeilen, href, karte, leer: leerText = 'Keine Einträge', fuss, testid, beschriftung }) {
  if (!zeilen.length) return leerHinweis(leerText);
  const hrefAttr = (z) => { const h = href?.(z); return h ? raw(`data-href="${esc(h)}"`) : ''; };
  const desktop = html`<div class="bbz-table-wrap bbz-desktop-only"><table class="bbz-table" ${testid ? raw(`data-testid="${esc(testid)}"`) : ''}>
    ${beschriftung ? html`<caption class="bbz-sr-only">${beschriftung}</caption>` : ''}
    <thead><tr>${spalten.map((s) => html`<th scope="col" class="${s.klasse ?? ''}">${s.titel}</th>`)}</tr></thead>
    <tbody>${zeilen.map((z) => html`<tr ${hrefAttr(z)}>${spalten.map((s) => html`<td class="${s.klasse ?? ''}">${s.wert(z)}</td>`)}</tr>`)}</tbody>
    ${fuss ? html`<tfoot>${fuss}</tfoot>` : ''}</table></div>`;
  const k = karte ?? ((z) => ({ titel: spalten[0].wert(z), sub: join(spalten.slice(1, 4).map((s) => s.wert(z))), rechts: spalten.length > 4 ? spalten[spalten.length - 1].wert(z) : '' }));
  const mobil = html`<div class="bbz-card-list bbz-mobile-only">${zeilen.map((z) => {
    const c = k(z);
    return html`<div class="bbz-list-card" ${hrefAttr(z)}><div class="bbz-list-card-body"><div class="bbz-list-card-title">${c.titel}</div>${c.sub ? html`<div class="bbz-list-card-sub">${c.sub}</div>` : ''}</div>${c.rechts ? html`<div class="bbz-list-card-right">${c.rechts}</div>` : ''}</div>`;
  })}</div>`;
  return html`${desktop}${mobil}`;
}

/* ---------- Formularfelder ---------- */
let feldNr = 0;
const attrs = (o = {}) => raw(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? esc(k) : `${esc(k)}="${esc(v)}"`)).join(' '));
const normOpt = (o) => (Array.isArray(o) ? { wert: o[0], label: o[1] } : typeof o === 'object' ? o : { wert: o, label: o });
export function optionen(liste, gewaehlt, leerOption) {
  const g = Array.isArray(gewaehlt) ? gewaehlt.map(String) : [gewaehlt === null || gewaehlt === undefined ? '' : String(gewaehlt)];
  return html`${leerOption !== undefined && leerOption !== false ? html`<option value="">${leerOption}</option>` : ''}${liste.map(normOpt).map((o) => html`<option value="${o.wert}" ${g.includes(String(o.wert)) ? raw('selected') : ''}>${o.label}</option>`)}`;
}
/**
 * Feld mit Label. typ: text|email|number|date|time|tel|url|password|textarea|select|checkbox|checkboxes|radio|hidden.
 * zahl-Felder (typ number) liefern in formWerte() Zahlen; checkboxes liefert eine Liste.
 */
export function feld({ name, label: lbl, typ = 'text', wert: w, pflicht = false, optionen: opts = [], leerOption, hint, span2 = false, attr = {}, id }) {
  const fid = id ?? `f-${name}-${(feldNr += 1)}`;
  const req = pflicht ? html` <span class="bbz-req" aria-hidden="true">*</span>` : '';
  const hintId = hint ? `${fid}-hint` : null;
  const hintHtml = hint ? html`<div class="bbz-field-hint" id="${hintId}">${hint}</div>` : '';
  const basis = { id: fid, name, required: pflicht, 'aria-describedby': hintId, ...attr };
  const wrap = (inner) => html`<div class="bbz-field ${span2 ? 'bbz-span-2' : ''}">${inner}${hintHtml}</div>`;
  if (typ === 'hidden') return html`<input type="hidden" name="${name}" value="${w ?? ''}">`;
  if (typ === 'checkbox') {
    return wrap(html`<label class="bbz-checkbox"><input type="checkbox" ${attrs(basis)} ${w ? raw('checked') : ''}> ${lbl}</label>`);
  }
  if (typ === 'checkboxes' || typ === 'radio') {
    const gew = (Array.isArray(w) ? w : [w]).map(String);
    const t = typ === 'radio' ? 'radio' : 'checkbox';
    return html`<fieldset class="bbz-field bbz-multi ${span2 ? 'bbz-span-2' : ''}" ${hintId ? raw(`aria-describedby="${esc(hintId)}"`) : ''}><legend class="bbz-field-label">${lbl}${req}</legend>
      ${opts.map(normOpt).map((o) => html`<label class="bbz-multi-item"><input type="${t}" name="${name}" value="${o.wert}" ${t === 'checkbox' ? raw('data-typ="liste"') : ''} ${gew.includes(String(o.wert)) ? raw('checked') : ''}> ${o.label}</label>`)}
      ${hintHtml}</fieldset>`;
  }
  const labelHtml = html`<label for="${fid}">${lbl}${req}</label>`;
  if (typ === 'textarea') return wrap(html`${labelHtml}<textarea class="bbz-textarea" ${attrs(basis)}>${w ?? ''}</textarea>`);
  if (typ === 'select') return wrap(html`${labelHtml}<select class="bbz-select" ${attrs(basis)}>${optionen(opts, w, leerOption)}</select>`);
  const extra = typ === 'number' ? { 'data-typ': 'zahl', step: attr.step ?? 'any', inputmode: 'decimal' } : {};
  return wrap(html`${labelHtml}<input class="bbz-input" type="${typ}" ${attrs({ ...basis, ...extra })} value="${w ?? ''}">`);
}
export const formGrid = (...felder) => html`<div class="bbz-form-grid">${felder}</div>`;

/** Formularwerte: Text getrimmt (leer -> null), number -> Zahl, Checkbox -> boolean, Checkbox-Gruppe -> Liste. */
export function formWerte(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox' && el.dataset.typ === 'liste') {
      out[el.name] ??= [];
      if (el.checked) out[el.name].push(el.value);
      continue;
    }
    if (el.type === 'checkbox') { out[el.name] = el.checked; continue; }
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = null; continue; }
    if (el.type === 'submit' || el.type === 'button') continue;
    const v = String(el.value ?? '').trim();
    if (el.dataset.typ === 'zahl') { out[el.name] = v === '' ? null : Number(v.replace(/[’']/g, '').replace(',', '.')); continue; }
    out[el.name] = v === '' ? null : v;
  }
  return out;
}
/** Entfernt null/undefined (fuer POST: Server-Defaults greifen). */
export const ohneLeere = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

/* ---------- Toast ---------- */
export function toast(text, typ = 'info', ms = 5000) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `bbz-toast bbz-toast-${typ}`;
  if (typ === 'error') t.setAttribute('role', 'alert');
  setHtml(t, html`<span>${text}</span><button type="button" aria-label="Meldung schliessen">×</button>`);
  t.querySelector('button').addEventListener('click', () => t.remove());
  box.appendChild(t);
  setTimeout(() => t.remove(), typ === 'error' ? Math.max(ms, 9000) : ms);
}

/* ---------- Modal ---------- */
const FOKUSSIERBAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Oeffnet einen Dialog. aktionen: { name: (el, ev, m) => ... } fuer Elemente mit data-maction. */
export function modal({ titel, inhalt, fuss, breit = false, aktionen = {}, onClose, testid }) {
  const root = document.getElementById('modal-root');
  const vorher = document.activeElement;
  const back = document.createElement('div');
  back.className = 'bbz-modal-backdrop';
  const tid = `mt-${(feldNr += 1)}`;
  setHtml(back, html`<div class="bbz-modal ${breit ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${tid}" ${testid ? raw(`data-testid="${esc(testid)}"`) : ''}>
    <div class="bbz-modal-header"><h2 class="bbz-modal-title" id="${tid}">${titel}</h2><button type="button" class="bbz-icon-btn" data-modal-close aria-label="Dialog schliessen">✕</button></div>
    <div class="bbz-modal-body">${inhalt}</div>${fuss ? html`<div class="bbz-modal-footer">${fuss}</div>` : ''}</div>`);
  root.appendChild(back);
  let offen = true;
  const m = {
    el: back.querySelector('.bbz-modal'),
    schliessen() {
      if (!offen) return;
      offen = false;
      back.remove();
      document.removeEventListener('keydown', taste, true);
      if (vorher && document.contains(vorher)) vorher.focus?.();
      onClose?.();
    },
  };
  function taste(e) {
    if (!document.contains(back) || root.lastElementChild !== back) return;
    if (e.key === 'Escape') { e.preventDefault(); m.schliessen(); }
    if (e.key === 'Tab') {
      const f = [...m.el.querySelectorAll(FOKUSSIERBAR)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  document.addEventListener('keydown', taste, true);
  back.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-close]')) { m.schliessen(); return; }
    const a = e.target.closest('[data-maction]');
    if (a && aktionen[a.dataset.maction]) aktionen[a.dataset.maction](a, e, m);
  });
  const erstes = m.el.querySelector('.bbz-modal-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .bbz-modal-body select, .bbz-modal-body textarea')
    ?? m.el.querySelector(FOKUSSIERBAR);
  setTimeout(() => erstes?.focus(), 0);
  return m;
}

/**
 * Formular im Dialog. onSubmit(werte, form) -> Ergebnis (Dialog schliesst, Promise liefert es) | false (bleibt offen).
 * Fehler aus onSubmit werden im Dialog angezeigt (kein zusaetzlicher Toast). Abbrechen -> null.
 */
export function formModal({ titel, felder, submitText = 'Speichern', breit, onSubmit, aktionen = {}, gefahr = false, testid, beimOeffnen }) {
  return new Promise((resolve) => {
    let ergebnis = null;
    const fid = `form-${(feldNr += 1)}`;
    const m = modal({
      titel, breit, testid, aktionen,
      inhalt: html`<form id="${fid}" novalidate>${felder}<div class="bbz-form-error" role="alert"></div></form>`,
      fuss: html`<button type="button" class="bbz-button" data-modal-close>Abbrechen</button><button type="submit" form="${fid}" class="bbz-button ${gefahr ? 'bbz-button-danger' : 'bbz-button-primary'}">${submitText}</button>`,
      onClose: () => resolve(ergebnis),
    });
    const form = m.el.querySelector('form');
    const fehlerBox = form.querySelector('.bbz-form-error');
    beimOeffnen?.(form, m);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fehlerBox.classList.remove('show');
      if (!form.reportValidity()) return;
      const knopf = m.el.querySelector('button[type=submit]');
      knopf.disabled = true;
      try {
        const { stumm } = await import('./api.js');
        const r = await stumm(() => onSubmit(formWerte(form), form, m));
        if (r !== false) { ergebnis = r ?? true; m.schliessen(); }
      } catch (err) {
        setHtml(fehlerBox, err?.message ?? 'Speichern fehlgeschlagen');
        fehlerBox.classList.add('show');
      } finally { knopf.disabled = false; }
    });
  });
}

export function bestaetigen(text, { titel = 'Bitte bestätigen', okText = 'OK', gefahr = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      titel, inhalt: html`<p class="bbz-m0">${text}</p>`,
      fuss: html`<button type="button" class="bbz-button" data-modal-close>Abbrechen</button><button type="button" class="bbz-button ${gefahr ? 'bbz-button-danger' : 'bbz-button-primary'}" data-maction="ok">${okText}</button>`,
      aktionen: { ok: (_el, _e, mm) => { ok = true; mm.schliessen(); } },
      onClose: () => resolve(ok),
    });
    setTimeout(() => m.el.querySelector('[data-maction=ok]')?.focus(), 0);
  });
}

/** Einzelner Wert per Dialog (z. B. Verlustgrund, Stornogrund). Liefert den Text oder null. */
export async function eingabe({ titel, label: lbl, pflicht = true, typ = 'text', wert: w, hint, submitText = 'OK' }) {
  const r = await formModal({ titel, submitText, felder: feld({ name: 'wert', label: lbl, typ, wert: w, pflicht, hint }), onSubmit: (v) => ({ wert: v.wert }) });
  return r ? r.wert : null;
}

/** Geheimnis einmalig anzeigen (API-Schluessel, Webhook-Secret) mit Kopierknopf. */
export function geheimnisAnzeigen({ titel, text, geheimnis }) {
  return new Promise((resolve) => {
    modal({
      titel, testid: 'geheimnis',
      inhalt: html`${banner(html`<strong>Nur jetzt sichtbar.</strong> ${text}`, 'warning')}<div class="bbz-secret"><code data-testid="geheimnis-wert">${geheimnis}</code><button type="button" class="bbz-button" data-maction="kopieren">Kopieren</button></div>`,
      fuss: html`<button type="button" class="bbz-button bbz-button-primary" data-modal-close>Ich habe den Wert gesichert</button>`,
      aktionen: {
        kopieren: async (el) => {
          try { await navigator.clipboard.writeText(geheimnis); el.textContent = 'Kopiert ✓'; }
          catch { const r = document.createRange(); r.selectNodeContents(el.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Bitte mit Ctrl+C kopieren', 'warning'); }
        },
      },
      onClose: resolve,
    });
  });
}

export function entprellen(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

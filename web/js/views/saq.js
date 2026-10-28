// SAQ-Zertifizierung (Spec §5.4b): Vorgaenge, Runs je Teilpruefung (WE1-WE6 / OE1-OE2 x RUN1-RUN3), Planung,
// Resultat, Arbeitgeberbestaetigung, Zertifikat, Kennzahlen. Fehlt die Route (Modul nicht ausgerollt) -> Hinweis-Panel.
import { get, post, istModulFehlt, herunterladen } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabs, sektion, tabelle, feld, formGrid, formModal, formWerte, ohneLeere, datum, zahl, prozent, label, optionenAus,
  statusChip, chip, banner, heute, toast, entprellen, setHtml, ladeanzeige, modulFehlt, personName, kpi,
} from '../ui.js';
import { personWahlFelder, personWahlVerdrahten, personAusWerten } from './teile.js';

const PROFILE = ['PK', 'IK', 'AFFL', 'CWMA', 'KMU', 'CCoB'];
const SPRACHEN = ['DE', 'FR', 'IT', 'EN'];
const saqTabs = (aktiv) => tabs([
  { href: '#/saq', label: 'Vorgänge', aktiv: aktiv === 'liste' },
  { href: '#/saq/kennzahlen', label: 'Kennzahlen', aktiv: aktiv === 'kennzahlen' },
], 'SAQ');
const teilCode = (art, teil) => `${art === 'muendlich' ? 'OE' : 'WE'}${teil}`;

/** Fuehrt fn aus; fehlt das Modul auf dem Server, wird das Hinweis-Panel gezeigt. */
async function mitModul(ctx, titel, aktiv, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!istModulFehlt(e)) throw e;
    ctx.zeige(html`${seitenkopf({ titel, untertitel: 'SAQ «Kundenberater Bank»: Prüfungsadministration' })}${saqTabs(aktiv)}${modulFehlt('SAQ-Zertifizierung')}`);
    return null;
  }
}

export async function liste(ctx) {
  const q = ctx.query;
  const erste = await mitModul(ctx, 'SAQ-Vorgänge', 'liste', () => get('/saq/fall', { limit: 1 }, { ruhig: true }));
  if (erste === null) return;
  ctx.zeige(html`
    ${seitenkopf({
      titel: 'SAQ-Vorgänge', untertitel: 'Zertifizierung «Kundenberater Bank»: je Person und Profil ein Vorgang',
      aktionen: html`${ctx.istAdmin ? html`<button type="button" class="bbz-button" data-action="kuba">KUBA-Export</button>` : ''}<button type="button" class="bbz-button bbz-button-primary" data-action="fall-neu">+ Vorgang</button>`,
    })}
    ${saqTabs('liste')}
    <form class="bbz-filterbar" data-form="filter" role="search" aria-label="SAQ-Vorgänge filtern">
      <div class="bbz-field bbz-search"><label for="saq-suche">Suche</label><input id="saq-suche" class="bbz-input" type="search" name="suche" value="${q.suche ?? ''}" placeholder="Name oder E-Mail …" data-input="suche"></div>
      ${feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('saqStatus'), wert: q.status, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'profil', label: 'Profil', typ: 'select', optionen: PROFILE, wert: q.profil, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'passiv', label: 'nur passive', typ: 'checkbox', wert: q.passiv === 'true', attr: { 'data-change': 'filter' } })}
    </form>
    <div id="saq-liste">${ladeanzeige()}</div>`);
  const form = ctx.el.querySelector('form[data-form=filter]');
  const ziel = ctx.el.querySelector('#saq-liste');
  const lade = async () => {
    const w = formWerte(form);
    const query = { ...w, passiv: w.passiv ? 'true' : undefined };
    ctx.setzeQuery(query);
    const liste = await get('/saq/fall', query);
    if (!ctx.aktiv()) return;
    setHtml(ziel, html`<section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'saq-tabelle', beschriftung: 'SAQ-Vorgänge', leer: 'Keine Vorgänge', href: (f) => `#/saq/fall/${f.id}`,
      spalten: [
        { titel: 'Person', wert: (f) => html`<a class="bbz-link" href="#/saq/fall/${f.id}">${personName(f.kontakt)}</a><div class="bbz-small bbz-muted">${f.kontakt?.email ?? ''}</div>` },
        { titel: 'Bank', wert: (f) => f.organisationName ?? '–' },
        { titel: 'Profil', wert: (f) => chip(f.profil, 'blue') },
        { titel: 'Variante', wert: (f) => label('saqVariante', f.variante) },
        { titel: 'Status', wert: (f) => html`${statusChip('saqStatus', f.status)}${f.passiv ? chip('passiv', 'amber') : ''}` },
        { titel: 'Letzte Prüfung', klasse: 'nowrap', wert: (f) => datum(f.letztePruefung) },
      ],
      karte: (f) => ({ titel: personName(f.kontakt), sub: [f.profil, label('saqStatus', f.status), f.organisationName].filter(Boolean).join(' · ') }),
    })}</section>`);
  };
  ctx.aenderung('filter', lade);
  ctx.eingabe('suche', entprellen(lade, 250));
  ctx.formular('filter', lade);
  ctx.aktion('kuba', () => herunterladen('/saq/export/kuba', { dateiname: `saq-kuba-${heute()}.json` }));
  ctx.aktion('fall-neu', async () => {
    const orgs = await store.organisationen();
    const r = await formModal({
      titel: 'SAQ-Vorgang erfassen', breit: true, testid: 'saq-form',
      felder: formGrid(
        personWahlFelder({ mitOrganisation: orgs, titel: 'Kandidat:in' }),
        feld({ name: 'organisationId', label: 'Arbeitgeber (Bank)', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), leerOption: '– keine –', span2: true }),
        feld({ name: 'profil', label: 'Profil', typ: 'select', optionen: PROFILE, pflicht: true, leerOption: '– wählen –' }),
        feld({ name: 'variante', label: 'Variante', typ: 'select', optionen: optionenAus('saqVariante'), wert: 'erstzertifizierung' }),
        feld({ name: 'umfang', label: 'Umfang', typ: 'select', optionen: optionenAus('saqUmfang'), wert: 'gesamtpaket' }),
        feld({ name: 'sprache', label: 'Sprache', typ: 'select', optionen: SPRACHEN, wert: 'DE' }),
        feld({ name: 'rolle', label: 'Funktion (SAQ-Rolle)' }),
        feld({ name: 'einwilligungRechnungBank', label: 'Rechnung an die Bank (Einwilligung)', typ: 'checkbox' }),
      ),
      beimOeffnen: (f) => personWahlVerdrahten(f),
      onSubmit: (w) => post('/saq/fall', ohneLeere({
        ...personAusWerten(w), organisationId: w.organisationId, profil: w.profil, variante: w.variante, umfang: w.umfang,
        sprache: w.sprache, rolle: w.rolle, einwilligungRechnungBank: w.einwilligungRechnungBank,
      })),
    });
    if (r?.id) { toast('SAQ-Vorgang erfasst', 'success'); ctx.navigiere(`/saq/fall/${r.id}`); }
  });
  await lade();
}

function runZelle(r) {
  if (!r) return html`<span class="bbz-muted">–</span>`;
  const ergebnis = r.bestanden === null || r.bestanden === undefined
    ? html`${chip('geplant', 'blue')} <button type="button" class="bbz-button bbz-button-sm" data-action="resultat" data-id="${r.id}">Resultat</button>`
    : html`${r.bestanden ? chip('bestanden', 'green') : chip('nicht bestanden', 'red')} ${r.resultatProzent !== null && r.resultatProzent !== undefined ? html`<strong>${prozent(r.resultatProzent)}</strong>` : ''}${r.score !== null && r.score !== undefined ? html` · ${zahl(r.score)} Pkt.` : ''}`;
  return html`<div class="bbz-saq-run"><div>${datum(r.datum)}${r.remote ? ' · remote' : r.ort ? ` · ${r.ort}` : ''}</div><div>${ergebnis}</div></div>`;
}

export async function detail(ctx) {
  const id = ctx.params.id;
  const f = await mitModul(ctx, 'SAQ-Vorgang', 'liste', () => get(`/saq/fall/${id}`, undefined, { ruhig: true }));
  if (f === null) return;
  const refs = await store.referenten();
  const runs = f.pruefungen ?? [];
  const pflicht = f.pflichtteile ?? { schriftlich: [], muendlich: [] };
  const teileSchluessel = new Map();
  for (const t of f.teile ?? []) teileSchluessel.set(`${t.art}-${t.teil}`, t);
  for (const t of pflicht.schriftlich) if (!teileSchluessel.has(`schriftlich-${t}`)) teileSchluessel.set(`schriftlich-${t}`, { art: 'schriftlich', teil: t, status: 'offen' });
  for (const t of pflicht.muendlich) if (!teileSchluessel.has(`muendlich-${t}`)) teileSchluessel.set(`muendlich-${t}`, { art: 'muendlich', teil: t, status: 'offen' });
  for (const r of runs) if (!teileSchluessel.has(`${r.art}-${r.teil}`)) teileSchluessel.set(`${r.art}-${r.teil}`, { art: r.art, teil: r.teil, status: 'offen' });
  const teile = [...teileSchluessel.values()].sort((a, b) => (a.art === b.art ? a.teil - b.teil : a.art === 'schriftlich' ? -1 : 1));
  const istPflicht = (t) => (t.art === 'schriftlich' ? pflicht.schriftlich : pflicht.muendlich).includes(t.teil);
  const runVon = (t, n) => runs.find((r) => r.art === t.art && r.teil === t.teil && r.run === n);
  const teilChip = { offen: chip('offen'), bestanden: chip('bestanden', 'green'), endgueltig_nicht_bestanden: chip('endgültig nicht bestanden', 'red') };
  const name = personName(f.kontakt);

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/saq">SAQ-Vorgänge</a> ›`,
      titel: `${name} · ${f.profil}`,
      untertitel: html`${statusChip('saqStatus', f.status)} ${f.passiv ? chip('passiv', 'amber') : ''} · ${f.organisationName ?? 'ohne Bank'} · ${label('saqVariante', f.variante)}`,
      aktionen: html`
        <a class="bbz-button" href="#/crm/kontakt/${f.kontaktId}">Kontakt</a>
        ${!f.arbeitgeberbestaetigungAm ? html`<button type="button" class="bbz-button" data-action="ag-bestaetigung">Arbeitgeberbestätigung</button>` : ''}
        ${f.status === 'bestanden' ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="zertifikat">Zertifikat ausstellen</button>` : ''}
        ${!['bestanden', 'zertifiziert', 'nicht_bestanden', 'abgebrochen'].includes(f.status) ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="planen">Prüfung planen</button>` : ''}`,
    })}
    ${saqTabs('liste')}
    ${f.hinweise?.length ? banner(html`<ul>${f.hinweise.map((h) => html`<li>${h}</li>`)}</ul>`, 'info') : ''}
    <div class="bbz-kpis">
      ${kpi({ titel: 'Schriftlich', zahl: f.schriftlichAlleBestanden ? 'bestanden' : 'offen', sub: `Pflichtteile ${pflicht.schriftlich.map((t) => teilCode('schriftlich', t)).join(', ') || '–'}` })}
      ${kpi({ titel: 'Mündlich', zahl: f.muendlichAlleBestanden ? 'bestanden' : f.muendlichZulassung?.zugelassen ? 'zugelassen' : 'nicht zugelassen', sub: f.muendlichZulassung?.gruende?.join('; ') ?? '' })}
      ${kpi({ titel: 'Arbeitgeberbestätigung', zahl: f.arbeitgeberbestaetigungAm ? datum(f.arbeitgeberbestaetigungAm) : 'fehlt', sub: 'Voraussetzung mündliche Prüfung' })}
      ${kpi({ titel: 'Passerelle', zahl: f.passerelleMoeglich ? 'möglich' : 'nein', sub: 'PK→IK, AFFL→CWMA, KMU→CCoB' })}
    </div>
    ${sektion({
      titel: 'Prüfungen', untertitel: 'je Teilprüfung bis zu drei Runs; bestanden ab 70 %', flush: true, testid: 'saq-runs',
      inhalt: teile.length ? html`<div class="bbz-table-wrap"><table class="bbz-saq-grid"><caption class="bbz-sr-only">Runs je Teilprüfung</caption>
        <thead><tr><th scope="col">Teil</th><th scope="col">RUN 1</th><th scope="col">RUN 2</th><th scope="col">RUN 3</th></tr></thead>
        <tbody>${teile.map((t) => html`<tr><th scope="row">${teilCode(t.art, t.teil)} ${istPflicht(t) ? html`<span class="bbz-small bbz-muted">Pflicht</span>` : ''}<div>${teilChip[t.status] ?? chip(t.status)}</div></th>
          ${[1, 2, 3].map((n) => html`<td>${runZelle(runVon(t, n))}</td>`)}</tr>`)}</tbody></table></div>` : html`<div class="bbz-empty">Noch keine Prüfungen geplant</div>`,
    })}
    <div class="bbz-g2">
      ${sektion({ titel: 'Angaben', inhalt: html`<dl class="bbz-dl">
        <dt>Umfang</dt><dd>${label('saqUmfang', f.umfang)}</dd><dt>Sprache</dt><dd>${f.sprache}</dd>
        <dt>Funktion</dt><dd>${f.rolle ?? '–'}</dd><dt>Digitale Hilfsmittel</dt><dd>${f.digitaleHilfsmittel ? 'ja' : 'nein'}</dd>
        <dt>Rechnung an Bank</dt><dd>${f.einwilligungRechnungBank ? 'ja (Einwilligung)' : 'nein'}</dd>
        <dt>Weitergabe Gruppe</dt><dd>${f.einwilligungWeitergabeGruppe ? 'ja' : 'nein'}</dd>
        ${f.bemerkung ? html`<dt>Bemerkung</dt><dd class="bbz-pre">${f.bemerkung}</dd>` : ''}</dl>` })}
      ${sektion({ titel: 'Zertifikat', inhalt: f.zertifizierung ? html`<dl class="bbz-dl"><dt>Nummer</dt><dd>${f.zertifizierung.zertifikatNr ?? '–'}</dd><dt>Gültig</dt><dd>${datum(f.zertifizierung.ausgestelltAm)} – ${datum(f.zertifizierung.gueltigBis)}</dd><dt>Status</dt><dd>${statusChip('zertStatus', f.zertifizierung.status)}</dd></dl>` : html`<div class="bbz-empty">Noch kein Zertifikat</div>` })}
    </div>`);

  const fertig = (m) => { toast(m, 'success'); ctx.neu(); };
  ctx.aktion('ag-bestaetigung', async () => {
    const r = await formModal({ titel: 'Arbeitgeberbestätigung', felder: feld({ name: 'datum', label: 'Datum', typ: 'date', wert: heute(), pflicht: true }), onSubmit: (w) => post(`/saq/fall/${id}/arbeitgeberbestaetigung`, w) });
    if (r) fertig('Arbeitgeberbestätigung erfasst');
  });
  ctx.aktion('planen', async () => {
    const r = await formModal({
      titel: 'Prüfung planen (nächster Run)', testid: 'saq-planen',
      felder: formGrid(
        feld({ name: 'art', label: 'Art', typ: 'select', optionen: [['schriftlich', 'schriftlich (WE)'], ['muendlich', 'mündlich (OE)']], wert: 'schriftlich' }),
        feld({ name: 'teil', label: 'Teil', typ: 'select', optionen: [1, 2, 3, 4, 5, 6].map((n) => [String(n), String(n)]), wert: String(pflicht.schriftlich[0] ?? 1), hint: 'mündlich: Teil 1 oder 2' }),
        feld({ name: 'datum', label: 'Datum', typ: 'date', pflicht: true }),
        feld({ name: 'ort', label: 'Ort' }),
        feld({ name: 'remote', label: 'remote', typ: 'checkbox' }),
        feld({ name: 'experte1Id', label: 'Experte 1 (mündlich)', typ: 'select', optionen: refs.map((x) => [x.id, x.anzeigename]), leerOption: '–' }),
        feld({ name: 'experte2Id', label: 'Experte 2 (mündlich)', typ: 'select', optionen: refs.map((x) => [x.id, x.anzeigename]), leerOption: '–' }),
      ),
      onSubmit: (w) => post(`/saq/fall/${id}/pruefung`, ohneLeere({ ...w, teil: Number(w.teil) })),
    });
    if (r) fertig(`${teilCode(r.art, r.teil)} RUN ${r.run} geplant`);
  });
  ctx.aktion('resultat', async (el) => {
    const run = runs.find((x) => x.id === el.dataset.id);
    const r = await formModal({
      titel: `Resultat ${teilCode(run.art, run.teil)} RUN ${run.run}`, testid: 'saq-resultat',
      felder: formGrid(
        feld({ name: 'resultatProzent', label: 'Resultat %', typ: 'number', attr: { min: 0, max: 100, step: '0.1' } }),
        feld({ name: 'score', label: 'Punkte', typ: 'number', attr: { min: 0, step: '0.5' } }),
        feld({ name: 'wertung', label: 'Wertung', typ: 'radio', optionen: [['auto', 'automatisch (ab 70 %)'], ['ja', 'bestanden'], ['nein', 'nicht bestanden']], wert: 'auto', span2: true }),
      ),
      onSubmit: (w) => post(`/saq/pruefung/${run.id}/resultat`, ohneLeere({ resultatProzent: w.resultatProzent, score: w.score, bestanden: w.wertung === 'auto' ? undefined : w.wertung === 'ja' })),
    });
    if (!r) return;
    (r.warnungen ?? []).forEach((w) => toast(w, 'warning'));
    fertig('Resultat erfasst');
  });
  ctx.aktion('zertifikat', async () => {
    const r = await formModal({
      titel: 'Zertifikat ausstellen', submitText: 'Ausstellen',
      felder: formGrid(feld({ name: 'zertifikatNr', label: 'Zertifikat-Nr.', pflicht: true }), feld({ name: 'ausgestelltAm', label: 'Ausgestellt am', typ: 'date', wert: heute(), pflicht: true })),
      onSubmit: (w) => post(`/saq/fall/${id}/zertifikat`, w),
    });
    if (r) fertig('Zertifikat ausgestellt – Rezertifizierungsfrist läuft');
  });
}

const quote = (q) => (q ? html`${q.quote === null ? '–' : prozent(q.quote)} <span class="bbz-small bbz-muted">(${q.zaehler ?? 0}/${q.n})</span>` : '–');
const mittel = (m) => (m ? html`${m.mittel === null ? '–' : prozent(m.mittel)} <span class="bbz-small bbz-muted">(n=${m.n})</span>` : '–');

export async function kennzahlen(ctx) {
  const jahrHeute = Number(heute().slice(0, 4));
  const jahr = /^\d{4}$/.test(ctx.query.jahr ?? '') ? ctx.query.jahr : String(jahrHeute);
  const k = await mitModul(ctx, 'SAQ-Kennzahlen', 'kennzahlen', () => get('/saq/kennzahlen', { jahr }, { ruhig: true }));
  if (k === null) return;
  const zeilen = [{ profil: 'Total', ...k.total }, ...(k.jeProfil ?? [])];
  ctx.zeige(html`
    ${seitenkopf({ titel: 'SAQ-Kennzahlen', untertitel: 'Bestehensquote: Nenner = abgeschlossene Vorgänge; immer mit n' })}
    ${saqTabs('kennzahlen')}
    ${tabs([jahrHeute, jahrHeute - 1, jahrHeute - 2].map((j) => ({ href: `#/saq/kennzahlen?jahr=${j}`, label: String(j), aktiv: String(j) === jahr })), 'Jahr')}
    <section class="bbz-section">${tabelle({
      zeilen, testid: 'saq-kennzahlen', beschriftung: `SAQ-Kennzahlen ${jahr}`,
      spalten: [
        { titel: 'Profil', wert: (z) => html`<strong>${z.profil}</strong>` },
        { titel: 'Vorgänge', klasse: 'num', wert: (z) => z.vorgaenge },
        { titel: 'Abgeschlossen', klasse: 'num', wert: (z) => z.abgeschlossen },
        { titel: 'Bestanden', klasse: 'num', wert: (z) => z.bestanden },
        { titel: 'Quote', wert: (z) => quote(z.quoteInsgesamt) },
        { titel: 'Erstversuch schriftl.', wert: (z) => quote(z.erstversuchSchriftlich) },
        { titel: 'Erstversuch mündl.', wert: (z) => quote(z.erstversuchMuendlich) },
        { titel: 'Ø Resultat schriftl.', wert: (z) => mittel(z.resultatErstversuchSchriftlich) },
        { titel: 'Ø Resultat mündl.', wert: (z) => mittel(z.resultatErstversuchMuendlich) },
      ],
    })}</section>`);
}

// Projekte: Portfolio mit Ampel, Filter Jahr/Status/Leitung (in der URL), Neuanlage (Admin).
import { get } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabelle, feld, ampel, statusChip, chf, prozent, balken, label, LABEL, heute, kpi, formWerte, toast,
} from '../ui.js';
import { projektFormular } from './formulare.js';

const STATUS_FILTER = { aktiv: 'akquise,offeriert,laufend', ...Object.fromEntries(Object.keys(LABEL.projektStatus).map((s) => [s, s])), alle: undefined };

export async function liste(ctx) {
  const q = ctx.query;
  const jahrHeute = Number(heute().slice(0, 4));
  const jahr = q.jahr === undefined ? String(jahrHeute) : q.jahr;
  const status = Object.hasOwn(STATUS_FILTER, q.status ?? '') ? q.status : 'aktiv';
  const [portfolio, ma, ag] = await Promise.all([
    get('/projekt/portfolio', { jahr: jahr || undefined, status: STATUS_FILTER[status], projektleitungId: q.projektleitungId }),
    store.mitarbeitende(), store.auftraggeber(),
  ]);
  const maMap = store.nachId(ma);
  const agMap = store.nachId(ag);
  const ampelFilter = q.ampel ?? '';
  const liste = ampelFilter ? portfolio.filter((p) => p.ampel === ampelFilter) : portfolio;
  const zaehle = (a) => portfolio.filter((p) => p.ampel === a).length;
  const summe = (f) => portfolio.reduce((s, p) => s + (p[f] ?? 0), 0);

  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Projekte', untertitel: 'Portfolio mit Budget, Fortschritt und Ampel',
      aktionen: ctx.istAdmin ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="projekt-neu">+ Projekt</button>` : '',
    })}
    <form class="bbz-filterbar compact" data-form="filter" aria-label="Projekte filtern">
      ${feld({ name: 'jahr', label: 'Jahr', typ: 'select', optionen: [jahrHeute + 1, jahrHeute, jahrHeute - 1, jahrHeute - 2].map((j) => [String(j), String(j)]), wert: jahr, leerOption: 'Alle Jahre', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'status', label: 'Status', typ: 'select', optionen: [['aktiv', 'Aktiv (Akquise bis laufend)'], ...Object.entries(LABEL.projektStatus), ['alle', 'Alle']], wert: status, attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'projektleitungId', label: 'Projektleitung', typ: 'select', optionen: store.maOptionen(ma), wert: q.projektleitungId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'ampel', label: 'Ampel', typ: 'select', optionen: Object.entries(LABEL.ampel), wert: ampelFilter, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <div class="bbz-kpis">
      ${kpi({ titel: 'Projekte', zahl: portfolio.length, sub: html`<span class="bbz-danger">${zaehle('rot')} rot</span> · <span class="bbz-warning">${zaehle('gelb')} gelb</span> · ${zaehle('gruen')} grün` })}
      ${kpi({ titel: 'Budget total', zahl: chf(summe('budgetChf')) })}
      ${kpi({ titel: 'Leistungen + Honorare', zahl: chf(summe('leistungenChf') + summe('honorareChf')) })}
      ${kpi({ titel: 'Unverrechnet', zahl: chf(summe('unverrechnetChf')), sub: 'verrechenbare Zeit ohne Rechnung' })}
    </div>
    <section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'portfolio-tabelle', beschriftung: 'Projektportfolio', leer: 'Keine Projekte für diese Filter',
      href: (p) => `#/projekt/${p.projektId}`,
      spalten: [
        { titel: 'Nummer', klasse: 'nowrap', wert: (p) => html`<a class="bbz-link" href="#/projekt/${p.projektId}">${p.nummer}</a>` },
        { titel: 'Projekt', wert: (p) => p.name },
        { titel: 'Auftraggeber', wert: (p) => agMap.get(p.auftraggeberId)?.name ?? '–' },
        { titel: 'Leitung', wert: (p) => maMap.get(p.projektleitungId)?.kuerzel ?? '–' },
        { titel: 'Status', wert: (p) => statusChip('projektStatus', p.status) },
        { titel: 'Budgetverbrauch', wert: (p) => (p.budgetverbrauchProzent === null ? html`<span class="bbz-muted">ohne Budget</span>` : html`<div class="bbz-belegung">${balken(p.budgetverbrauchProzent)}<span class="t">${prozent(p.budgetverbrauchProzent)}</span></div>`) },
        { titel: 'Fortschritt', klasse: 'num', wert: (p) => `${p.fortschritt.prozent} %` },
        { titel: 'Meilensteine', klasse: 'nowrap', wert: (p) => html`${p.meilensteine.erreicht}/${p.meilensteine.total}${p.meilensteine.ueberfaellig ? html` <span class="bbz-danger">(${p.meilensteine.ueberfaellig} überfällig)</span>` : ''}` },
        { titel: 'Ampel', wert: (p) => html`<span title="${p.ampelGruende.join('; ')}">${ampel(p.ampel)}</span>` },
      ],
      karte: (p) => ({ titel: `${p.nummer} ${p.name}`, sub: [agMap.get(p.auftraggeberId)?.name, label('projektStatus', p.status), p.budgetverbrauchProzent !== null ? `Budget ${prozent(p.budgetverbrauchProzent)}` : null].filter(Boolean).join(' · '), rechts: ampel(p.ampel) }),
    })}</section>`);

  const filtern = () => {
    const w = formWerte(ctx.el.querySelector('form[data-form=filter]'));
    const qs = new URLSearchParams(Object.entries({ ...w, jahr: w.jahr ?? '' }).filter(([k, v]) => v !== null && (v !== '' || k === 'jahr'))).toString();
    ctx.navigiere(`/projekte?${qs}`);
  };
  ctx.aenderung('filter', filtern);
  ctx.formular('filter', filtern);
  ctx.aktion('projekt-neu', async () => {
    const r = await projektFormular();
    if (r?.id) { toast(`Projekt ${r.nummer} erfasst`, 'success'); ctx.navigiere(`/projekt/${r.id}`); }
  });
}

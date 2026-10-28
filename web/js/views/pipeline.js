// CRM: Pipeline als Kanban nach Phase. Drag&Drop oder Auswahlfeld -> POST /verkaufschance/:id/phase.
// "verloren" fragt nach dem Verlustgrund; gewonnene Chancen ohne Projekt bieten "Projekt eröffnen".
import { get, post } from '../api.js';
import * as store from '../store.js';
import {
  html, raw, seitenkopf, sektion, tabelle, feld, chf, chfKurz, prozent, datum, label, LABEL, optionen, toast, eingabe, bestaetigen,
  monatLabel, formWerte,
} from '../ui.js';
import { crmTabs } from './teile.js';
import { verkaufschanceFormular, projektEroeffnen } from './formulare.js';
import { kanbanDnD } from '../dnd.js';

const PHASEN = Object.keys(LABEL.vkPhase);
const OFFEN = ['lead', 'qualifiziert', 'offeriert', 'verhandlung'];

export async function pipeline(ctx) {
  const verantwortlichId = ctx.query.verantwortlichId || undefined;
  const [liste, summen, ma] = await Promise.all([
    get('/verkaufschance', { verantwortlichId }),
    get('/verkaufschance/pipeline', { verantwortlichId }),
    store.mitarbeitende(),
  ]);
  const maMap = store.nachId(ma);
  const vcMap = store.nachId(liste);
  const summe = new Map(summen.phasen.map((p) => [p.phase, p]));
  const fokus = ctx.query.fokus;

  const karte = (v) => {
    const zu = !OFFEN.includes(v.phase);
    return html`<article class="bbz-card ${v.phase === 'gewonnen' ? 'is-won' : v.phase === 'verloren' ? 'is-lost' : ''}" draggable="true" tabindex="0"
        data-dnd-id="${v.id}" aria-label="${v.titel}, ${v.organisationName}, ${label('vkPhase', v.phase)}" ${fokus === v.id ? raw('data-fokus="1"') : ''}>
      <div class="bbz-card-title"><button type="button" class="bbz-card-link" data-action="vc-bearbeiten" data-id="${v.id}">${v.titel}</button></div>
      <div class="bbz-card-meta"><a class="bbz-link" href="#/crm/organisation/${v.organisationId}">${v.organisationName}</a></div>
      <div class="bbz-card-meta"><strong>${chf(v.wertChf)}</strong><span>${prozent(v.wahrscheinlichkeit)}</span>${v.erwarteterAbschluss ? html`<span>${datum(v.erwarteterAbschluss)}</span>` : ''}${maMap.get(v.verantwortlichId) ? html`<span>${maMap.get(v.verantwortlichId).kuerzel}</span>` : ''}</div>
      ${v.verlustgrund ? html`<div class="bbz-card-meta">Grund: ${v.verlustgrund}</div>` : ''}
      <div class="bbz-card-foot">
        <label class="bbz-sr-only" for="ph-${v.id}">Phase von ${v.titel}</label>
        <select id="ph-${v.id}" class="bbz-select bbz-input-sm" data-change="vc-phase" data-id="${v.id}" ${zu && !ctx.istAdmin ? raw('disabled') : ''}>${optionen(PHASEN.map((p) => [p, label('vkPhase', p)]), v.phase)}</select>
        ${v.phase === 'gewonnen' && !v.projektId ? html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="projekt-eroeffnen" data-id="${v.id}">Projekt eröffnen</button>` : ''}
        ${v.projektId ? html`<a class="bbz-button bbz-button-sm" href="#/projekt/${v.projektId}">Projekt</a>` : ''}
      </div></article>`;
  };

  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Pipeline', untertitel: html`Offen: ${summen.offen.anzahl} Chancen · Volumen ${chf(summen.offen.summeChf)} · gewichtet <strong>${chf(summen.offen.gewichtetChf)}</strong>`,
      aktionen: html`<button type="button" class="bbz-button bbz-button-primary" data-action="vc-neu">+ Verkaufschance</button>`,
    })}
    ${crmTabs('pipeline')}
    <form class="bbz-filterbar compact" data-form="filter" aria-label="Pipeline filtern">
      ${feld({ name: 'verantwortlichId', label: 'Verantwortlich', typ: 'select', optionen: store.maOptionen(ma), wert: verantwortlichId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <p class="bbz-small bbz-muted">Karten per Drag&amp;Drop in eine andere Phase ziehen oder die Phase im Auswahlfeld ändern. Gewonnen/verloren ist abschliessend (Wiedereröffnung nur Admin).</p>
    <div class="bbz-kanban" data-testid="pipeline-board">
      ${PHASEN.map((p) => {
        const s = summe.get(p);
        const karten = liste.filter((v) => v.phase === p);
        return html`<section class="bbz-kanban-col" aria-label="Phase ${label('vkPhase', p)}" data-testid="pipeline-spalte-${p}">
          <div class="bbz-kanban-head"><h3>${label('vkPhase', p)} <span class="bbz-count">${karten.length}</span></h3>
            <div class="sum">${chfKurz(s?.summeChf ?? 0)}${OFFEN.includes(p) ? html`<br>gew. ${chfKurz(s?.gewichtetChf ?? 0)}` : ''}</div></div>
          <div class="bbz-kanban-list" data-dnd-spalte="${p}">${karten.map(karte)}</div></section>`;
      })}
    </div>
    ${sektion({
      titel: 'Forecast', untertitel: 'offene Chancen nach erwartetem Abschlussmonat', flush: true,
      inhalt: tabelle({
        zeilen: [...summen.forecast, ...(summen.ohneTermin.anzahl ? [{ monat: null, ...summen.ohneTermin }] : [])], leer: 'Keine offenen Chancen',
        spalten: [
          { titel: 'Monat', wert: (f) => (f.monat ? monatLabel(f.monat) : 'ohne Termin') },
          { titel: 'Anzahl', klasse: 'num', wert: (f) => f.anzahl },
          { titel: 'Volumen', klasse: 'num', wert: (f) => chf(f.summeChf) },
          { titel: 'Gewichtet', klasse: 'num', wert: (f) => chf(f.gewichtetChf) },
        ],
      }),
    })}`);

  async function wechsle(id, phase) {
    const v = vcMap.get(id);
    if (!v || v.phase === phase) return;
    const body = { phase };
    if (!OFFEN.includes(v.phase)) {
      if (!ctx.istAdmin) { toast(`Die Chance ist bereits ${label('vkPhase', v.phase).toLowerCase()} – Wiedereröffnung nur durch Admin.`, 'warning'); ctx.neu(); return; }
      if (!(await bestaetigen(`«${v.titel}» ist ${label('vkPhase', v.phase).toLowerCase()}. Wiedereröffnen und nach «${label('vkPhase', phase)}» verschieben?`, { okText: 'Wiedereröffnen' }))) { ctx.neu(); return; }
      body.wiedereroeffnen = true;
    }
    if (phase === 'verloren') {
      const grund = await eingabe({ titel: `«${v.titel}» als verloren markieren`, label: 'Verlustgrund', hint: 'Pflicht bei verlorenen Chancen' });
      if (!grund) { ctx.neu(); return; }
      body.verlustgrund = grund;
    }
    try {
      await post(`/verkaufschance/${id}/phase`, body);
      toast(`«${v.titel}» → ${label('vkPhase', phase)}`, 'success');
    } finally { ctx.neu(); }
  }

  kanbanDnD(ctx.el.querySelector('[data-testid=pipeline-board]'), (id, phase) => wechsle(id, phase));
  ctx.aenderung('vc-phase', (el) => wechsle(el.dataset.id, el.value));
  ctx.aenderung('filter', (el) => ctx.navigiere(`/crm/pipeline${el.value ? `?verantwortlichId=${encodeURIComponent(el.value)}` : ''}`));
  ctx.formular('filter', (f) => ctx.navigiere(`/crm/pipeline?verantwortlichId=${encodeURIComponent(formWerte(f).verantwortlichId ?? '')}`));
  ctx.aktion('vc-neu', async () => { if (await verkaufschanceFormular()) { toast('Verkaufschance erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('vc-bearbeiten', async (el) => { if (await verkaufschanceFormular(vcMap.get(el.dataset.id))) { toast('Gespeichert', 'success'); ctx.neu(); } });
  ctx.aktion('projekt-eroeffnen', async (el) => {
    const r = await projektEroeffnen(vcMap.get(el.dataset.id));
    if (r?.projekt) { store.verwerfe('projekte'); toast(`Projekt ${r.projekt.nummer} eröffnet`, 'success'); ctx.navigiere(`/projekt/${r.projekt.id}`); }
  });
  ctx.el.querySelector('[data-fokus]')?.scrollIntoView({ block: 'center', inline: 'center' });
}

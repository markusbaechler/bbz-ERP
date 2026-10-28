// Ressourcen: Referent:innen (intern/extern, Saetze, Belegung) und Auslastung als Heatmap (je Person und Tag).
import { get, post, patch } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabs, tabelle, feld, formGrid, formModal, ohneLeere, datum, chf, zahl, chip, statusChip, heute, addTage,
  montag, wochentag, WOCHENTAGE, MONATE, toast, modal, leerHinweis, kpi,
} from '../ui.js';
import { personWahlFelder, personWahlVerdrahten, personAusWerten } from './teile.js';

const resTabs = (aktiv) => tabs([
  { href: '#/ressourcen', label: 'Referent:innen', aktiv: aktiv === 'referenten' },
  { href: '#/ressourcen/auslastung', label: 'Auslastung', aktiv: aktiv === 'auslastung' },
], 'Ressourcen');

async function referentFormular(ref = null) {
  const r = ref ?? {};
  if (ref) {
    return formModal({
      titel: `${r.anzeigename} bearbeiten`,
      felder: formGrid(
        feld({ name: 'anzeigename', label: 'Anzeigename', wert: r.anzeigename, pflicht: true, span2: true }),
        feld({ name: 'tagessatzChf', label: 'Tagessatz CHF', typ: 'number', wert: r.tagessatzChf, attr: { min: 0 } }),
        feld({ name: 'halbtagessatzChf', label: 'Halbtagessatz CHF', typ: 'number', wert: r.halbtagessatzChf, attr: { min: 0 } }),
        feld({ name: 'fachgebiete', label: 'Fachgebiete', wert: r.fachgebiete.join(', '), hint: 'durch Komma getrennt', span2: true }),
        feld({ name: 'aktiv', label: 'Aktiv', typ: 'checkbox', wert: r.aktiv }),
        feld({ name: 'bemerkung', label: 'Bemerkung', typ: 'textarea', wert: r.bemerkung, span2: true }),
      ),
      onSubmit: (w) => patch(`/referent/${ref.id}`, { ...w, fachgebiete: (w.fachgebiete ?? '').split(',').map((x) => x.trim()).filter(Boolean) }),
    });
  }
  const [ma, orgs] = await Promise.all([store.mitarbeitende(), store.organisationen()]);
  return formModal({
    titel: 'Referent:in erfassen', breit: true, testid: 'referent-form',
    felder: formGrid(
      feld({ name: 'typ', label: 'Typ', typ: 'radio', optionen: [['intern', 'intern (Mitarbeitende)'], ['extern', 'extern (CRM-Kontakt)']], wert: 'intern', span2: true }),
      feld({ name: 'mitarbeitendeId', label: 'Mitarbeitende (bei intern)', typ: 'select', optionen: store.maOptionen(ma), leerOption: '– wählen –', span2: true }),
      html`<div class="bbz-span-2 bbz-form-grid" data-extern hidden>${personWahlFelder({ mitOrganisation: orgs, titel: 'Kontakt (bei extern)' })}</div>`,
      feld({ name: 'anzeigename', label: 'Anzeigename', hint: 'leer = Name der Person' }),
      feld({ name: 'fachgebiete', label: 'Fachgebiete', hint: 'durch Komma getrennt' }),
      feld({ name: 'tagessatzChf', label: 'Tagessatz CHF', typ: 'number', attr: { min: 0 } }),
      feld({ name: 'halbtagessatzChf', label: 'Halbtagessatz CHF', typ: 'number', attr: { min: 0 } }),
    ),
    beimOeffnen: (form) => {
      personWahlVerdrahten(form);
      const umschalten = () => {
        const extern = form.querySelector('input[name=typ]:checked')?.value === 'extern';
        form.querySelector('[data-extern]').hidden = !extern;
        form.querySelector('[name=mitarbeitendeId]').closest('.bbz-field').hidden = extern;
      };
      form.querySelectorAll('input[name=typ]').forEach((x) => x.addEventListener('change', umschalten));
    },
    onSubmit: async (w) => {
      const basis = ohneLeere({ typ: w.typ, anzeigename: w.anzeigename, tagessatzChf: w.tagessatzChf, halbtagessatzChf: w.halbtagessatzChf });
      basis.fachgebiete = (w.fachgebiete ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      if (w.typ === 'intern') {
        if (!w.mitarbeitendeId) throw new Error('Bitte die Mitarbeitende wählen.');
        return post('/referent', { ...basis, mitarbeitendeId: w.mitarbeitendeId });
      }
      const person = personAusWerten(w);
      const kontaktId = person.kontaktId ?? (await post('/kontakt', ohneLeere(person.kontakt))).id;
      return post('/referent', { ...basis, kontaktId });
    },
  });
}

export async function referenten(ctx) {
  const refs = await get('/referent');
  const refMap = store.nachId(refs);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Referent:innen', untertitel: 'Intern und extern, mit Tages- und Halbtagessätzen', aktionen: ctx.istAdmin ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="ref-neu">+ Referent:in</button>` : '' })}
    ${resTabs('referenten')}
    <section class="bbz-section">${tabelle({
      zeilen: refs, testid: 'referenten-tabelle', beschriftung: 'Referent:innen', leer: 'Noch keine Referent:innen',
      spalten: [
        { titel: 'Name', wert: (r) => html`<strong>${r.anzeigename}</strong>${r.kontaktId ? html` <a class="bbz-small bbz-link" href="#/crm/kontakt/${r.kontaktId}">Kontakt</a>` : ''}` },
        { titel: 'Typ', wert: (r) => chip(r.typ, r.typ === 'intern' ? 'blue' : '') },
        { titel: 'Fachgebiete', wert: (r) => (r.fachgebiete.length ? r.fachgebiete.map((f) => chip(f)) : '–') },
        { titel: 'Tagessatz', klasse: 'num', wert: (r) => chf(r.tagessatzChf) },
        { titel: 'Halbtag', klasse: 'num', wert: (r) => chf(r.halbtagessatzChf) },
        { titel: 'Status', wert: (r) => (r.aktiv ? chip('aktiv', 'green') : chip('inaktiv', 'grey')) },
        { titel: '', klasse: 'act', wert: (r) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="belegung" data-id="${r.id}">Belegung</button>${ctx.istAdmin ? html` <button type="button" class="bbz-button bbz-button-sm" data-action="ref-bearbeiten" data-id="${r.id}">Bearbeiten</button>` : ''}` },
      ],
      karte: (r) => ({ titel: r.anzeigename, sub: `${r.typ} · ${r.fachgebiete.join(', ')}`, rechts: chf(r.tagessatzChf) }),
    })}</section>`);
  ctx.aktion('ref-neu', async () => { if (await referentFormular()) { store.verwerfe('referenten'); toast('Referent:in erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('ref-bearbeiten', async (el) => { if (await referentFormular(refMap.get(el.dataset.id))) { store.verwerfe('referenten'); toast('Gespeichert', 'success'); ctx.neu(); } });
  ctx.aktion('belegung', async (el) => {
    const r = refMap.get(el.dataset.id);
    const [liste, projekte] = await Promise.all([get(`/referent/${r.id}/belegung`, { von: addTage(heute(), -30), bis: addTage(heute(), 180) }), store.projekte()]);
    const pMap = store.nachId(projekte);
    modal({
      titel: `Belegung ${r.anzeigename}`, breit: true,
      inhalt: liste.length ? tabelle({
        zeilen: liste, beschriftung: 'Einsätze',
        spalten: [
          { titel: 'Datum', klasse: 'nowrap', wert: (e) => html`${WOCHENTAGE[wochentag(e.datum)]} ${datum(e.datum)}` },
          { titel: 'Projekt', wert: (e) => html`<a class="bbz-link" href="#/projekt/${e.projektId}/einsaetze">${pMap.get(e.projektId)?.nummer ?? ''}</a> ${pMap.get(e.projektId)?.name ?? ''}` },
          { titel: 'Rolle', wert: (e) => e.rolle },
          { titel: 'Tage', klasse: 'num', wert: (e) => zahl(e.dauerTage) },
          { titel: 'Status', wert: (e) => statusChip('einsatzStatus', e.status) },
        ],
      }) : leerHinweis('Keine Einsätze von −30 bis +180 Tagen'),
    });
  });
}

export async function auslastung(ctx) {
  const tage = 56;
  const von = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.von ?? '') ? montag(ctx.query.von) : montag(heute());
  const bis = addTage(von, tage - 1);
  const daten = await get('/ressourcen/auslastung', { von, bis });
  const h = heute();
  const spalten = Array.from({ length: tage }, (_, i) => addTage(von, i));
  const stufe = (t) => (!t ? '' : t > 1 ? 'h3' : t >= 1 ? 'h2' : 'h1');
  const ueberbucht = daten.flatMap((r) => r.tage.filter((t) => t.verplantTage > 1).map((t) => ({ ...t, name: r.anzeigename })));
  const total = daten.reduce((s, r) => s + r.summeTage, 0);
  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Auslastung', untertitel: `${datum(von)} – ${datum(bis)} · verplante Tage je Referent:in (ohne Absagen)`,
      aktionen: html`<a class="bbz-button" href="#/ressourcen/auslastung?von=${addTage(von, -28)}" aria-label="4 Wochen zurück">◀</a><a class="bbz-button" href="#/ressourcen/auslastung">Heute</a><a class="bbz-button" href="#/ressourcen/auslastung?von=${addTage(von, 28)}" aria-label="4 Wochen vor">▶</a>`,
    })}
    ${resTabs('auslastung')}
    <div class="bbz-kpis">
      ${kpi({ titel: 'Verplante Tage', zahl: zahl(total), sub: `${daten.length} Referent:innen` })}
      ${kpi({ titel: 'Überbuchungen', zahl: ueberbucht.length, sub: ueberbucht.length ? ueberbucht.map((u) => `${u.name} ${datum(u.datum)}`).join(', ') : 'keine' })}
    </div>
    <section class="bbz-section" data-testid="heatmap">
      <div class="bbz-legend"><span><i class="lg-h1"></i>halber Tag</span><span><i class="lg-h2"></i>ganzer Tag</span><span><i class="lg-h3"></i>überbucht</span><span><i class="lg-we"></i>Wochenende</span></div>
      ${daten.length ? html`<div class="bbz-heat-wrap"><table class="bbz-heat"><caption class="bbz-sr-only">Verplante Tage je Referent:in und Datum</caption>
        <thead><tr><th scope="col" class="name">Referent:in</th>${spalten.map((d) => html`<th scope="col" title="${datum(d)}" class="${d === h ? 'heute' : ''}">${d.slice(8) === '01' || d === von ? html`${MONATE[Number(d.slice(5, 7)) - 1]}<br>` : ''}${WOCHENTAGE[wochentag(d)]}<br>${Number(d.slice(8))}</th>`)}<th scope="col">Σ</th></tr></thead>
        <tbody>${daten.map((r) => {
          const map = new Map(r.tage.map((t) => [t.datum, t.verplantTage]));
          return html`<tr><th scope="row" class="name">${r.anzeigename}</th>${spalten.map((d) => {
            const t = map.get(d) ?? 0;
            const we = [0, 6].includes(wochentag(d));
            return html`<td class="${stufe(t) || (we ? 'we' : '')}" title="${r.anzeigename}: ${t ? `${zahl(t)} Tag(e)` : 'frei'} am ${datum(d)}${d === h ? ' (heute)' : ''}">${t ? html`<span class="bbz-sr-only">${datum(d)}: </span>${zahl(t)}` : ''}</td>`;
          })}<td class="sum">${zahl(r.summeTage)}</td></tr>`;
        })}</tbody></table></div>` : leerHinweis('Keine aktiven Referent:innen')}
    </section>`);
}

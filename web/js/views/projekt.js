// Projektdetail mit Tabs: Uebersicht (Cockpit), Aufgaben (Kanban), Gantt, Phasen & Meilensteine, Zeit, Einsaetze, Rechnungen.
import { get, post, patch, del } from '../api.js';
import * as store from '../store.js';
import {
  html, raw, seitenkopf, sektion, tabs, tabelle, feld, formGrid, formModal, ohneLeere, datum, chf, stunden, prozent, zahl,
  label, statusChip, ampel, balken, banner, heute, toast, bestaetigen, eingabe, optionenAus, optionen, kpi, chip, relativTage,
} from '../ui.js';
import { aufgabeFormular, projektFormular } from './formulare.js';
import { gantt, ganttLegende } from './gantt.js';
import { kanbanDnD } from '../dnd.js';

const UEBERGAENGE = {
  akquise: ['offeriert', 'abgesagt'], offeriert: ['laufend', 'abgesagt'], laufend: ['abgeschlossen', 'abgesagt'],
  abgeschlossen: ['archiviert', 'laufend'], abgesagt: [], archiviert: [],
};
const SPALTEN = ['offen', 'in_arbeit', 'review', 'erledigt'];

const TABS = [
  ['uebersicht', 'Übersicht'], ['aufgaben', 'Aufgaben'], ['gantt', 'Gantt'], ['phasen', 'Phasen & Meilensteine'],
  ['zeit', 'Zeiterfassung'], ['einsaetze', 'Einsätze'], ['rechnungen', 'Rechnungen'],
];

export async function detail(ctx) {
  const id = ctx.params.id;
  const tab = TABS.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : 'uebersicht';
  const [p, ma, ag] = await Promise.all([get(`/projekt/${id}`), store.mitarbeitende(), store.auftraggeber()]);
  const maMap = store.nachId(ma);
  const agMap = store.nachId(ag);
  const env = { p, ma, maMap, agMap, id };
  const teil = await TAB_RENDER[tab](ctx, env);

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/projekte">Projekte</a> ›`,
      titel: `${p.nummer} ${p.name}`,
      untertitel: html`${statusChip('projektStatus', p.status)} · ${agMap.get(p.auftraggeberId)?.name ?? ''}
        ${p.projektleitungId ? html` · Leitung ${maMap.get(p.projektleitungId)?.kuerzel ?? ''}` : ''}
        ${p.startDatum || p.endDatum ? html` · ${datum(p.startDatum)} – ${datum(p.endDatum)}` : ''}`,
      aktionen: html`
        ${UEBERGAENGE[p.status]?.length ? html`<button type="button" class="bbz-button" data-action="status">Status ändern</button>` : ''}
        <button type="button" class="bbz-button" data-action="fortsetzen">Jahresfortführung</button>
        <button type="button" class="bbz-button bbz-button-primary" data-action="bearbeiten">Bearbeiten</button>`,
    })}
    ${tabs(TABS.map(([k, l]) => ({ href: `#/projekt/${id}/${k}`, label: l, aktiv: k === tab })), 'Projektbereiche')}
    <div data-testid="projekt-tab-${tab}">${teil.inhalt}</div>`);
  teil.nachher?.();

  ctx.aktion('bearbeiten', async () => { if (await projektFormular(p)) { toast('Projekt gespeichert', 'success'); ctx.neu(); } });
  ctx.aktion('status', async () => {
    const ziele = UEBERGAENGE[p.status];
    const r = await formModal({
      titel: 'Projektstatus ändern', submitText: 'Status setzen',
      felder: formGrid(
        feld({ name: 'status', label: `Neuer Status (aktuell: ${label('projektStatus', p.status)})`, typ: 'select', optionen: ziele.map((s) => [s, label('projektStatus', s)]), pflicht: true, span2: true }),
        ctx.istAdmin && ziele.includes('abgeschlossen') ? feld({ name: 'force', label: 'Abschluss trotz unverrechneter Zeit erzwingen (Admin)', typ: 'checkbox', span2: true }) : '',
      ),
      onSubmit: (w) => post(`/projekt/${id}/status`, { status: w.status, force: w.force === true ? true : undefined }),
    });
    if (r) { store.verwerfe('projekte'); toast(`Status: ${label('projektStatus', r.status)}`, 'success'); ctx.neu(); }
  });
  ctx.aktion('fortsetzen', async () => {
    const jahr = await eingabe({ titel: 'Jahresfortführung', label: 'Neues Jahr', typ: 'number', wert: p.jahr + 1, hint: 'Gleiche Stammnummer; Name, Auftraggeber, Kontierung, Bereich und Leitung werden übernommen.', submitText: 'Fortführen' });
    if (!jahr) return;
    const neu = await post(`/projekt/${id}/fortsetzen`, { jahr: Number(jahr) });
    store.verwerfe('projekte');
    toast(`Projekt ${neu.nummer} angelegt`, 'success');
    ctx.navigiere(`/projekt/${neu.id}`);
  });
}

/* ---------------- Tabs ---------------- */
const TAB_RENDER = {
  async uebersicht(_ctx, { p, id }) {
    const c = await get(`/projekt/${id}/cockpit`);
    const verbrauch = c.leistungenChf + c.honorareChf;
    const zeile = (titel, wert, max, text, variante) => html`<div class="bbz-bar-row"><span class="lbl">${titel}</span>${max ? balken((wert / max) * 100, { variante }) : html`<span class="bbz-muted bbz-small">kein Budget</span>`}<span class="val">${text}</span></div>`;
    return {
      inhalt: html`
        ${banner(html`<div class="bbz-row">${ampel(c.ampel)} <strong>${c.ampel === 'gruen' ? 'Projekt im Plan' : 'Handlungsbedarf'}</strong></div>${c.ampelGruende.length ? html`<ul>${c.ampelGruende.map((g) => html`<li>${g}</li>`)}</ul>` : ''}`, c.ampel === 'rot' ? 'error' : c.ampel === 'gelb' ? 'warning' : 'success')}
        <div class="bbz-kpis">
          ${kpi({ titel: 'Budget', zahl: chf(c.budgetChf), sub: c.budgetStunden ? `${zahl(c.budgetStunden, 0)} h geplant` : '' })}
          ${kpi({ titel: 'Leistungen + Honorare', zahl: chf(verbrauch), sub: c.budgetverbrauchProzent !== null ? `${prozent(c.budgetverbrauchProzent)} des Budgets` : '' })}
          ${kpi({ titel: 'Abgerechnet', zahl: chf(c.abgerechnetChf), sub: `unverrechnet ${chf(c.unverrechnetChf)}` })}
          ${kpi({ titel: 'Deckungsbeitrag', zahl: html`<span class="${c.deckungsbeitragChf < 0 ? 'bbz-danger' : ''}">${chf(c.deckungsbeitragChf)}</span>`, sub: 'abgerechnet − interne Kosten − Honorare' })}
        </div>
        <div class="bbz-g2">
          ${sektion({ titel: 'Budget vs. Ist', testid: 'budget-ist', inhalt: html`
            ${zeile('Budget CHF', verbrauch, c.budgetChf, html`${chf(verbrauch)} / ${chf(c.budgetChf)}`)}
            ${zeile('Stunden', c.stundenIst, c.budgetStunden, html`${stunden(c.stundenIst)} / ${c.budgetStunden ? stunden(c.budgetStunden) : '–'}`)}
            ${zeile('Fortschritt', c.fortschritt.erledigt, c.fortschritt.total || 1, `${c.fortschritt.erledigt}/${c.fortschritt.total} Aufgaben`, 'green')}
            ${zeile('Meilensteine', c.meilensteine.erreicht, c.meilensteine.total || 1, `${c.meilensteine.erreicht}/${c.meilensteine.total} erreicht`, c.meilensteine.ueberfaellig ? 'amber' : 'green')}
            <dl class="bbz-dl bbz-mt">
              <dt>Leistungen</dt><dd>${chf(c.leistungenChf)} (${stunden(c.stundenVerrechenbar)} verrechenbar)</dd>
              <dt>Honorare</dt><dd>${chf(c.honorareChf)}</dd>
              <dt>Interne Kosten</dt><dd>${chf(c.internKostenChf)}</dd>
              <dt>Unverrechnet</dt><dd>${chf(c.unverrechnetChf)}</dd>
              ${c.meilensteine.ueberfaellig ? html`<dt>Verzug</dt><dd class="bbz-danger">${c.meilensteine.ueberfaellig} Meilenstein(e), max. ${c.meilensteine.maxVerzugTage} Tage</dd>` : ''}
            </dl>` })}
          ${sektion({ titel: 'Stammdaten', inhalt: html`<dl class="bbz-dl">
            <dt>Nummer</dt><dd>${p.nummer} (Stammnummer ${p.stammnummer}, Jahr ${p.jahr})</dd>
            <dt>Bereich</dt><dd>${p.bereich ?? '–'}</dd>
            <dt>Kürzel</dt><dd>${p.kuerzel ?? '–'}</dd>
            <dt>Zeitraum</dt><dd>${datum(p.startDatum)} – ${datum(p.endDatum)}</dd>
            <dt>MWSt-Modus</dt><dd>${p.mwstModus === 'inkl' ? 'inklusive' : 'exklusive'}</dd>
            <dt>Ansprechperson</dt><dd>${p.ansprechpersonKontaktId ? html`<a class="bbz-link" href="#/crm/kontakt/${p.ansprechpersonKontaktId}">Kontakt öffnen</a>` : '–'}</dd>
            ${p.beschrieb ? html`<dt>Beschrieb</dt><dd class="bbz-pre">${p.beschrieb}</dd>` : ''}</dl>` })}
        </div>`,
    };
  },

  async aufgaben(ctx, { maMap, id }) {
    const k = await get(`/projekt/${id}/kanban`);
    const alle = new Map(k.spalten.flatMap((s) => s.aufgaben).map((a) => [a.id, a]));
    const h = heute();
    const karte = (a, si, idx, spalte) => {
      const v = a.vorgaengerId ? alle.get(a.vorgaengerId) : null;
      const blockiert = a.vorgaengerId && v?.status !== 'erledigt';
      const ueber = a.faelligAm && a.faelligAm < h && a.status !== 'erledigt';
      return html`<article class="bbz-card prio-${a.prioritaet}" draggable="true" tabindex="0" data-dnd-id="${a.id}" data-testid="aufgabe-karte" aria-label="${a.titel}, ${label('aufgabeStatus', a.status)}">
        <div class="bbz-card-title"><button type="button" class="bbz-card-link" data-action="aufgabe-bearbeiten" data-id="${a.id}">${a.titel}</button></div>
        <div class="bbz-card-meta">
          ${a.prioritaet !== 'normal' ? statusChip('prioritaet', a.prioritaet) : ''}
          ${a.faelligAm ? html`<span class="${ueber ? 'bbz-danger' : ''}">fällig ${datum(a.faelligAm)}</span>` : ''}
          ${a.zustaendigId ? html`<span>${maMap.get(a.zustaendigId)?.kuerzel ?? ''}</span>` : ''}
          ${a.schaetzungStunden ? html`<span>${zahl(a.schaetzungStunden)} h</span>` : ''}
        </div>
        ${blockiert ? html`<div class="bbz-card-meta bbz-warning">wartet auf: ${v?.titel ?? 'Vorgänger'}</div>` : ''}
        <div class="bbz-card-foot"><span></span><div class="bbz-card-moves">
          <button type="button" class="bbz-icon-btn" data-action="aufgabe-schieben" data-id="${a.id}" data-status="${SPALTEN[si - 1] ?? ''}" data-index="0" ${si === 0 ? raw('disabled') : ''} aria-label="Nach ${si ? label('aufgabeStatus', SPALTEN[si - 1]) : ''} verschieben">◀</button>
          <button type="button" class="bbz-icon-btn" data-action="aufgabe-schieben" data-id="${a.id}" data-status="${a.status}" data-index="${idx - 1}" ${idx === 0 ? raw('disabled') : ''} aria-label="Nach oben">▲</button>
          <button type="button" class="bbz-icon-btn" data-action="aufgabe-schieben" data-id="${a.id}" data-status="${a.status}" data-index="${idx + 1}" ${idx === spalte.length - 1 ? raw('disabled') : ''} aria-label="Nach unten">▼</button>
          <button type="button" class="bbz-icon-btn" data-action="aufgabe-schieben" data-id="${a.id}" data-status="${SPALTEN[si + 1] ?? ''}" data-index="0" ${si === SPALTEN.length - 1 ? raw('disabled') : ''} aria-label="Nach ${SPALTEN[si + 1] ? label('aufgabeStatus', SPALTEN[si + 1]) : ''} verschieben">▶</button>
        </div></div></article>`;
    };
    const verschiebe = async (aufgabeId, status, sortierung) => {
      try {
        await post(`/aufgabe/${aufgabeId}/verschieben`, { status, sortierung });
        if (alle.get(aufgabeId)?.status !== status) toast(`«${alle.get(aufgabeId)?.titel}» → ${label('aufgabeStatus', status)}`, 'success');
      } finally { ctx.neu(); }
    };
    ctx.aktion('aufgabe-schieben', (el) => { if (el.dataset.status) return verschiebe(el.dataset.id, el.dataset.status, Number(el.dataset.index)); return undefined; });
    ctx.aktion('aufgabe-neu', async () => { if (await aufgabeFormular({ vor: { projektId: id } })) { toast('Aufgabe erfasst', 'success'); ctx.neu(); } });
    ctx.aktion('aufgabe-bearbeiten', async (el) => {
      const r = await aufgabeFormular({ aufgabe: alle.get(el.dataset.id) });
      if (r) { toast(r.geloescht ? 'Aufgabe gelöscht' : 'Aufgabe gespeichert', 'success'); ctx.neu(); }
    });
    return {
      inhalt: html`<div class="bbz-row-between bbz-mb"><p class="bbz-small bbz-muted bbz-m0">Karten ziehen oder mit ◀ ▲ ▼ ▶ verschieben. Eine Aufgabe startet erst, wenn ihr Vorgänger erledigt ist.</p>
          <button type="button" class="bbz-button bbz-button-primary" data-action="aufgabe-neu">+ Aufgabe</button></div>
        <div class="bbz-kanban" data-testid="aufgaben-kanban">${k.spalten.map((s, si) => html`<section class="bbz-kanban-col" aria-label="${label('aufgabeStatus', s.status)}" data-testid="kanban-spalte-${s.status}">
          <div class="bbz-kanban-head"><h3>${label('aufgabeStatus', s.status)} <span class="bbz-count">${s.aufgaben.length}</span></h3></div>
          <div class="bbz-kanban-list" data-dnd-spalte="${s.status}">${s.aufgaben.map((a, i) => karte(a, si, i, s.aufgaben))}</div></section>`)}</div>`,
      nachher: () => kanbanDnD(ctx.el.querySelector('[data-testid=aufgaben-kanban]'), (aid, status, index) => verschiebe(aid, status, index)),
    };
  },

  async gantt(_ctx, { id }) {
    const g = await get(`/projekt/${id}/gantt`);
    const r = gantt(g, { heute: heute() });
    return {
      inhalt: html`${sektion({ titel: 'Zeitplan', untertitel: g.start ? `${datum(g.start)} – ${datum(g.ende)}` : '', flush: true, inhalt: html`${ganttLegende()}<div class="bbz-gantt-wrap">${r.svg}</div>` })}
        ${r.ungeplant.length ? sektion({ titel: `Ohne Termin (${r.ungeplant.length})`, inhalt: html`${r.ungeplant.map((u) => chip(u.titel))}` }) : ''}
        <details class="bbz-section"><summary class="bbz-section-header bbz-section-title">Als Tabelle anzeigen</summary>${r.tabelle}</details>`,
    };
  },

  async phasen(ctx, { id }) {
    const [phasen, ms] = await Promise.all([get(`/projekt/${id}/phase`), get(`/projekt/${id}/meilenstein`)]);
    const phMap = new Map(phasen.map((x) => [x.id, x]));
    const msMap = new Map(ms.map((x) => [x.id, x]));
    const h = heute();
    const phaseForm = (alt) => formModal({
      titel: alt ? 'Phase bearbeiten' : 'Phase erfassen',
      felder: formGrid(
        feld({ name: 'name', label: 'Name', wert: alt?.name, pflicht: true, span2: true }),
        feld({ name: 'startDatum', label: 'Start', typ: 'date', wert: alt?.startDatum }),
        feld({ name: 'endDatum', label: 'Ende', typ: 'date', wert: alt?.endDatum }),
        feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('phaseStatus'), wert: alt?.status ?? 'geplant' }),
        feld({ name: 'reihenfolge', label: 'Reihenfolge', typ: 'number', wert: alt?.reihenfolge, attr: { step: 1 } }),
      ),
      onSubmit: (w) => (alt ? patch(`/phase/${alt.id}`, ohneLeere(w)) : post(`/projekt/${id}/phase`, ohneLeere(w))),
    });
    const msForm = (alt) => formModal({
      titel: alt ? 'Meilenstein bearbeiten' : 'Meilenstein erfassen',
      felder: formGrid(
        feld({ name: 'titel', label: 'Titel', wert: alt?.titel, pflicht: true, span2: true }),
        feld({ name: 'faelligAm', label: 'Fällig am', typ: 'date', wert: alt?.faelligAm, pflicht: true }),
        feld({ name: 'phaseId', label: 'Phase', typ: 'select', optionen: phasen.map((x) => [x.id, x.name]), wert: alt?.phaseId, leerOption: '– keine –' }),
        feld({ name: 'beschreibung', label: 'Beschreibung', typ: 'textarea', wert: alt?.beschreibung, span2: true }),
      ),
      onSubmit: (w) => (alt ? patch(`/meilenstein/${alt.id}`, w) : post(`/projekt/${id}/meilenstein`, ohneLeere(w))),
    });
    const fertig = (msg) => { toast(msg, 'success'); ctx.neu(); };
    ctx.aktion('phase-neu', async () => { if (await phaseForm()) fertig('Phase erfasst'); });
    ctx.aktion('phase-bearbeiten', async (el) => { if (await phaseForm(phMap.get(el.dataset.id))) fertig('Phase gespeichert'); });
    ctx.aktion('phase-loeschen', async (el) => {
      if (!(await bestaetigen(`Phase «${phMap.get(el.dataset.id).name}» löschen? Aufgaben und Meilensteine bleiben erhalten.`, { okText: 'Löschen', gefahr: true }))) return;
      await del(`/phase/${el.dataset.id}`); fertig('Phase gelöscht');
    });
    ctx.aktion('ms-neu', async () => { if (await msForm()) fertig('Meilenstein erfasst'); });
    ctx.aktion('ms-bearbeiten', async (el) => { if (await msForm(msMap.get(el.dataset.id))) fertig('Meilenstein gespeichert'); });
    ctx.aktion('ms-erreicht', async (el) => { await post(`/meilenstein/${el.dataset.id}/erreicht`, { datum: h }); fertig('Meilenstein erreicht'); });
    ctx.aktion('ms-loeschen', async (el) => {
      if (!(await bestaetigen(`Meilenstein «${msMap.get(el.dataset.id).titel}» löschen?`, { okText: 'Löschen', gefahr: true }))) return;
      await del(`/meilenstein/${el.dataset.id}`); fertig('Meilenstein gelöscht');
    });
    return {
      inhalt: html`<div class="bbz-g2">
        ${sektion({
          titel: 'Phasen', flush: true, aktionen: html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="phase-neu">+ Phase</button>`,
          inhalt: tabelle({
            zeilen: phasen, leer: 'Noch keine Phasen',
            spalten: [
              { titel: '#', klasse: 'num', wert: (x) => x.reihenfolge },
              { titel: 'Phase', wert: (x) => x.name },
              { titel: 'Zeitraum', klasse: 'nowrap', wert: (x) => html`${datum(x.startDatum)} – ${datum(x.endDatum)}` },
              { titel: 'Status', wert: (x) => statusChip('phaseStatus', x.status) },
              { titel: '', klasse: 'act', wert: (x) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="phase-bearbeiten" data-id="${x.id}">Bearbeiten</button>${ctx.istAdmin ? html` <button type="button" class="bbz-button bbz-button-sm bbz-button-danger" data-action="phase-loeschen" data-id="${x.id}" aria-label="Phase ${x.name} löschen">✕</button>` : ''}` },
            ],
          }),
        })}
        ${sektion({
          titel: 'Meilensteine', flush: true, aktionen: html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="ms-neu">+ Meilenstein</button>`,
          inhalt: tabelle({
            zeilen: ms, leer: 'Noch keine Meilensteine',
            spalten: [
              { titel: 'Meilenstein', wert: (m) => html`${m.titel}${m.phaseId ? html`<div class="bbz-small bbz-muted">${phMap.get(m.phaseId)?.name ?? ''}</div>` : ''}` },
              { titel: 'Fällig', klasse: 'nowrap', wert: (m) => html`<span class="${!m.erreichtAm && m.faelligAm < h ? 'bbz-danger' : ''}">${datum(m.faelligAm)}</span>` },
              { titel: 'Status', wert: (m) => (m.erreichtAm ? chip(`erreicht ${datum(m.erreichtAm)}`, 'green') : m.faelligAm < h ? chip(`überfällig (${relativTage(m.faelligAm)})`, 'red') : chip('offen')) },
              { titel: '', klasse: 'act', wert: (m) => html`${!m.erreichtAm ? html`<button type="button" class="bbz-button bbz-button-sm" data-action="ms-erreicht" data-id="${m.id}">Erreicht</button> ` : ''}<button type="button" class="bbz-button bbz-button-sm" data-action="ms-bearbeiten" data-id="${m.id}">Bearbeiten</button>${ctx.istAdmin ? html` <button type="button" class="bbz-button bbz-button-sm bbz-button-danger" data-action="ms-loeschen" data-id="${m.id}" aria-label="Meilenstein ${m.titel} löschen">✕</button>` : ''}` },
            ],
          }),
        })}</div>`,
    };
  },

  async zeit(ctx, { ma, maMap, id, p }) {
    const [eintraege, aufgaben] = await Promise.all([get('/zeiterfassung', { projektId: id }), get('/aufgabe', { projektId: id })]);
    const aufgMap = new Map(aufgaben.map((a) => [a.id, a]));
    const total = eintraege.reduce((s, z) => s + z.stunden, 0);
    const betrag = (z) => (z.verrechenbar && z.ansatzChf !== null ? z.stunden * z.ansatzChf : null);
    const totalBetrag = eintraege.reduce((s, z) => s + (betrag(z) ?? 0), 0);
    const gesperrt = ['archiviert', 'abgesagt'].includes(p.status);
    ctx.formular('zeit-neu', async (f, w) => {
      await post('/zeiterfassung', ohneLeere({ ...w, projektId: id, verrechenbar: w.verrechenbar }));
      toast('Zeit erfasst', 'success');
      ctx.neu();
    });
    ctx.aktion('zeit-loeschen', async (el) => {
      if (!(await bestaetigen('Zeiteintrag löschen?', { okText: 'Löschen', gefahr: true }))) return;
      await del(`/zeiterfassung/${el.dataset.id}`); toast('Zeiteintrag gelöscht', 'success'); ctx.neu();
    });
    return {
      inhalt: html`
        ${gesperrt ? banner(`Auf ein ${label('projektStatus', p.status).toLowerCase()}es Projekt kann keine Zeit erfasst werden.`, 'warning') : sektion({
          titel: 'Zeit erfassen',
          inhalt: html`<form data-form="zeit-neu" class="bbz-form-grid" data-testid="zeit-form">
            ${feld({ name: 'datum', label: 'Datum', typ: 'date', wert: heute(), pflicht: true })}
            ${feld({ name: 'stunden', label: 'Stunden', typ: 'number', pflicht: true, attr: { min: 0.25, max: 24, step: '0.25' } })}
            ${feld({ name: 'taetigkeit', label: 'Tätigkeit', pflicht: true, span2: true })}
            ${feld({ name: 'mitarbeitendeId', label: 'Person', typ: 'select', optionen: store.maOptionen(ma), wert: ctx.benutzer.mitarbeitendeId, leerOption: '– angemeldete Person –' })}
            ${feld({ name: 'aufgabeId', label: 'Aufgabe', typ: 'select', optionen: aufgaben.map((a) => [a.id, a.titel]), leerOption: '– keine –' })}
            ${feld({ name: 'verrechenbar', label: 'verrechenbar', typ: 'checkbox', wert: true })}
            <div class="bbz-field"><button type="submit" class="bbz-button bbz-button-primary">Erfassen</button></div></form>`,
        })}
        ${sektion({
          titel: `Zeiteinträge (${eintraege.length})`, untertitel: `${stunden(total)} · Leistungswert ${chf(totalBetrag)}`, flush: true,
          inhalt: tabelle({
            zeilen: [...eintraege].reverse(), leer: 'Noch keine Zeit erfasst', beschriftung: 'Zeiteinträge',
            spalten: [
              { titel: 'Datum', klasse: 'nowrap', wert: (z) => datum(z.datum) },
              { titel: 'Person', wert: (z) => maMap.get(z.mitarbeitendeId)?.kuerzel ?? '–' },
              { titel: 'Tätigkeit', wert: (z) => html`${z.taetigkeit}${z.aufgabeId ? html`<div class="bbz-small bbz-muted">${aufgMap.get(z.aufgabeId)?.titel ?? ''}</div>` : ''}` },
              { titel: 'Std.', klasse: 'num', wert: (z) => zahl(z.stunden, 2) },
              { titel: 'Ansatz', klasse: 'num', wert: (z) => (z.ansatzChf === null ? '–' : chf(z.ansatzChf)) },
              { titel: 'Betrag', klasse: 'num', wert: (z) => (betrag(z) === null ? html`<span class="bbz-muted">nicht verr.</span>` : chf(betrag(z))) },
              { titel: 'Status', wert: (z) => (z.verrechnet ? chip('verrechnet', 'green') : z.verrechenbar ? chip('offen', 'amber') : chip('intern')) },
              { titel: '', klasse: 'act', wert: (z) => (z.verrechnet ? '' : html`<button type="button" class="bbz-icon-btn" data-action="zeit-loeschen" data-id="${z.id}" aria-label="Eintrag vom ${datum(z.datum)} löschen">✕</button>`) },
            ],
            fuss: html`<tr><td colspan="3">Total</td><td class="num">${zahl(total, 2)}</td><td></td><td class="num">${chf(totalBetrag)}</td><td colspan="2"></td></tr>`,
          }),
        })}`,
    };
  },

  async einsaetze(ctx, { id }) {
    const [einsaetze, refs] = await Promise.all([get('/einsatz', { projektId: id }), store.referenten()]);
    const refMap = store.nachId(refs);
    ctx.aenderung('einsatz-status', async (el) => { await post(`/einsatz/${el.dataset.id}/status`, { status: el.value }); toast('Einsatzstatus gespeichert', 'success'); ctx.neu(); });
    ctx.aktion('einsatz-neu', async () => {
      const r = await formModal({
        titel: 'Einsatz planen',
        felder: formGrid(
          feld({ name: 'referentId', label: 'Referent:in', typ: 'select', optionen: refs.filter((x) => x.aktiv).map((x) => [x.id, x.anzeigename]), leerOption: '– wählen –', pflicht: true, span2: true }),
          feld({ name: 'datum', label: 'Datum', typ: 'date', pflicht: true, wert: heute() }),
          feld({ name: 'dauerTage', label: 'Dauer', typ: 'select', optionen: [['1', 'Ganzer Tag'], ['0.5', 'Halber Tag']], wert: '1' }),
          feld({ name: 'rolle', label: 'Rolle', wert: 'Referent' }),
          feld({ name: 'honorarChf', label: 'Honorar CHF', typ: 'number', hint: 'leer = Tages-/Halbtagessatz', attr: { min: 0 } }),
          feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('einsatzStatus').filter(([s]) => s !== 'abgesagt'), wert: 'angefragt' }),
          ctx.istAdmin ? feld({ name: 'ueberbuchungErlauben', label: 'Überbuchung bewusst zulassen (Admin)', typ: 'checkbox' }) : '',
          feld({ name: 'bemerkung', label: 'Bemerkung', span2: true }),
        ),
        onSubmit: (w) => post('/einsatz', ohneLeere({ ...w, projektId: id, dauerTage: Number(w.dauerTage), ueberbuchungErlauben: w.ueberbuchungErlauben || undefined })),
      });
      if (r) { toast('Einsatz geplant', 'success'); ctx.neu(); }
    });
    const summe = einsaetze.filter((e) => e.status !== 'abgesagt').reduce((s, e) => s + (e.honorarChf ?? 0), 0);
    return {
      inhalt: sektion({
        titel: `Einsätze (${einsaetze.length})`, untertitel: `Honorare ohne Absagen: ${chf(summe)}`, flush: true,
        aktionen: html`<a class="bbz-button bbz-button-sm" href="#/ressourcen/auslastung">Auslastung</a> <button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="einsatz-neu">+ Einsatz</button>`,
        inhalt: tabelle({
          zeilen: einsaetze, leer: 'Keine Einsätze geplant',
          spalten: [
            { titel: 'Datum', klasse: 'nowrap', wert: (e) => datum(e.datum) },
            { titel: 'Referent:in', wert: (e) => refMap.get(e.referentId)?.anzeigename ?? '–' },
            { titel: 'Rolle', wert: (e) => e.rolle },
            { titel: 'Dauer', klasse: 'num', wert: (e) => (e.dauerTage === 1 ? '1 Tag' : `${zahl(e.dauerTage)} Tag`) },
            { titel: 'Honorar', klasse: 'num', wert: (e) => chf(e.honorarChf) },
            { titel: 'Status', wert: (e) => html`<label class="bbz-sr-only" for="es-${e.id}">Status Einsatz ${datum(e.datum)}</label><select id="es-${e.id}" class="bbz-select bbz-input-sm" data-change="einsatz-status" data-id="${e.id}">${optionen(optionenAus('einsatzStatus'), e.status)}</select>` },
          ],
        }),
      }),
    };
  },

  async rechnungen(ctx, { id }) {
    const [rechnungen, cockpit] = await Promise.all([get('/rechnung', { projektId: id }), get(`/projekt/${id}/cockpit`)]);
    const entwuerfe = rechnungen.filter((r) => ['offen_prov', 'def_vereinbart'].includes(r.status));
    ctx.aktion('zeit-verrechnen', async () => {
      const MWST = await store.mwstOptionen();
      const r = await formModal({
        titel: 'Zeit verrechnen', submitText: 'Rechnungsentwurf erstellen', testid: 'zeit-verrechnen',
        felder: formGrid(
          html`<p class="bbz-span-2 bbz-small bbz-muted">Alle verrechenbaren, noch nicht verrechneten Zeiteinträge (optional bis Stichtag) werden in einer Transaktion auf einen Rechnungsentwurf gebucht. Aktuell unverrechnet: <strong>${chf(cockpit.unverrechnetChf)}</strong>.</p>`,
          feld({ name: 'datum', label: 'Rechnungsdatum', typ: 'date', wert: heute(), pflicht: true }),
          feld({ name: 'bis', label: 'Leistungen bis', typ: 'date', hint: 'leer = alle' }),
          feld({ name: 'mwstSatz', label: 'MWSt-Satz', typ: 'select', optionen: MWST, wert: '8.1' }),
          feld({ name: 'gruppierung', label: 'Positionen', typ: 'select', optionen: [['mitarbeitende', 'je Person'], ['taetigkeit', 'je Tätigkeit'], ['einzeln', 'je Eintrag']], wert: 'mitarbeitende' }),
          feld({ name: 'rechnungId', label: 'Auf bestehenden Entwurf buchen', typ: 'select', optionen: entwuerfe.map((x) => [x.id, `${datum(x.datum)} · ${chf(x.totalBrutto)}`]), leerOption: '– neuer Entwurf –', span2: true }),
        ),
        onSubmit: (w) => post(`/projekt/${id}/zeit-verrechnen`, ohneLeere({ ...w, mwstSatz: Number(w.mwstSatz) })),
      });
      if (r?.rechnung) { toast(`${r.anzahlEintraege} Zeiteinträge verrechnet (${r.positionen.length} Positionen)`, 'success'); ctx.navigiere(`/finanzen/rechnung/${r.rechnung.id}`); }
    });
    return {
      inhalt: sektion({
        titel: `Rechnungen (${rechnungen.length})`, untertitel: `Unverrechnete Leistungen: ${chf(cockpit.unverrechnetChf)}`, flush: true,
        aktionen: ctx.istAdmin ? html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="zeit-verrechnen">Zeit verrechnen</button>` : '',
        inhalt: tabelle({
          zeilen: rechnungen, leer: 'Noch keine Rechnungen', href: (r) => `#/finanzen/rechnung/${r.id}`,
          spalten: [
            { titel: 'Nummer', wert: (r) => html`<a class="bbz-link" href="#/finanzen/rechnung/${r.id}">${r.nummer ?? 'Entwurf'}</a>` },
            { titel: 'Datum', klasse: 'nowrap', wert: (r) => datum(r.datum) },
            { titel: 'Betreff', wert: (r) => r.betreff ?? '–' },
            { titel: 'Netto', klasse: 'num', wert: (r) => chf(r.totalNetto) },
            { titel: 'Brutto', klasse: 'num', wert: (r) => chf(r.totalBrutto) },
            { titel: 'Status', wert: (r) => statusChip('rechnungStatus', r.status) },
          ],
        }),
      }),
    };
  },
};

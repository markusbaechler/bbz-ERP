// Durchfuehrung: Kurstage (+ Referent:innen), Belegung, Teilnehmende (Anmeldung, Bestaetigung, Storno mit
// Annullationskosten, Teilnahme), Status, Teilnehmerliste CSV, Verrechnung (Admin).
import { get, post, patch, del } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, sektion, tabelle, feld, formGrid, formModal, ohneLeere, datum, chf, label, statusChip, belegung,
  heute, toast, bestaetigen, kpi, modal, banner, optionen, personName, leerHinweis,
} from '../ui.js';
import { personWahlFelder, personWahlVerdrahten, personAusWerten } from './teile.js';
import { bildungTabs } from './bildung.js';

const NAECHSTER = { geplant: ['ausgeschrieben', 'Ausschreiben'], ausgeschrieben: ['bestaetigt', 'Durchführung bestätigen'], bestaetigt: ['durchgefuehrt', 'Als durchgeführt markieren'] };
const MIT_PLATZ = ['angemeldet', 'bestaetigt', 'teilgenommen', 'abgeschlossen'];

export async function detail(ctx) {
  const id = ctx.params.id;
  const [d, tl, anm, refs, ag, projekte, ma, angebote] = await Promise.all([
    get(`/durchfuehrung/${id}`), get(`/durchfuehrung/${id}/teilnehmerliste`), get('/anmeldung', { durchfuehrungId: id }),
    store.referenten(), store.auftraggeber(), store.projekte(), store.mitarbeitende(), store.kursangebote(),
  ]);
  const tlMap = new Map(tl.map((t) => [t.anmeldungId, t]));
  const refMap = store.nachId(refs);
  const agMap = store.nachId(ag);
  const storniert = anm.filter((a) => a.status === 'storniert');
  // Stornierte stehen nicht in der Teilnehmerliste: Namen ueber die Kontakte nachladen (wenige Faelle)
  const stornoNamen = new Map(await Promise.all(storniert.slice(0, 15).map(async (a) => {
    try { const k = await get(`/kontakt/${a.kontaktId}`, undefined, { ruhig: true }); return [a.id, { name: personName(k), organisation: k.organisation?.name ?? null, email: k.email }]; } catch { return [a.id, null]; }
  })));
  const person = (a) => {
    const t = tlMap.get(a.id);
    if (t) return { name: [t.vorname, t.nachname].filter(Boolean).join(' '), organisation: t.organisation, email: t.email };
    return stornoNamen.get(a.id) ?? { name: 'Kontakt', organisation: null, email: null };
  };
  const rang = { angemeldet: 0, bestaetigt: 0, teilgenommen: 0, abgeschlossen: 0, nicht_bestanden: 1, warteliste: 2, storniert: 3 };
  const zeilen = [...anm].sort((a, b) => rang[a.status] - rang[b.status] || (a.wartelistenPosition ?? 0) - (b.wartelistenPosition ?? 0) || person(a).name.localeCompare(person(b).name, 'de'));
  const anmMap = new Map(anm.map((a) => [a.id, a]));
  const kurstagMap = new Map(d.kurstage.map((k) => [k.id, k]));
  const projekt = projekte.find((p) => p.id === d.projektId);
  const naechster = NAECHSTER[d.status];
  const offenFuerAnmeldung = ['geplant', 'ausgeschrieben', 'bestaetigt'].includes(d.status);
  const titel = d.titel ?? d.kursangebotTitel;

  const aktionenFuer = (a) => {
    const teile = [];
    if (a.status === 'angemeldet') teile.push(html`<button type="button" class="bbz-button bbz-button-sm" data-action="bestaetigen" data-id="${a.id}">Bestätigen</button>`);
    if (['angemeldet', 'bestaetigt', 'warteliste'].includes(a.status)) teile.push(html`<button type="button" class="bbz-button bbz-button-sm bbz-button-danger" data-action="stornieren" data-id="${a.id}">Stornieren</button>`);
    if (['angemeldet', 'bestaetigt', 'teilgenommen', 'nicht_bestanden'].includes(a.status) && ['bestaetigt', 'durchgefuehrt'].includes(d.status)) {
      teile.push(html`<label class="bbz-sr-only" for="tn-${a.id}">Teilnahme ${person(a).name}</label><select id="tn-${a.id}" class="bbz-select bbz-input-sm" data-change="teilnahme" data-id="${a.id}">${optionen([['teilgenommen', 'teilgenommen'], ['abgeschlossen', 'abgeschlossen (Lernnachweis)'], ['nicht_bestanden', 'nicht bestanden']], '', 'Teilnahme …')}</select>`);
    }
    return html`<div class="bbz-row">${teile}</div>`;
  };

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/bildung/durchfuehrungen">Durchführungen</a> ›`,
      titel,
      untertitel: html`${d.code ?? ''} · ${statusChip('durchfuehrungStatus', d.status)} · ${datum(d.startDatum)}${d.endDatum !== d.startDatum ? html` – ${datum(d.endDatum)}` : ''}${d.ort ? html` · ${d.ort}` : ''}`,
      aktionen: html`
        <button type="button" class="bbz-button" data-action="herunterladen" data-pfad="/durchfuehrung/${d.id}/teilnehmerliste" data-datei="teilnehmerliste-${d.code ?? d.id}.csv">Teilnehmerliste CSV</button>
        <button type="button" class="bbz-button" data-action="bearbeiten">Bearbeiten</button>
        ${d.status !== 'abgesagt' && d.status !== 'durchgefuehrt' ? html`<button type="button" class="bbz-button bbz-button-danger" data-action="absagen">Absagen</button>` : ''}
        ${ctx.istAdmin && ['bestaetigt', 'durchgefuehrt'].includes(d.status) ? html`<button type="button" class="bbz-button" data-action="verrechnen">Verrechnen</button>` : ''}
        ${naechster ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="status-weiter">${naechster[1]}</button>` : ''}`,
    })}
    ${bildungTabs('durchfuehrungen')}
    <div class="bbz-kpis" data-testid="belegung">
      ${kpi({ titel: 'Belegung', zahl: html`${d.belegung.aktiv} / ${d.belegung.kapazitaet}`, sub: belegung(d.belegung) })}
      ${kpi({ titel: 'Freie Plätze', zahl: d.belegung.frei, sub: `mindestens ${d.minTeilnehmende} Teilnehmende` })}
      ${kpi({ titel: 'Warteliste', zahl: d.belegung.warteliste, sub: d.belegung.warteliste ? 'rückt bei Storno automatisch nach' : '' })}
      ${kpi({ titel: 'Preis', zahl: chf(d.preisChf ?? angebote.find((a) => a.id === d.kursangebotId)?.preisChf), sub: d.anmeldeschluss ? `Anmeldeschluss ${datum(d.anmeldeschluss)}` : 'ohne Anmeldeschluss' })}
    </div>
    ${!d.projektId ? banner('Kein Projekt (Kostenträger) zugeordnet – Referent:innen-Einsätze und Verrechnung brauchen ein Projekt. Über «Bearbeiten» zuordnen.', 'warning') : ''}
    ${sektion({
      titel: `Teilnehmende (${anm.filter((a) => MIT_PLATZ.includes(a.status)).length})`, untertitel: `${d.belegung.warteliste} auf der Warteliste · ${storniert.length} storniert`, flush: true, testid: 'teilnehmende',
      aktionen: offenFuerAnmeldung ? html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="anmelden">+ Anmeldung erfassen</button>` : '',
      inhalt: tabelle({
        zeilen, leer: 'Noch keine Anmeldungen', beschriftung: 'Teilnehmende',
        spalten: [
          { titel: 'Name', wert: (a) => html`<a class="bbz-link" href="#/crm/kontakt/${a.kontaktId}">${person(a).name}</a><div class="bbz-small bbz-muted">${person(a).organisation ?? ''}</div>` },
          { titel: 'E-Mail', wert: (a) => person(a).email ?? '–' },
          { titel: 'Status', wert: (a) => html`${statusChip('anmeldeStatus', a.status)}${a.wartelistenPosition ? html` <span class="bbz-small">Pos. ${a.wartelistenPosition}</span>` : ''}` },
          { titel: 'Preis', klasse: 'num', wert: (a) => (a.status === 'storniert' ? html`<span title="Annullationskosten">${chf(a.stornogebuehrChf)}</span>` : chf(a.preisChf)) },
          { titel: 'Rechnung an', wert: (a) => html`${agMap.get(a.rechnungsempfaengerId)?.name ?? html`<span class="bbz-warning">offen</span>`}${a.rechnungsreferenz ? html`<div class="bbz-small bbz-muted">Ref. ${a.rechnungsreferenz}</div>` : ''}${a.rechnungId ? html`<div class="bbz-small"><a class="bbz-link" href="#/finanzen/rechnung/${a.rechnungId}">verrechnet</a></div>` : ''}` },
          { titel: '', klasse: 'act', wert: aktionenFuer },
        ],
        karte: (a) => ({ titel: person(a).name, sub: [label('anmeldeStatus', a.status), person(a).organisation].filter(Boolean).join(' · '), rechts: aktionenFuer(a) }),
      }),
    })}
    <div class="bbz-g2">
      ${sektion({
        titel: `Kurstage (${d.kurstage.length})`, flush: true,
        aktionen: html`<button type="button" class="bbz-button bbz-button-sm" data-action="kurstag-neu">+ Kurstag</button>`,
        inhalt: tabelle({
          zeilen: d.kurstage, leer: 'Keine Kurstage – für die Ausschreibung ist mindestens einer nötig.',
          spalten: [
            { titel: 'Datum', klasse: 'nowrap', wert: (k) => html`${datum(k.datum)}${k.von ? html`<div class="bbz-small bbz-muted">${k.von.slice(0, 5)}–${(k.bis ?? '').slice(0, 5)}</div>` : ''}` },
            { titel: 'Thema / Ort', wert: (k) => html`${k.thema ?? '–'}<div class="bbz-small bbz-muted">${k.ort ?? d.ort ?? ''}</div>` },
            { titel: 'Referent:innen', wert: (k) => d.einsaetze.filter((e) => e.kurstagId === k.id && e.status !== 'abgesagt').map((e) => html`<div>${refMap.get(e.referentId)?.anzeigename ?? '–'} <span class="bbz-small bbz-muted">${e.rolle} · ${label('einsatzStatus', e.status)}</span></div>`) },
            { titel: '', klasse: 'act', wert: (k) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="referent" data-id="${k.id}">Referent:in</button>${ctx.istAdmin ? html` <button type="button" class="bbz-icon-btn" data-action="kurstag-loeschen" data-id="${k.id}" aria-label="Kurstag ${datum(k.datum)} löschen">✕</button>` : ''}` },
          ],
        }),
      })}
      ${sektion({ titel: 'Angaben', inhalt: html`<dl class="bbz-dl">
        <dt>Kursangebot</dt><dd>${d.kursangebotCode} · ${d.kursangebotTitel}</dd>
        <dt>Projekt</dt><dd>${projekt ? html`<a class="bbz-link" href="#/projekt/${projekt.id}">${store.projektLabel(projekt)}</a>` : '–'}</dd>
        <dt>Kursleitung</dt><dd>${ma.find((m) => m.id === d.leitungId) ? store.maLabel(ma.find((m) => m.id === d.leitungId)) : '–'}</dd>
        <dt>Öffentlich</dt><dd>${d.oeffentlich ? 'ja (Homepage)' : 'nein'}</dd>
        <dt>Rechnung an</dt><dd>${d.auftraggeberId ? agMap.get(d.auftraggeberId)?.name ?? '–' : 'je Teilnehmer:in (Debitor der Organisation)'}</dd>
        <dt>Moodle-Kurs</dt><dd>${d.moodleKursId ?? '–'}</dd></dl>` })}
    </div>`);

  /* ---------- Aktionen ---------- */
  const fertig = (msg, typ = 'success') => { toast(msg, typ); ctx.neu(); };
  ctx.aktion('status-weiter', async () => {
    const [ziel, text] = naechster;
    if (!(await bestaetigen(`${text}? (${label('durchfuehrungStatus', d.status)} → ${label('durchfuehrungStatus', ziel)})`, { okText: text }))) return;
    await post(`/durchfuehrung/${id}/status`, { status: ziel });
    fertig(`Status: ${label('durchfuehrungStatus', ziel)}`);
  });
  ctx.aktion('absagen', async () => {
    if (!(await bestaetigen('Durchführung absagen? Alle Anmeldungen werden gebührenfrei storniert und Referenten-Einsätze abgesagt.', { okText: 'Absagen', gefahr: true }))) return;
    await post(`/durchfuehrung/${id}/status`, { status: 'abgesagt' });
    fertig('Durchführung abgesagt', 'warning');
  });
  ctx.aktion('bearbeiten', async () => {
    const r = await formModal({
      titel: 'Durchführung bearbeiten', breit: true,
      felder: formGrid(
        feld({ name: 'titel', label: 'Titel (falls abweichend)', wert: d.titel, span2: true }),
        feld({ name: 'startDatum', label: 'Start', typ: 'date', wert: d.startDatum, pflicht: true }),
        feld({ name: 'endDatum', label: 'Ende', typ: 'date', wert: d.endDatum, pflicht: true }),
        feld({ name: 'ort', label: 'Ort', wert: d.ort }),
        feld({ name: 'anmeldeschluss', label: 'Anmeldeschluss', typ: 'date', wert: d.anmeldeschluss }),
        feld({ name: 'kapazitaet', label: 'Kapazität', typ: 'number', wert: d.kapazitaet, attr: { min: 1, step: 1 }, hint: 'Mehr Plätze lassen die Warteliste nachrücken' }),
        feld({ name: 'minTeilnehmende', label: 'Min. Teilnehmende', typ: 'number', wert: d.minTeilnehmende, attr: { min: 0, step: 1 } }),
        feld({ name: 'preisChf', label: 'Preis CHF', typ: 'number', wert: d.preisChf, attr: { min: 0, step: '0.05' } }),
        feld({ name: 'moodleKursId', label: 'Moodle-Kurs-ID', typ: 'number', wert: d.moodleKursId, attr: { min: 1, step: 1 } }),
        feld({ name: 'projektId', label: 'Projekt (Kostenträger)', typ: 'select', optionen: projekte.map((p) => [p.id, store.projektLabel(p)]), wert: d.projektId, leerOption: '– keines –', span2: true }),
        feld({ name: 'auftraggeberId', label: 'Rechnung an (Firmenkurs)', typ: 'select', optionen: ag.map((a) => [a.id, a.name]), wert: d.auftraggeberId, leerOption: '– je Teilnehmer:in –', span2: true }),
        feld({ name: 'leitungId', label: 'Kursleitung', typ: 'select', optionen: store.maOptionen(ma), wert: d.leitungId, leerOption: '– offen –' }),
        feld({ name: 'oeffentlich', label: 'Öffentlich', typ: 'checkbox', wert: d.oeffentlich }),
      ),
      onSubmit: (w) => patch(`/durchfuehrung/${id}`, w),
    });
    if (r) fertig('Durchführung gespeichert');
  });
  ctx.aktion('anmelden', async () => {
    const orgs = await store.organisationen();
    const r = await formModal({
      titel: `Anmeldung: ${titel}`, breit: true, submitText: 'Anmelden', testid: 'anmeldung-form',
      felder: formGrid(
        personWahlFelder({ mitOrganisation: orgs, titel: 'Teilnehmer:in' }),
        feld({ name: 'rechnungsempfaengerId', label: 'Rechnung an', typ: 'select', optionen: ag.map((a) => [a.id, a.name]), leerOption: '– Standard (Debitor der Organisation) –', span2: true }),
        feld({ name: 'rechnungsreferenz', label: 'Rechnungsreferenz', hint: 'z. B. Kostenstelle der Bank' }),
        feld({ name: 'bemerkung', label: 'Bemerkung' }),
      ),
      beimOeffnen: (form) => personWahlVerdrahten(form),
      onSubmit: (w) => post(`/durchfuehrung/${id}/anmeldung`, ohneLeere({ ...personAusWerten(w), rechnungsempfaengerId: w.rechnungsempfaengerId, rechnungsreferenz: w.rechnungsreferenz, bemerkung: w.bemerkung })),
    });
    if (r?.anmeldung) {
      fertig(r.warteliste ? `Auf der Warteliste (Position ${r.anmeldung.wartelistenPosition})` : `Angemeldet${r.kontaktNeu ? ' – Kontakt neu angelegt' : ''}`, r.warteliste ? 'warning' : 'success');
    }
  });
  ctx.aktion('bestaetigen', async (el) => { await post(`/anmeldung/${el.dataset.id}/bestaetigen`); fertig('Anmeldung bestätigt'); });
  ctx.aktion('stornieren', async (el) => {
    const a = anmMap.get(el.dataset.id);
    const r = await formModal({
      titel: `Stornieren: ${person(a).name}`, submitText: 'Stornieren', gefahr: true, testid: 'storno-form',
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">Annullationskosten nach Tagen vor Kursbeginn gemäss AGB (öffentliche Kurse: bis 30 Tage vorher kostenlos, danach 100 %). Warteliste ist gebührenfrei; freie Plätze werden aus der Warteliste nachbesetzt.</p>`,
        feld({ name: 'grund', label: 'Grund', pflicht: true, span2: true }),
        feld({ name: 'datum', label: 'Eingang der Abmeldung', typ: 'date', wert: heute(), pflicht: true }),
        ctx.istAdmin ? feld({ name: 'stornogebuehrChf', label: 'Gebühr manuell (Kulanz)', typ: 'number', hint: 'leer = gemäss Staffel', attr: { min: 0, step: '0.05' } }) : '',
      ),
      onSubmit: (w) => post(`/anmeldung/${a.id}/stornieren`, ohneLeere(w)),
    });
    if (!r?.anmeldung) return;
    const nach = r.nachgerueckt.map((n) => person(n).name || 'Person');
    modal({
      titel: 'Storno erfasst', testid: 'storno-ergebnis',
      inhalt: html`${banner(html`Annullationskosten: <strong data-testid="annullationskosten">${chf(r.anmeldung.stornogebuehrChf ?? 0)}</strong>`, (r.anmeldung.stornogebuehrChf ?? 0) > 0 ? 'warning' : 'success')}
        ${nach.length ? html`<p>Von der Warteliste nachgerückt: <strong>${nach.join(', ')}</strong></p>` : html`<p class="bbz-muted">Niemand ist nachgerückt.</p>`}`,
      fuss: html`<button type="button" class="bbz-button bbz-button-primary" data-modal-close>OK</button>`,
      onClose: () => ctx.neu(),
    });
  });
  ctx.aenderung('teilnahme', async (el) => {
    if (!el.value) return;
    await post(`/anmeldung/${el.dataset.id}/teilnahme`, { status: el.value });
    fertig(el.value === 'abgeschlossen' ? 'Abgeschlossen – Lernnachweis erstellt' : `Teilnahme: ${label('anmeldeStatus', el.value)}`);
  });
  ctx.aktion('kurstag-neu', async () => {
    const r = await formModal({
      titel: 'Kurstag hinzufügen',
      felder: formGrid(
        feld({ name: 'datum', label: 'Datum', typ: 'date', pflicht: true, wert: d.startDatum, attr: { min: d.startDatum, max: d.endDatum } }),
        feld({ name: 'ort', label: 'Ort', wert: d.ort }),
        feld({ name: 'von', label: 'Von', typ: 'time' }),
        feld({ name: 'bis', label: 'Bis', typ: 'time' }),
        feld({ name: 'thema', label: 'Thema', span2: true }),
      ),
      onSubmit: (w) => post(`/durchfuehrung/${id}/kurstag`, ohneLeere(w)),
    });
    if (r) fertig('Kurstag hinzugefügt');
  });
  ctx.aktion('kurstag-loeschen', async (el) => {
    if (!(await bestaetigen(`Kurstag ${datum(kurstagMap.get(el.dataset.id)?.datum)} löschen? Einsätze daran werden mitgelöscht.`, { okText: 'Löschen', gefahr: true }))) return;
    await del(`/kurstag/${el.dataset.id}`);
    fertig('Kurstag gelöscht');
  });
  ctx.aktion('referent', async (el) => {
    const k = kurstagMap.get(el.dataset.id);
    const r = await formModal({
      titel: `Referent:in für ${datum(k.datum)}`, submitText: 'Zuweisen',
      felder: formGrid(
        feld({ name: 'referentId', label: 'Referent:in', typ: 'select', optionen: refs.filter((x) => x.aktiv).map((x) => [x.id, `${x.anzeigename} (${x.typ})`]), leerOption: '– wählen –', pflicht: true, span2: true }),
        feld({ name: 'dauerTage', label: 'Dauer', typ: 'select', optionen: [['1', 'Ganzer Tag'], ['0.5', 'Halber Tag']], wert: '1' }),
        feld({ name: 'rolle', label: 'Rolle', wert: 'Referent' }),
        feld({ name: 'honorarChf', label: 'Honorar CHF', typ: 'number', hint: 'leer = Tages-/Halbtagessatz', attr: { min: 0 } }),
      ),
      onSubmit: (w) => post(`/kurstag/${k.id}/referent`, ohneLeere({ ...w, dauerTage: Number(w.dauerTage) })),
    });
    if (r) fertig('Referent:in eingeplant');
  });
  ctx.aktion('verrechnen', async () => {
    const r = await formModal({
      titel: 'Durchführung verrechnen', submitText: 'Rechnungen erstellen', testid: 'verrechnen-form',
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">Je Rechnungsempfänger ein Rechnungsentwurf im Projekt der Durchführung: Position je Teilnehmer:in bzw. Annullationskosten. Bereits verrechnete Anmeldungen werden übersprungen.</p>`,
        feld({ name: 'datum', label: 'Rechnungsdatum', typ: 'date', wert: heute(), pflicht: true }),
        feld({ name: 'pauschalChf', label: 'Pauschale CHF (Firmenkurs)', typ: 'number', hint: 'eine Pauschalposition an den Auftraggeber der Durchführung', attr: { min: 0, step: '0.05' } }),
      ),
      onSubmit: (w) => post(`/durchfuehrung/${id}/verrechnen`, ohneLeere(w)),
    });
    if (!r) return;
    modal({
      titel: 'Verrechnungslauf', testid: 'verrechnung-ergebnis',
      inhalt: r.rechnungen.length
        ? html`<p>${r.verrechneteAnmeldungen.length} Anmeldungen verrechnet, ${r.rechnungen.length} Rechnungsentwürfe:</p><ul class="bbz-tl">${r.rechnungen.map((x) => html`<li><span class="dot" aria-hidden="true"></span><div><div class="h"><a class="bbz-link" href="#/finanzen/rechnung/${x.id}">${agMap.get(x.auftraggeberId)?.name ?? 'Rechnung'}</a></div><div class="m">${x.positionen.length} Positionen · ${chf(x.totalBrutto)}</div></div></li>`)}</ul>`
        : leerHinweis('Keine offenen Anmeldungen zu verrechnen.'),
      fuss: html`<button type="button" class="bbz-button bbz-button-primary" data-modal-close>OK</button>`,
      onClose: () => ctx.neu(),
    });
  });
}

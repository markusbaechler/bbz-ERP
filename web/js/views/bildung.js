// Bildung: Kursangebote (Katalog), Durchfuehrungen (nach Datum, mit Belegung), Rezertifizierung faellig.
import { get, post, patch } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabs, tabelle, feld, formGrid, formModal, formWerte, ohneLeere, datum, chf, zahl, label, optionenAus, statusChip,
  belegung, chip, heute, addTage, toast, balken, relativTage, personName,
} from '../ui.js';

export const bildungTabs = (aktiv) => tabs([
  { href: '#/bildung/durchfuehrungen', label: 'Durchführungen', aktiv: aktiv === 'durchfuehrungen' },
  { href: '#/bildung/kurse', label: 'Kursangebote', aktiv: aktiv === 'kurse' },
  { href: '#/bildung/rezertifizierung', label: 'Rezertifizierung fällig', aktiv: aktiv === 'rezertifizierung' },
], 'Bildung');


async function kursFormular(k = null) {
  const MWST = await store.mwstOptionen();
  const a = k ?? {};
  return formModal({
    titel: k ? `Kursangebot ${a.code} bearbeiten` : 'Kursangebot erfassen', breit: true, testid: 'kurs-form',
    felder: formGrid(
      feld({ name: 'code', label: 'Code', wert: a.code, pflicht: true, hint: 'Buchstaben, Ziffern, - und _ (Basis der Durchführungsnummer)' }),
      feld({ name: 'bereich', label: 'Bereich', wert: a.bereich, pflicht: true }),
      feld({ name: 'titel', label: 'Titel', wert: a.titel, pflicht: true, span2: true }),
      feld({ name: 'untertitel', label: 'Untertitel', wert: a.untertitel, span2: true }),
      feld({ name: 'format', label: 'Format', typ: 'select', optionen: optionenAus('kursFormat'), wert: a.format ?? 'praesenz' }),
      feld({ name: 'dauerTage', label: 'Dauer (Tage)', typ: 'number', wert: a.dauerTage, attr: { min: 0, step: '0.5' } }),
      feld({ name: 'lernstunden', label: 'Lernstunden', typ: 'number', wert: a.lernstunden, attr: { min: 0, step: '0.5' }, hint: 'zählen für die Rezertifizierung' }),
      feld({ name: 'preisChf', label: 'Preis CHF', typ: 'number', wert: a.preisChf, attr: { min: 0, step: '0.05' } }),
      feld({ name: 'mwstSatz', label: 'MWSt-Satz', typ: 'select', optionen: MWST, wert: String(a.mwstSatz ?? 0) }),
      feld({ name: 'zielgruppe', label: 'Zielgruppe', wert: a.zielgruppe }),
      feld({ name: 'beschreibung', label: 'Beschreibung', typ: 'textarea', wert: a.beschreibung, span2: true }),
      feld({ name: 'lernziele', label: 'Lernziele', typ: 'textarea', wert: a.lernziele, span2: true }),
      feld({ name: 'oeffentlich', label: 'Öffentlich (Homepage)', typ: 'checkbox', wert: a.oeffentlich }),
      feld({ name: 'saqAnerkannt', label: 'SAQ-anerkannt', typ: 'checkbox', wert: a.saqAnerkannt }),
      k ? feld({ name: 'aktiv', label: 'Aktiv', typ: 'checkbox', wert: a.aktiv }) : '',
    ),
    onSubmit: (w) => {
      const daten = { ...w, mwstSatz: Number(w.mwstSatz) };
      return k ? patch(`/kursangebot/${k.id}`, daten) : post('/kursangebot', ohneLeere(daten));
    },
  });
}

export async function kurse(ctx) {
  const liste = await get('/kursangebot', { aktiv: ctx.query.alle === '1' ? undefined : 'true' });
  const kMap = store.nachId(liste);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Kursangebote', untertitel: 'Katalog der offenen Kurse und Firmenkurse', aktionen: html`<button type="button" class="bbz-button bbz-button-primary" data-action="kurs-neu">+ Kursangebot</button>` })}
    ${bildungTabs('kurse')}
    <div class="bbz-row bbz-mb">${ctx.query.alle === '1' ? html`<a class="bbz-button bbz-button-sm" href="#/bildung/kurse">Nur aktive</a>` : html`<a class="bbz-button bbz-button-sm" href="#/bildung/kurse?alle=1">Auch inaktive zeigen</a>`}</div>
    <section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'kurse-tabelle', beschriftung: 'Kursangebote', leer: 'Noch keine Kursangebote',
      spalten: [
        { titel: 'Code', klasse: 'nowrap', wert: (k) => html`<strong>${k.code}</strong>` },
        { titel: 'Titel', wert: (k) => html`${k.titel}${k.untertitel ? html`<div class="bbz-small bbz-muted">${k.untertitel}</div>` : ''}` },
        { titel: 'Bereich', wert: (k) => k.bereich },
        { titel: 'Format', wert: (k) => label('kursFormat', k.format) },
        { titel: 'Tage', klasse: 'num', wert: (k) => zahl(k.dauerTage) },
        { titel: 'Lernstd.', klasse: 'num', wert: (k) => zahl(k.lernstunden) },
        { titel: 'Preis', klasse: 'num', wert: (k) => chf(k.preisChf) },
        { titel: 'MWSt', klasse: 'num', wert: (k) => `${zahl(k.mwstSatz)} %` },
        { titel: 'Merkmale', wert: (k) => html`${k.oeffentlich ? chip('öffentlich', 'blue') : ''}${k.saqAnerkannt ? chip('SAQ', 'green') : ''}${k.aktiv ? '' : chip('inaktiv', 'grey')}` },
        { titel: '', klasse: 'act', wert: (k) => html`<a class="bbz-button bbz-button-sm" href="#/bildung/durchfuehrungen?kursangebotId=${k.id}&von=">Durchführungen</a> <button type="button" class="bbz-button bbz-button-sm" data-action="kurs-bearbeiten" data-id="${k.id}">Bearbeiten</button>` },
      ],
      karte: (k) => ({ titel: `${k.code} · ${k.titel}`, sub: [k.bereich, label('kursFormat', k.format), chf(k.preisChf)].join(' · ') }),
    })}</section>`);
  ctx.aktion('kurs-neu', async () => { if (await kursFormular()) { store.verwerfe('kursangebote'); toast('Kursangebot erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('kurs-bearbeiten', async (el) => { if (await kursFormular(kMap.get(el.dataset.id))) { store.verwerfe('kursangebote'); toast('Gespeichert', 'success'); ctx.neu(); } });
}

export async function durchfuehrungFormular(vor = {}) {
  const [angebote, projekte, ma] = await Promise.all([store.kursangebote(), store.projekte(), store.mitarbeitende()]);
  return formModal({
    titel: 'Durchführung planen', breit: true, testid: 'durchfuehrung-form',
    felder: formGrid(
      feld({ name: 'kursangebotId', label: 'Kursangebot', typ: 'select', optionen: angebote.filter((a) => a.aktiv).map((a) => [a.id, `${a.code} · ${a.titel}`]), wert: vor.kursangebotId, leerOption: '– wählen –', pflicht: true, span2: true }),
      feld({ name: 'startDatum', label: 'Start', typ: 'date', pflicht: true }),
      feld({ name: 'endDatum', label: 'Ende', typ: 'date', pflicht: true, hint: 'Kurstage werden je Werktag erzeugt' }),
      feld({ name: 'ort', label: 'Ort' }),
      feld({ name: 'titel', label: 'Titel (falls abweichend)' }),
      feld({ name: 'kapazitaet', label: 'Kapazität', typ: 'number', wert: 16, attr: { min: 1, step: 1 } }),
      feld({ name: 'minTeilnehmende', label: 'Min. Teilnehmende', typ: 'number', wert: 1, attr: { min: 0, step: 1 } }),
      feld({ name: 'anmeldeschluss', label: 'Anmeldeschluss', typ: 'date' }),
      feld({ name: 'preisChf', label: 'Preis CHF', typ: 'number', hint: 'leer = Preis des Angebots', attr: { min: 0, step: '0.05' } }),
      feld({ name: 'projektId', label: 'Projekt (Kostenträger)', typ: 'select', optionen: projekte.filter((p) => ['laufend', 'offeriert', 'akquise'].includes(p.status)).map((p) => [p.id, store.projektLabel(p)]), leerOption: '– keines –', hint: 'nötig für Referenten-Einsätze und Verrechnung', span2: true }),
      feld({ name: 'leitungId', label: 'Kursleitung', typ: 'select', optionen: store.maOptionen(ma), leerOption: '– offen –' }),
      feld({ name: 'oeffentlich', label: 'Öffentlich ausschreiben', typ: 'checkbox', wert: true }),
    ),
    onSubmit: (w) => post('/durchfuehrung', ohneLeere(w)),
  });
}

export async function durchfuehrungen(ctx) {
  const q = ctx.query;
  const von = q.von === undefined ? addTage(heute(), -14) : q.von;
  const [liste, angebote] = await Promise.all([
    get('/durchfuehrung', { von: von || undefined, bis: q.bis, status: q.status, kursangebotId: q.kursangebotId }),
    store.kursangebote(),
  ]);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Durchführungen', untertitel: 'Termine mit Belegung (aktiv / Kapazität, WL = Warteliste)', aktionen: html`<button type="button" class="bbz-button bbz-button-primary" data-action="df-neu">+ Durchführung</button>` })}
    ${bildungTabs('durchfuehrungen')}
    <form class="bbz-filterbar compact" data-form="filter" aria-label="Durchführungen filtern">
      ${feld({ name: 'von', label: 'Ab Datum', typ: 'date', wert: von, attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'bis', label: 'Bis Datum', typ: 'date', wert: q.bis, attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('durchfuehrungStatus'), wert: q.status, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'kursangebotId', label: 'Kursangebot', typ: 'select', optionen: angebote.map((a) => [a.id, `${a.code} · ${a.titel}`]), wert: q.kursangebotId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'durchfuehrungen-tabelle', beschriftung: 'Durchführungen', leer: 'Keine Durchführungen im gewählten Zeitraum',
      href: (d) => `#/bildung/durchfuehrung/${d.id}`,
      spalten: [
        { titel: 'Datum', klasse: 'nowrap', wert: (d) => html`<a class="bbz-link" href="#/bildung/durchfuehrung/${d.id}">${datum(d.startDatum)}</a>${d.endDatum !== d.startDatum ? html` – ${datum(d.endDatum)}` : ''}` },
        { titel: 'Code', klasse: 'nowrap', wert: (d) => d.code ?? '–' },
        { titel: 'Kurs', wert: (d) => d.titel ?? d.kursangebotTitel },
        { titel: 'Ort', wert: (d) => d.ort ?? '–' },
        { titel: 'Status', wert: (d) => statusChip('durchfuehrungStatus', d.status) },
        { titel: 'Anmeldeschluss', klasse: 'nowrap', wert: (d) => datum(d.anmeldeschluss) },
        { titel: 'Belegung', wert: (d) => belegung(d.belegung) },
      ],
      karte: (d) => ({ titel: d.titel ?? d.kursangebotTitel, sub: `${datum(d.startDatum)} · ${d.ort ?? ''} · ${label('durchfuehrungStatus', d.status)}`, rechts: html`${d.belegung.aktiv}/${d.belegung.kapazitaet}` }),
    })}</section>`);
  const filtern = () => {
    const w = formWerte(ctx.el.querySelector('form[data-form=filter]'));
    const qs = new URLSearchParams(Object.entries({ ...w, von: w.von ?? '' }).filter(([k, v]) => v !== null && (v !== '' || k === 'von'))).toString();
    ctx.navigiere(`/bildung/durchfuehrungen?${qs}`);
  };
  ctx.aenderung('filter', filtern);
  ctx.formular('filter', filtern);
  ctx.aktion('df-neu', async () => {
    const r = await durchfuehrungFormular({ kursangebotId: q.kursangebotId });
    if (r?.id) { toast(`Durchführung ${r.code} geplant`, 'success'); ctx.navigiere(`/bildung/durchfuehrung/${r.id}`); }
  });
}

export async function rezertifizierung(ctx) {
  const monate = ['3', '6', '12', '24'].includes(ctx.query.monate) ? ctx.query.monate : '6';
  const [liste, orgs] = await Promise.all([get('/bildung/rezertifizierung/faellig', { innertMonaten: monate }), store.organisationen()]);
  const orgMap = store.nachId(orgs);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Rezertifizierung fällig', untertitel: 'Aktive Zertifikate, die bald ablaufen und denen Lernstunden fehlen (Vertriebschance)' })}
    ${bildungTabs('rezertifizierung')}
    ${tabs(['3', '6', '12', '24'].map((m) => ({ href: `#/bildung/rezertifizierung?monate=${m}`, label: `innert ${m} Monaten`, aktiv: m === monate })), 'Zeitraum')}
    <section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'rezert-tabelle', beschriftung: 'Fällige Rezertifizierungen', leer: 'Keine fälligen Rezertifizierungen in diesem Zeitraum',
      href: (f) => `#/crm/kontakt/${f.kontakt.id}`,
      spalten: [
        { titel: 'Person', wert: (f) => html`<a class="bbz-link" href="#/crm/kontakt/${f.kontakt.id}">${personName(f.kontakt)}</a><div class="bbz-small bbz-muted">${f.kontakt.email ?? ''}</div>` },
        { titel: 'Organisation', wert: (f) => orgMap.get(f.kontakt.organisationId)?.name ?? '–' },
        { titel: 'Zertifikat', wert: (f) => html`${f.zertifizierung.typ}${f.zertifizierung.zertifikatNr ? html`<div class="bbz-small bbz-muted">${f.zertifizierung.zertifikatNr}</div>` : ''}` },
        { titel: 'Gültig bis', klasse: 'nowrap', wert: (f) => html`${datum(f.gueltigBis)}<div class="bbz-small ${f.tageBisAblauf < 60 ? 'bbz-danger' : 'bbz-muted'}">${relativTage(f.gueltigBis)}</div>` },
        { titel: 'Lernstunden', wert: (f) => html`<div class="bbz-belegung">${balken((f.lernstundenIst / f.lernstundenSoll) * 100, { variante: 'amber' })}<span class="t">${zahl(f.lernstundenIst)}/${zahl(f.lernstundenSoll)}</span></div>` },
        { titel: 'Fehlend', klasse: 'num', wert: (f) => html`<strong>${zahl(f.fehlend)} h</strong>` },
        { titel: '', klasse: 'act', wert: (f) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="aktivitaet-neu" data-kontakt="${f.kontakt.id}">Kontaktieren</button>` },
      ],
      karte: (f) => ({ titel: personName(f.kontakt), sub: `${f.zertifizierung.typ} · bis ${datum(f.gueltigBis)} · fehlend ${zahl(f.fehlend)} h` }),
    })}</section>`);
}


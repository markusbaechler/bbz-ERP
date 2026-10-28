// CRM: Kontakte (Liste/Suche, 360°-Sicht inkl. Anmeldungen, Lernnachweise, Zertifizierungen).
import { get, post, patch } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, sektion, tabelle, feld, formWerte, ladeanzeige, setHtml, entprellen, datum, datumZeit, label, chip, optionenAus,
  chf, zahl, personName, toast, formModal, formGrid, leerHinweis, statusChip, heute, modal, banner, balken,
} from '../ui.js';
import { crmTabs, aufgabenListe, aktivitaetenTimeline, chancenListe } from './teile.js';
import { kontaktFormular, aufgabeFormular } from './formulare.js';

export async function liste(ctx) {
  const [ma, orgs] = await Promise.all([store.mitarbeitende(), store.organisationen()]);
  const orgMap = store.nachId(orgs);
  const q = ctx.query;
  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Kontakte', untertitel: 'Personen bei Banken und Partnern',
      aktionen: html`<button type="button" class="bbz-button" data-action="herunterladen" data-pfad="/kontakt/export/newsletter" data-datei="newsletter-${heute()}.csv">Newsletter-CSV</button>
        <button type="button" class="bbz-button bbz-button-primary" data-action="kontakt-neu">+ Kontakt</button>`,
    })}
    ${crmTabs('kontakte')}
    <form class="bbz-filterbar" data-form="filter" role="search" aria-label="Kontakte filtern">
      <div class="bbz-field bbz-search"><label for="k-suche">Suche</label><input id="k-suche" class="bbz-input" type="search" name="suche" value="${q.suche ?? ''}" placeholder="Name oder E-Mail …" data-input="suche"></div>
      ${feld({ name: 'organisationId', label: 'Organisation', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), wert: q.organisationId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'interesse', label: 'Interesse', typ: 'select', optionen: optionenAus('interesse'), wert: q.interesse, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'betreuerId', label: 'Betreuung', typ: 'select', optionen: store.maOptionen(ma), wert: q.betreuerId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'newsletter', label: 'Newsletter', typ: 'select', optionen: [['true', 'mit Newsletter'], ['false', 'ohne Newsletter']], wert: q.newsletter, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <div id="k-liste">${ladeanzeige()}</div>`);
  const form = ctx.el.querySelector('form[data-form=filter]');
  const ziel = ctx.el.querySelector('#k-liste');
  const lade = async () => {
    const w = formWerte(form);
    ctx.setzeQuery(w);
    const liste = await get('/kontakt', w);
    if (!ctx.aktiv()) return;
    setHtml(ziel, html`<div class="bbz-section"><div class="bbz-section-header"><span class="bbz-section-title">${liste.length} Kontakte</span></div>${tabelle({
      zeilen: liste, testid: 'kontakte-tabelle', beschriftung: 'Kontakte', href: (k) => `#/crm/kontakt/${k.id}`,
      spalten: [
        { titel: 'Name', wert: (k) => html`<a class="bbz-link" href="#/crm/kontakt/${k.id}">${personName(k)}</a>` },
        { titel: 'Organisation', wert: (k) => orgMap.get(k.organisationId)?.name ?? '–' },
        { titel: 'Funktion', wert: (k) => k.funktion ?? '–' },
        { titel: 'E-Mail', wert: (k) => k.email ?? '–' },
        { titel: 'Interessen', wert: (k) => k.interessen.map((i) => chip(label('interesse', i))) },
        { titel: 'Newsletter', wert: (k) => (k.newsletter ? chip('Ja', 'green') : '–') },
      ],
      karte: (k) => ({ titel: personName(k), sub: [orgMap.get(k.organisationId)?.name, k.funktion, k.email].filter(Boolean).join(' · ') }),
    })}</div>`);
  };
  ctx.aenderung('filter', lade);
  ctx.eingabe('suche', entprellen(lade, 250));
  ctx.formular('filter', lade);
  ctx.aktion('kontakt-neu', async () => {
    const r = await kontaktFormular();
    if (r?.id) ctx.navigiere(`/crm/kontakt/${r.id}`);
  });
  await lade();
}

export async function detail(ctx) {
  const id = ctx.params.id;
  const [k, ma] = await Promise.all([get(`/kontakt/${id}`), store.mitarbeitende()]);
  const maMap = store.nachId(ma);
  const lsTotal = k.lernnachweise.reduce((s, l) => s + l.lernstunden, 0);
  const name = [k.titel, personName(k)].filter(Boolean).join(' ');

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/crm/kontakte">Kontakte</a> ›`,
      titel: name,
      untertitel: html`${k.funktion ?? ''}${k.organisation ? html` · <a class="bbz-link" href="#/crm/organisation/${k.organisation.id}">${k.organisation.name}</a>` : ''} ${k.archiviert ? chip('archiviert', 'grey') : ''}`,
      aktionen: html`
        <button type="button" class="bbz-button" data-action="aktivitaet-neu" data-kontakt="${k.id}" data-organisation="${k.organisationId ?? ''}">+ Aktivität</button>
        <button type="button" class="bbz-button" data-action="aufgabe-neu">+ Wiedervorlage</button>
        <button type="button" class="bbz-button bbz-button-primary" data-action="kontakt-bearbeiten">Bearbeiten</button>`,
    })}
    <div class="bbz-g2-wide" data-testid="kontakt-360">
      <div>
        ${sektion({ titel: 'Aktivitäten', inhalt: aktivitaetenTimeline(k.aktivitaeten, { maMap }) })}
        ${sektion({
          titel: `Anmeldungen (${k.anmeldungen.length})`, flush: true,
          inhalt: tabelle({
            zeilen: k.anmeldungen, leer: 'Keine Kursanmeldungen', href: (a) => `#/bildung/durchfuehrung/${a.durchfuehrungId}`,
            spalten: [
              { titel: 'Kurs', wert: (a) => html`<a class="bbz-link" href="#/bildung/durchfuehrung/${a.durchfuehrungId}">${a.titel}</a>` },
              { titel: 'Code', wert: (a) => a.durchfuehrungCode ?? '–' },
              { titel: 'Datum', klasse: 'nowrap', wert: (a) => datum(a.startDatum) },
              { titel: 'Status', wert: (a) => statusChip('anmeldeStatus', a.status) },
              { titel: 'Preis', klasse: 'num', wert: (a) => chf(a.preisChf) },
            ],
          }),
        })}
        ${sektion({
          titel: 'Lernnachweise', untertitel: `Total ${zahl(lsTotal)} Lernstunden`, flush: true,
          aktionen: html`<button type="button" class="bbz-button bbz-button-sm" data-action="lernnachweis-neu">+ Externer Nachweis</button>`,
          inhalt: tabelle({
            zeilen: k.lernnachweise, leer: 'Keine Lernnachweise',
            spalten: [
              { titel: 'Datum', klasse: 'nowrap', wert: (l) => datum(l.datum) },
              { titel: 'Titel', wert: (l) => l.titel },
              { titel: 'Quelle', wert: (l) => chip(l.quelle) },
              { titel: 'Lernstunden', klasse: 'num', wert: (l) => zahl(l.lernstunden) },
            ],
          }),
        })}
        ${sektion({
          titel: 'Zertifizierungen', flush: true,
          aktionen: html`<button type="button" class="bbz-button bbz-button-sm" data-action="zertifikat-neu">+ Zertifikat</button>`,
          inhalt: tabelle({
            zeilen: k.zertifizierungen, leer: 'Keine Zertifizierungen',
            spalten: [
              { titel: 'Typ', wert: (z) => z.typ },
              { titel: 'Nr.', wert: (z) => z.zertifikatNr ?? '–' },
              { titel: 'Gültig', klasse: 'nowrap', wert: (z) => html`${datum(z.ausgestelltAm)} – ${datum(z.gueltigBis)}` },
              { titel: 'Status', wert: (z) => statusChip('zertStatus', z.status) },
              { titel: '', klasse: 'act', wert: (z) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="rezert" data-id="${z.id}">Rezertifizierung</button>` },
            ],
          }),
        })}
      </div>
      <div>
        ${sektion({ titel: 'Kontaktdaten', inhalt: html`<dl class="bbz-dl">
          <dt>E-Mail</dt><dd>${k.email ? html`<a href="mailto:${k.email}">${k.email}</a>` : '–'}${k.email2 ? html`<br>${k.email2}` : ''}</dd>
          <dt>Telefon</dt><dd>${k.telefon ?? '–'}${k.mobile ? html`<br>${k.mobile} (mobil)` : ''}</dd>
          <dt>Abteilung</dt><dd>${k.abteilung ?? '–'}</dd>
          <dt>Sprache</dt><dd>${k.sprache ?? '–'}</dd>
          <dt>Betreuung</dt><dd>${maMap.get(k.betreuerId) ? store.maLabel(maMap.get(k.betreuerId)) : '–'}</dd>
          <dt>Interessen</dt><dd>${k.interessen.length ? k.interessen.map((i) => chip(label('interesse', i), 'blue')) : '–'}</dd>
          <dt>Priorität</dt><dd>${k.prioritaet ?? '–'}</dd>
          <dt>Newsletter</dt><dd>${k.newsletter ? html`Ja · Einwilligung ${datumZeit(k.einwilligungAm)}${k.einwilligungQuelle ? ` (${k.einwilligungQuelle})` : ''}` : 'Nein'}</dd>
          ${k.moodleUserId ? html`<dt>Moodle-ID</dt><dd>${k.moodleUserId}</dd>` : ''}
          ${k.bemerkung ? html`<dt>Bemerkung</dt><dd class="bbz-pre">${k.bemerkung}</dd>` : ''}</dl>` })}
        ${sektion({ titel: 'Aufgaben', inhalt: aufgabenListe(k.aufgaben, { maMap, bezug: false, leer: 'Keine Aufgaben' }) })}
        ${sektion({ titel: 'Verkaufschancen', inhalt: chancenListe(k.verkaufschancen) })}
      </div>
    </div>`);

  ctx.aktion('kontakt-bearbeiten', async () => { if (await kontaktFormular(k)) { toast('Gespeichert', 'success'); ctx.neu(); } });
  ctx.aktion('aufgabe-neu', async () => { if (await aufgabeFormular({ vor: { kontaktId: k.id } })) { toast('Wiedervorlage erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('aufgabe-erledigt', async (el) => { await patch(`/aufgabe/${el.dataset.id}`, { status: 'erledigt' }); toast('Aufgabe erledigt', 'success'); ctx.neu(); });
  ctx.aktion('lernnachweis-neu', async () => {
    const r = await formModal({
      titel: 'Externen Lernnachweis erfassen',
      felder: formGrid(
        feld({ name: 'titel', label: 'Titel', pflicht: true, span2: true }),
        feld({ name: 'datum', label: 'Datum', typ: 'date', wert: heute(), pflicht: true }),
        feld({ name: 'lernstunden', label: 'Lernstunden', typ: 'number', pflicht: true, attr: { min: 0, step: '0.5' } }),
        feld({ name: 'kategorie', label: 'Kategorie', wert: 'weiterbildung' }),
      ),
      onSubmit: (w) => post('/lernnachweis', { ...w, kontaktId: k.id, quelle: 'extern', kategorie: w.kategorie ?? undefined }),
    });
    if (r) { toast('Lernnachweis erfasst', 'success'); ctx.neu(); }
  });
  ctx.aktion('zertifikat-neu', async () => {
    const r = await formModal({
      titel: 'Zertifikat erfassen',
      felder: formGrid(
        feld({ name: 'typ', label: 'Typ', pflicht: true, wert: 'SAQ Kundenberater Bank', span2: true }),
        feld({ name: 'zertifikatNr', label: 'Zertifikat-Nr.' }),
        feld({ name: 'ausgestelltAm', label: 'Ausgestellt am', typ: 'date', pflicht: true, wert: heute() }),
        feld({ name: 'gueltigBis', label: 'Gültig bis', typ: 'date', hint: 'leer = 36 Monate' }),
      ),
      onSubmit: (w) => post('/zertifizierung', { ...w, kontaktId: k.id, gueltigBis: w.gueltigBis ?? undefined }),
    });
    if (r) { toast('Zertifikat erfasst', 'success'); ctx.neu(); }
  });
  ctx.aktion('rezert', async (el) => {
    const r = await get(`/zertifizierung/${el.dataset.id}/rezertifizierung`);
    const p = r.lernstundenSoll ? (r.lernstundenIst / r.lernstundenSoll) * 100 : 0;
    modal({
      titel: `Rezertifizierung: ${r.zertifizierung.typ}`,
      inhalt: html`${r.erfuellt ? banner('Lernstunden-Soll erfüllt.', 'success') : banner(`Es fehlen noch ${zahl(r.fehlend)} Lernstunden.`, r.abgelaufen ? 'error' : 'warning')}
        <div class="bbz-bar-row"><span class="lbl">Lernstunden</span>${balken(p, { variante: r.erfuellt ? 'green' : 'amber' })}<span class="val">${zahl(r.lernstundenIst)} / ${zahl(r.lernstundenSoll)}</span></div>
        <dl class="bbz-dl bbz-mt"><dt>Gültig</dt><dd>${datum(r.ausgestelltAm)} – ${datum(r.gueltigBis)}</dd><dt>Ablauf</dt><dd>${r.abgelaufen ? 'abgelaufen' : `in ${r.tageBisAblauf} Tagen`}</dd></dl>
        ${r.lernnachweise.length ? html`<h3 class="bbz-section-title bbz-mt">Angerechnete Nachweise</h3><ul class="bbz-tl">${r.lernnachweise.map((l) => html`<li><span class="dot" aria-hidden="true"></span><div><div class="h">${l.titel}</div><div class="m">${datum(l.datum)} · ${zahl(l.lernstunden)} Std.</div></div></li>`)}</ul>` : leerHinweis('Keine angerechneten Nachweise')}`,
    });
  });
}

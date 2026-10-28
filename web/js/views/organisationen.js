// CRM: Organisationen (Liste mit Filtern, 360°-Sicht inkl. Debitor-Anlage).
import { get, post, patch } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, sektion, tabelle, feld, formWerte, ladeanzeige, setHtml, entprellen, datum, label, klassPill, chip,
  optionenAus, chf, personName, sichereUrl, toast, formModal, formGrid, balken, leerHinweis, statusChip,
} from '../ui.js';
import { crmTabs, aufgabenListe, aktivitaetenTimeline, chancenListe } from './teile.js';
import { organisationFormular, kontaktFormular, aufgabeFormular, verkaufschanceFormular } from './formulare.js';

export async function liste(ctx) {
  const ma = await store.mitarbeitende();
  const maMap = store.nachId(ma);
  const q = ctx.query;
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Organisationen', untertitel: 'Banken, Partner und Interessenten', aktionen: html`<button type="button" class="bbz-button bbz-button-primary" data-action="org-neu">+ Organisation</button>` })}
    ${crmTabs('organisationen')}
    <form class="bbz-filterbar" data-form="filter" role="search" aria-label="Organisationen filtern">
      <div class="bbz-field bbz-search"><label for="org-suche">Suche</label><input id="org-suche" class="bbz-input" type="search" name="suche" value="${q.suche ?? ''}" placeholder="Name, Ort, Branche …" data-input="suche"></div>
      ${feld({ name: 'kategorie', label: 'Kategorie', typ: 'select', optionen: optionenAus('kategorie'), wert: q.kategorie, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'klassifizierung', label: 'Klassifizierung', typ: 'select', optionen: [...optionenAus('klassifizierung'), ['ohne', 'Ohne']], wert: q.klassifizierung, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'betreuerId', label: 'Betreuung', typ: 'select', optionen: store.maOptionen(ma), wert: q.betreuerId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'inklArchiviert', label: 'inkl. archivierte', typ: 'checkbox', wert: q.inklArchiviert === 'true', attr: { 'data-change': 'filter' } })}
    </form>
    <div id="org-liste">${ladeanzeige()}</div>`);
  const form = ctx.el.querySelector('form[data-form=filter]');
  const ziel = ctx.el.querySelector('#org-liste');
  const lade = async () => {
    const w = formWerte(form);
    ctx.setzeQuery({ ...w, inklArchiviert: w.inklArchiviert ? 'true' : '' });
    const liste = await get('/organisation', { ...w, inklArchiviert: w.inklArchiviert ? 'true' : undefined });
    if (!ctx.aktiv()) return;
    setHtml(ziel, html`<div class="bbz-section"><div class="bbz-section-header"><span class="bbz-section-title">${liste.length} Organisationen</span></div>${tabelle({
      zeilen: liste, testid: 'organisationen-tabelle', beschriftung: 'Organisationen',
      href: (o) => `#/crm/organisation/${o.id}`,
      spalten: [
        { titel: 'Name', wert: (o) => html`<a class="bbz-link" href="#/crm/organisation/${o.id}">${o.name}</a> ${o.vip ? html`<span class="bbz-pill bbz-pill-vip">VIP</span>` : ''}${o.archiviert ? chip('archiviert', 'grey') : ''}` },
        { titel: 'Ort', wert: (o) => [o.plz, o.ort].filter(Boolean).join(' ') || '–' },
        { titel: 'Kategorie', wert: (o) => label('kategorie', o.kategorie) },
        { titel: 'Klassifizierung', wert: (o) => klassPill(o.klassifizierung) || html`<span class="bbz-muted">ohne</span>` },
        { titel: 'Kontakte', klasse: 'num', wert: (o) => o.kontakteAnzahl },
        { titel: 'Letzte Aktivität', klasse: 'nowrap', wert: (o) => datum(o.letzteAktivitaet) },
        { titel: 'Betreuung', wert: (o) => maMap.get(o.betreuerId)?.kuerzel ?? '–' },
      ],
      karte: (o) => ({ titel: o.name, sub: [o.ort, label('kategorie', o.kategorie), `${o.kontakteAnzahl} Kontakte`].filter(Boolean).join(' · '), rechts: klassPill(o.klassifizierung) }),
    })}</div>`);
  };
  ctx.aenderung('filter', lade);
  ctx.eingabe('suche', entprellen(lade, 250));
  ctx.formular('filter', lade);
  ctx.aktion('org-neu', async () => {
    const r = await organisationFormular();
    if (r?.id) ctx.navigiere(`/crm/organisation/${r.id}`);
  });
  await lade();
}

export async function detail(ctx) {
  const id = ctx.params.id;
  const [o, ma] = await Promise.all([get(`/organisation/${id}`), store.mitarbeitende()]);
  const maMap = store.nachId(ma);
  const saldo = o.auftraggeber ? await get(`/auftraggeber/${o.auftraggeber.id}/saldo`) : null;
  const kontaktMap = store.nachId(o.kontakte);
  const maxUmsatz = Math.max(1, ...o.umsatzProJahr.map((u) => u.nettoChf));
  const web = sichereUrl(o.website);

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/crm/organisationen">Organisationen</a> ›`,
      titel: o.name,
      untertitel: html`${label('kategorie', o.kategorie)} ${klassPill(o.klassifizierung)} ${o.vip ? html`<span class="bbz-pill bbz-pill-vip">VIP</span>` : ''} ${o.archiviert ? chip('archiviert', 'grey') : ''} ${o.ort ? html`· ${o.ort}` : ''}`,
      aktionen: html`
        <button type="button" class="bbz-button" data-action="aktivitaet-neu" data-organisation="${o.id}">+ Aktivität</button>
        <button type="button" class="bbz-button" data-action="aufgabe-neu">+ Wiedervorlage</button>
        <button type="button" class="bbz-button" data-action="chance-neu">+ Verkaufschance</button>
        <button type="button" class="bbz-button bbz-button-primary" data-action="org-bearbeiten">Bearbeiten</button>`,
    })}
    <div class="bbz-g2-wide" data-testid="organisation-360">
      <div>
        ${sektion({
          titel: `Kontakte (${o.kontakte.length})`, aktionen: html`<button type="button" class="bbz-button bbz-button-sm" data-action="kontakt-neu">+ Kontakt</button>`, flush: true,
          inhalt: tabelle({
            zeilen: o.kontakte, leer: 'Noch keine Kontakte', href: (k) => `#/crm/kontakt/${k.id}`,
            spalten: [
              { titel: 'Name', wert: (k) => html`<a class="bbz-link" href="#/crm/kontakt/${k.id}">${personName(k)}</a>` },
              { titel: 'Funktion', wert: (k) => k.funktion ?? '–' },
              { titel: 'E-Mail', wert: (k) => (k.email ? html`<a href="mailto:${k.email}">${k.email}</a>` : '–') },
              { titel: 'Telefon', klasse: 'nowrap', wert: (k) => k.telefon ?? k.mobile ?? '–' },
            ],
          }),
        })}
        ${sektion({ titel: 'Aktivitäten', untertitel: 'die letzten 20, auch an Kontakten', inhalt: aktivitaetenTimeline(o.aktivitaeten, { maMap, kontaktMap }) })}
        ${sektion({ titel: `Offene Aufgaben (${o.offeneAufgaben.length})`, inhalt: aufgabenListe(o.offeneAufgaben, { maMap }) })}
      </div>
      <div>
        ${sektion({ titel: 'Stammdaten', inhalt: html`<dl class="bbz-dl">
          <dt>Adresse</dt><dd>${[o.strasse, [o.plz, o.ort].filter(Boolean).join(' '), o.land].filter(Boolean).join(', ') || '–'}</dd>
          <dt>Branche</dt><dd>${o.branche ?? '–'}</dd>
          <dt>Telefon</dt><dd>${o.telefon ?? '–'}</dd>
          <dt>E-Mail</dt><dd>${o.email ? html`<a href="mailto:${o.email}">${o.email}</a>` : '–'}</dd>
          <dt>Website</dt><dd>${web ? html`<a href="${web}" target="_blank" rel="noopener noreferrer">${o.website}</a>` : (o.website ?? '–')}</dd>
          <dt>Betreuung</dt><dd>${maMap.get(o.betreuerId) ? store.maLabel(maMap.get(o.betreuerId)) : '–'}</dd>
          ${o.bemerkung ? html`<dt>Bemerkung</dt><dd class="bbz-pre">${o.bemerkung}</dd>` : ''}</dl>` })}
        ${sektion({
          titel: 'Debitor (Verrechnung)', testid: 'debitor',
          aktionen: o.auftraggeber ? '' : html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="debitor-anlegen">Als Debitor anlegen</button>`,
          inhalt: o.auftraggeber
            ? html`<dl class="bbz-dl"><dt>Debitor</dt><dd>${o.auftraggeber.name}${o.auftraggeber.nummer ? ` (${o.auftraggeber.nummer})` : ''}</dd>
                <dt>Rechnungsadresse</dt><dd>${o.auftraggeber.strasse}, ${o.auftraggeber.plz} ${o.auftraggeber.ort}</dd>
                <dt>Saldo offen</dt><dd><strong>${chf(saldo?.saldo)}</strong> · <a class="bbz-link" href="#/finanzen/rechnungen?auftraggeberId=${o.auftraggeber.id}">Rechnungen</a></dd></dl>`
            : leerHinweis('Noch kein Debitor verknüpft. Für Projekte und Rechnungen ist eine vollständige Adresse nötig (QR-Rechnung).'),
        })}
        ${sektion({ titel: `Verkaufschancen (${o.verkaufschancen.length})`, inhalt: chancenListe(o.verkaufschancen) })}
        ${sektion({
          titel: `Projekte (${o.projekte.length})`,
          inhalt: o.projekte.length ? html`<ul class="bbz-tl">${o.projekte.map((p) => html`<li><span class="dot" aria-hidden="true"></span><div><div class="h"><a class="bbz-link" href="#/projekt/${p.id}">${p.nummer} ${p.name}</a></div><div class="m">${statusChip('projektStatus', p.status)}${p.bereich ? ` · ${p.bereich}` : ''}</div></div></li>`)}</ul>` : leerHinweis('Keine Projekte'),
        })}
        ${sektion({
          titel: 'Umsatz je Jahr', untertitel: 'festgeschriebene Rechnungen, netto',
          inhalt: o.umsatzProJahr.length ? html`${o.umsatzProJahr.map((u) => html`<div class="bbz-bar-row"><span class="lbl">${u.jahr}</span>${balken((u.nettoChf / maxUmsatz) * 100, { variante: 'green', label: `${u.jahr}: ${chf(u.nettoChf)}` })}<span class="val">${chf(u.nettoChf)}</span></div>`)}` : leerHinweis('Noch kein Umsatz'),
        })}
      </div>
    </div>`);

  ctx.aktion('org-bearbeiten', async () => { if (await organisationFormular(o)) { toast('Gespeichert', 'success'); ctx.neu(); } });
  ctx.aktion('kontakt-neu', async () => { const r = await kontaktFormular(null, { organisationId: o.id }); if (r) { toast('Kontakt erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('aufgabe-neu', async () => { if (await aufgabeFormular({ vor: { organisationId: o.id } })) { toast('Wiedervorlage erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('chance-neu', async () => { if (await verkaufschanceFormular(null, { organisationId: o.id })) { toast('Verkaufschance erfasst', 'success'); ctx.neu(); } });
  ctx.aktion('aufgabe-erledigt', async (el) => { await patch(`/aufgabe/${el.dataset.id}`, { status: 'erledigt' }); toast('Aufgabe erledigt', 'success'); ctx.neu(); });
  ctx.aktion('debitor-anlegen', async () => {
    const r = await formModal({
      titel: 'Als Debitor anlegen', submitText: 'Debitor anlegen',
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">Der Debitor übernimmt Name und Adresse der Organisation. Für die QR-Rechnung sind Strasse, PLZ und Ort Pflicht.</p>`,
        feld({ name: 'nummer', label: 'Debitorennummer', hint: 'optional, z. B. aus der Buchhaltung' }),
      ),
      onSubmit: (w) => post(`/organisation/${o.id}/auftraggeber`, { nummer: w.nummer ?? undefined }),
    });
    if (r) { store.verwerfe('auftraggeber'); toast('Debitor angelegt', 'success'); ctx.neu(); }
  });
}

// CRM: Anfragen-Eingang (Homepage, E-Mail, Telefon). Uebernehmen -> Kontakt (+ Organisation, + Verkaufschance), Verwerfen.
import { get, post } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabs, feld, formGrid, formModal, datumZeit, label, optionenAus, statusChip, toast, leerHinweis, eingabe, ohneLeere,
} from '../ui.js';
import { crmTabs } from './teile.js';

const FILTER = {
  offen: { label: 'Offen', status: 'neu,in_bearbeitung' },
  uebernommen: { label: 'Übernommen', status: 'uebernommen' },
  verworfen: { label: 'Verworfen', status: 'verworfen' },
  alle: { label: 'Alle', status: undefined },
};

export async function anfragen(ctx) {
  const ansicht = Object.hasOwn(FILTER, ctx.query.status ?? '') ? ctx.query.status : 'offen';
  const [liste, offen] = await Promise.all([
    get('/anfrage', { status: FILTER[ansicht].status, limit: 200 }),
    ansicht === 'offen' ? Promise.resolve(null) : get('/anfrage', { status: FILTER.offen.status, limit: 200 }),
  ]);
  const anzahlOffen = (offen ?? liste).length;
  const amap = new Map(liste.map((a) => [a.id, a]));

  const karte = (a) => {
    const name = [a.anrede, a.vorname, a.nachname].filter(Boolean).join(' ') || '(ohne Namen)';
    const istOffen = ['neu', 'in_bearbeitung'].includes(a.status);
    return html`<article class="bbz-section" data-testid="anfrage">
      <div class="bbz-section-header"><div><h2 class="bbz-section-title">${name} ${statusChip('anfrageStatus', a.status)}</h2>
        <div class="bbz-section-subtitle">${label('anfrageTyp', a.typ)} via ${label('anfrageQuelle', a.quelle)} · ${datumZeit(a.eingegangenAm)}</div></div>
        <div class="bbz-section-actions">${istOffen ? html`
          <button type="button" class="bbz-button bbz-button-sm" data-action="verwerfen" data-id="${a.id}">Verwerfen</button>
          <button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="uebernehmen" data-id="${a.id}">Übernehmen</button>` : ''}
          ${a.kontaktId ? html`<a class="bbz-button bbz-button-sm" href="#/crm/kontakt/${a.kontaktId}">Kontakt</a>` : ''}</div></div>
      <div class="bbz-section-body"><dl class="bbz-dl">
        ${a.organisationName ? html`<dt>Organisation</dt><dd>${a.organisationName}</dd>` : ''}
        ${a.funktion ? html`<dt>Funktion</dt><dd>${a.funktion}</dd>` : ''}
        ${a.email ? html`<dt>E-Mail</dt><dd><a href="mailto:${a.email}">${a.email}</a></dd>` : ''}
        ${a.telefon ? html`<dt>Telefon</dt><dd>${a.telefon}</dd>` : ''}
        ${a.interesse ? html`<dt>Interesse</dt><dd>${label('interesse', a.interesse)}</dd>` : ''}
        <dt>Newsletter</dt><dd>${a.newsletter ? (a.einwilligung ? 'Ja, mit Einwilligung' : 'Ja, ohne Einwilligung') : 'Nein'}</dd>
        ${a.nachricht ? html`<dt>Nachricht</dt><dd class="bbz-pre">${a.nachricht}</dd>` : ''}
        ${a.payload?.verwerfgrund ? html`<dt>Verwerfgrund</dt><dd>${a.payload.verwerfgrund}</dd>` : ''}
      </dl>
      ${Object.keys(a.payload ?? {}).length ? html`<details class="bbz-mt"><summary class="bbz-small bbz-muted">Rohdaten des Formulars</summary><pre class="bbz-mono bbz-pre">${JSON.stringify(a.payload, null, 2)}</pre></details>` : ''}
      </div></article>`;
  };

  ctx.zeige(html`
    ${seitenkopf({ titel: 'Anfragen-Eingang', untertitel: `${anzahlOffen} offene Anfragen`, aktionen: html`<button type="button" class="bbz-button bbz-button-primary" data-action="anfrage-neu">+ Anfrage erfassen</button>` })}
    ${crmTabs('anfragen')}
    ${tabs(Object.entries(FILTER).map(([k, f]) => ({ href: `#/crm/anfragen?status=${k}`, label: f.label, aktiv: k === ansicht, anzahl: k === 'offen' ? anzahlOffen : undefined })), 'Anfragen nach Status')}
    <div data-testid="anfragen-liste">${liste.length ? liste.map(karte) : leerHinweis('Keine Anfragen in dieser Ansicht')}</div>`);

  ctx.aktion('anfrage-neu', async () => {
    const r = await formModal({
      titel: 'Anfrage erfassen (Telefon, E-Mail, Event)', breit: true,
      felder: formGrid(
        feld({ name: 'quelle', label: 'Quelle', typ: 'select', optionen: optionenAus('anfrageQuelle').filter(([k]) => k !== 'homepage' && k !== 'import'), wert: 'telefon' }),
        feld({ name: 'typ', label: 'Typ', typ: 'select', optionen: optionenAus('anfrageTyp'), wert: 'kontakt' }),
        feld({ name: 'anrede', label: 'Anrede', typ: 'select', optionen: ['Frau', 'Herr', 'Divers'], leerOption: '–' }),
        feld({ name: 'organisationName', label: 'Organisation' }),
        feld({ name: 'vorname', label: 'Vorname' }),
        feld({ name: 'nachname', label: 'Nachname' }),
        feld({ name: 'email', label: 'E-Mail', typ: 'email', hint: 'E-Mail oder Telefon ist Pflicht' }),
        feld({ name: 'telefon', label: 'Telefon', typ: 'tel' }),
        feld({ name: 'funktion', label: 'Funktion' }),
        feld({ name: 'interesse', label: 'Interesse', typ: 'select', optionen: optionenAus('interesse'), leerOption: '–' }),
        feld({ name: 'nachricht', label: 'Nachricht / Notiz', typ: 'textarea', span2: true }),
        feld({ name: 'newsletter', label: 'Newsletter gewünscht', typ: 'checkbox' }),
        feld({ name: 'einwilligung', label: 'Einwilligung liegt vor (nDSG)', typ: 'checkbox' }),
      ),
      onSubmit: (w) => post('/anfrage', ohneLeere(w)),
    });
    if (r) { toast('Anfrage erfasst', 'success'); ctx.neu(); }
  });

  ctx.aktion('verwerfen', async (el) => {
    const a = amap.get(el.dataset.id);
    const grund = await eingabe({ titel: 'Anfrage verwerfen', label: 'Grund (optional)', pflicht: false, submitText: 'Verwerfen' });
    if (grund === null) return;
    await post(`/anfrage/${a.id}/verwerfen`, { grund: grund || undefined });
    toast('Anfrage verworfen', 'success');
    ctx.neu();
  });

  ctx.aktion('uebernehmen', async (el) => {
    const a = amap.get(el.dataset.id);
    const orgs = await store.organisationen();
    const treffer = a.organisationName ? orgs.find((o) => o.name.toLowerCase() === a.organisationName.toLowerCase()) : null;
    const modus = treffer ? 'bestehend' : a.organisationName ? 'neu' : 'keine';
    const r = await formModal({
      titel: 'Anfrage übernehmen', submitText: 'Übernehmen', breit: true, testid: 'uebernehmen-form',
      felder: formGrid(
        feld({ name: 'orgModus', label: 'Organisation', typ: 'radio', optionen: [['bestehend', 'Bestehende'], ['neu', 'Neu anlegen'], ['keine', 'Keine']], wert: modus, span2: true }),
        feld({ name: 'organisationId', label: 'Bestehende Organisation', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), wert: treffer?.id, leerOption: '– wählen –' }),
        feld({ name: 'orgName', label: 'Neue Organisation: Name', wert: a.organisationName }),
        html`<p class="bbz-span-2 bbz-small bbz-muted">Kontakt: Dublettenschutz über die E-Mail – ein bestehender Kontakt wird nur ergänzt.</p>`,
        feld({ name: 'vorname', label: 'Vorname', wert: a.vorname }),
        feld({ name: 'nachname', label: 'Nachname', wert: a.nachname, pflicht: !a.nachname }),
        feld({ name: 'mitChance', label: 'Verkaufschance anlegen', typ: 'checkbox', wert: ['offerte', 'tailormade'].includes(a.typ), span2: true }),
        feld({ name: 'vcTitel', label: 'Titel der Chance', wert: `Anfrage ${label('anfrageTyp', a.typ)}${a.organisationName ? `: ${a.organisationName}` : ''}` }),
        feld({ name: 'vcWert', label: 'Wert (CHF)', typ: 'number', attr: { min: 0 } }),
      ),
      onSubmit: (w) => {
        const body = { kontakt: ohneLeere({ vorname: w.vorname, nachname: w.nachname }) };
        if (w.orgModus === 'bestehend') {
          if (!w.organisationId) throw new Error('Bitte eine bestehende Organisation wählen.');
          body.organisationId = w.organisationId;
        } else if (w.orgModus === 'neu') {
          if (!w.orgName) throw new Error('Bitte den Namen der neuen Organisation angeben.');
          body.organisationNeu = { name: w.orgName };
        }
        if (w.mitChance) {
          if (w.orgModus === 'keine') throw new Error('Eine Verkaufschance braucht eine Organisation.');
          body.verkaufschance = ohneLeere({ titel: w.vcTitel, wertChf: w.vcWert });
        }
        return post(`/anfrage/${a.id}/uebernehmen`, body);
      },
    });
    if (r?.kontakt) {
      store.verwerfe('organisationen');
      toast(r.kontaktNeu ? 'Anfrage übernommen – Kontakt neu angelegt' : 'Anfrage übernommen – bestehender Kontakt ergänzt', 'success');
      ctx.navigiere(`/crm/kontakt/${r.kontakt.id}`);
    }
  });
}

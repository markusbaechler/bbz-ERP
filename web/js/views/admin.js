// Admin (nur Rolle admin): Mitarbeitende, API-Clients (Schluessel einmalig), Webhooks (Secret einmalig),
// Outbox-Monitor, Integrationslaeufe, Moodle-Status.
import { get, post, patch, del, ApiFehler } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, tabs, sektion, tabelle, feld, formGrid, formModal, ohneLeere, datumZeit, chf, optionenAus, statusChip,
  chip, banner, toast, bestaetigen, geheimnisAnzeigen, personName, kpi,
} from '../ui.js';

const BEREICHE = [
  ['mitarbeitende', 'Mitarbeitende'], ['api-clients', 'API-Clients'], ['webhooks', 'Webhooks'], ['outbox', 'Outbox'],
  ['integration', 'Integrationsläufe'], ['moodle', 'Moodle'],
];
const SCOPES = ['public:read', 'public:anmeldung', 'public:anfrage', 'public:formular', 'moodle:events'];
const EREIGNISSE = ['*', 'kurs.aktualisiert', 'anmeldung.eingegangen', 'anmeldung.bestaetigt', 'anmeldung.storniert', 'anmeldung.warteliste', 'anmeldung.nachgerueckt', 'saq.angemeldet', 'test.ping'];

export async function admin(ctx) {
  const bereich = BEREICHE.some(([k]) => k === ctx.params.bereich) ? ctx.params.bereich : 'mitarbeitende';
  const inhalt = await TEILE[bereich](ctx);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Administration', untertitel: 'Stammdaten, Schnittstellen und Betrieb' })}
    ${tabs(BEREICHE.map(([k, l]) => ({ href: `#/admin/${k}`, label: l, aktiv: k === bereich })), 'Administration')}
    <div data-testid="admin-${bereich}">${inhalt}</div>`);
}

const TEILE = {
  async mitarbeitende(ctx) {
    const liste = await get('/mitarbeitende');
    const map = store.nachId(liste);
    const formular = (m = null) => formModal({
      titel: m ? `${m.kuerzel} bearbeiten` : 'Mitarbeitende erfassen', breit: true,
      felder: formGrid(
        m ? '' : feld({ name: 'kuerzel', label: 'Kürzel', pflicht: true, attr: { pattern: '[A-Za-z]{2,4}', maxlength: 4 }, hint: '2–4 Buchstaben' }),
        feld({ name: 'rolle', label: 'Rolle', typ: 'select', optionen: [['standard', 'Standard'], ['admin', 'Admin']], wert: m?.rolle ?? 'standard' }),
        feld({ name: 'vorname', label: 'Vorname', wert: m?.vorname }),
        feld({ name: 'nachname', label: 'Nachname', wert: m?.nachname, pflicht: true }),
        feld({ name: 'email', label: 'E-Mail (Entra-Konto)', typ: 'email', wert: m?.email, span2: true }),
        feld({ name: 'stundensatzIntern', label: 'Stundensatz intern', typ: 'number', wert: m?.stundensatzIntern, attr: { min: 0 } }),
        feld({ name: 'stundensatzVerrechnung', label: 'Verrechnungssatz', typ: 'number', wert: m?.stundensatzVerrechnung, attr: { min: 0 }, hint: 'Default-Ansatz in der Zeiterfassung' }),
        m ? feld({ name: 'aktiv', label: 'Aktiv', typ: 'checkbox', wert: m.aktiv }) : '',
      ),
      onSubmit: (w) => (m ? patch(`/mitarbeitende/${m.id}`, w) : post('/mitarbeitende', ohneLeere(w))),
    });
    const fertig = (msg) => { store.verwerfe('mitarbeitende'); toast(msg, 'success'); ctx.neu(); };
    ctx.aktion('ma-neu', async () => { if (await formular()) fertig('Mitarbeitende erfasst'); });
    ctx.aktion('ma-bearbeiten', async (el) => { if (await formular(map.get(el.dataset.id))) fertig('Gespeichert'); });
    return sektion({
      titel: `Mitarbeitende (${liste.length})`, flush: true, aktionen: html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="ma-neu">+ Mitarbeitende</button>`,
      inhalt: tabelle({
        zeilen: liste, beschriftung: 'Mitarbeitende',
        spalten: [
          { titel: 'Kürzel', wert: (m) => html`<strong>${m.kuerzel}</strong>` },
          { titel: 'Name', wert: (m) => personName(m) },
          { titel: 'E-Mail', wert: (m) => m.email ?? '–' },
          { titel: 'Rolle', wert: (m) => (m.rolle === 'admin' ? chip('Admin', 'blue') : chip('Standard')) },
          { titel: 'Satz intern', klasse: 'num', wert: (m) => chf(m.stundensatzIntern) },
          { titel: 'Verrechnung', klasse: 'num', wert: (m) => chf(m.stundensatzVerrechnung) },
          { titel: 'Entra', wert: (m) => (m.entraOid ? chip('verknüpft', 'green') : '–') },
          { titel: 'Status', wert: (m) => (m.aktiv ? chip('aktiv', 'green') : chip('inaktiv', 'grey')) },
          { titel: '', klasse: 'act', wert: (m) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="ma-bearbeiten" data-id="${m.id}">Bearbeiten</button>` },
        ],
      }),
    });
  },

  async 'api-clients'(ctx) {
    const liste = await get('/admin/api-clients');
    const map = store.nachId(liste);
    ctx.aktion('client-neu', async () => {
      const r = await formModal({
        titel: 'API-Client erfassen', testid: 'client-form',
        felder: formGrid(
          feld({ name: 'name', label: 'Name', pflicht: true, span2: true, hint: 'z. B. Homepage, Zapier, Moodle-Events' }),
          feld({ name: 'scopes', label: 'Berechtigungen (Scopes)', typ: 'checkboxes', optionen: SCOPES, wert: ['public:read'], span2: true }),
          feld({ name: 'origins', label: 'Erlaubte Origins (CORS)', typ: 'textarea', span2: true, hint: 'eine pro Zeile, ohne Pfad, z. B. https://www.bankenberatungszentrum.ch' }),
        ),
        onSubmit: (w) => post('/admin/api-clients', { name: w.name, scopes: w.scopes ?? [], erlaubteOrigins: (w.origins ?? '').split(/\s+/).filter(Boolean) }),
      });
      if (r?.schluessel) {
        await geheimnisAnzeigen({ titel: `API-Schlüssel für ${r.client.name}`, text: 'Der Schlüssel wird nur gehasht gespeichert und kann später nicht mehr angezeigt werden.', geheimnis: r.schluessel });
        ctx.neu();
      }
    });
    ctx.aktion('client-rotieren', async (el) => {
      const c = map.get(el.dataset.id);
      if (!(await bestaetigen(`Schlüssel von «${c.name}» rotieren? Der bisherige Schlüssel ist sofort ungültig.`, { okText: 'Rotieren', gefahr: true }))) return;
      const r = await post(`/admin/api-clients/${c.id}/rotieren`);
      await geheimnisAnzeigen({ titel: `Neuer Schlüssel für ${c.name}`, text: 'Bitte jetzt in der Homepage/Zapier hinterlegen.', geheimnis: r.schluessel });
      ctx.neu();
    });
    ctx.aktion('client-aktiv', async (el) => {
      const c = map.get(el.dataset.id);
      await patch(`/admin/api-clients/${c.id}`, { aktiv: !c.aktiv });
      toast(c.aktiv ? 'Client deaktiviert' : 'Client aktiviert', 'success');
      ctx.neu();
    });
    return sektion({
      titel: `API-Clients (${liste.length})`, untertitel: 'Schlüssel für Homepage-API, Formular-Eingang und Moodle-Events', flush: true,
      aktionen: html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="client-neu">+ API-Client</button>`,
      inhalt: tabelle({
        zeilen: liste, leer: 'Keine API-Clients', beschriftung: 'API-Clients',
        spalten: [
          { titel: 'Name', wert: (c) => html`<strong>${c.name}</strong>` },
          { titel: 'Präfix', wert: (c) => html`<span class="bbz-mono">${c.keyPrefix}…</span>` },
          { titel: 'Scopes', wert: (c) => c.scopes.map((s) => chip(s, 'blue')) },
          { titel: 'Origins', wert: (c) => (c.erlaubteOrigins.length ? c.erlaubteOrigins.join(', ') : '–') },
          { titel: 'Zuletzt genutzt', klasse: 'nowrap', wert: (c) => datumZeit(c.zuletztGenutztAm) },
          { titel: 'Status', wert: (c) => (c.aktiv ? chip('aktiv', 'green') : chip('inaktiv', 'grey')) },
          { titel: '', klasse: 'act', wert: (c) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="client-rotieren" data-id="${c.id}">Rotieren</button> <button type="button" class="bbz-button bbz-button-sm" data-action="client-aktiv" data-id="${c.id}">${c.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>` },
        ],
      }),
    });
  },

  async webhooks(ctx) {
    const liste = await get('/admin/webhooks');
    const map = store.nachId(liste);
    ctx.aktion('hook-neu', async () => {
      const r = await formModal({
        titel: 'Webhook-Abo erfassen',
        felder: formGrid(
          feld({ name: 'name', label: 'Name', pflicht: true }),
          feld({ name: 'url', label: 'URL', typ: 'url', pflicht: true, hint: 'muss mit https:// beginnen' }),
          feld({ name: 'ereignisse', label: 'Ereignisse', typ: 'checkboxes', optionen: EREIGNISSE, wert: ['anmeldung.eingegangen'], span2: true }),
        ),
        onSubmit: (w) => post('/admin/webhooks', { name: w.name, url: w.url, ereignisse: w.ereignisse ?? [] }),
      });
      if (r?.secret) {
        await geheimnisAnzeigen({ titel: 'Webhook-Secret', text: 'Der Empfänger prüft damit die Signatur x-bbz-signature (HMAC-SHA256).', geheimnis: r.secret });
        ctx.neu();
      }
    });
    ctx.aktion('hook-aktiv', async (el) => {
      const h = map.get(el.dataset.id);
      await patch(`/admin/webhooks/${h.id}`, { aktiv: !h.aktiv });
      toast(h.aktiv ? 'Webhook deaktiviert' : 'Webhook aktiviert', 'success');
      ctx.neu();
    });
    ctx.aktion('hook-loeschen', async (el) => {
      const h = map.get(el.dataset.id);
      if (!(await bestaetigen(`Webhook «${h.name}» löschen?`, { okText: 'Löschen', gefahr: true }))) return;
      await del(`/admin/webhooks/${h.id}`);
      toast('Webhook gelöscht', 'success');
      ctx.neu();
    });
    ctx.aktion('hook-test', async () => { const r = await post('/admin/webhooks/test'); toast(`Test-Ereignis in der Outbox (#${r.outboxId})`, 'success'); });
    return sektion({
      titel: `Webhook-Abos (${liste.length})`, untertitel: 'Ausgehende Ereignisse, signiert mit HMAC', flush: true,
      aktionen: html`<button type="button" class="bbz-button bbz-button-sm" data-action="hook-test">Test-Ereignis senden</button> <button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="hook-neu">+ Webhook</button>`,
      inhalt: tabelle({
        zeilen: liste, leer: 'Keine Webhook-Abos', beschriftung: 'Webhooks',
        spalten: [
          { titel: 'Name', wert: (h) => html`<strong>${h.name}</strong>` },
          { titel: 'URL', wert: (h) => html`<span class="bbz-mono">${h.url}</span>` },
          { titel: 'Ereignisse', wert: (h) => h.ereignisse.map((e) => chip(e)) },
          { titel: 'Status', wert: (h) => (h.aktiv ? chip('aktiv', 'green') : chip('inaktiv', 'grey')) },
          { titel: '', klasse: 'act', wert: (h) => html`<button type="button" class="bbz-button bbz-button-sm" data-action="hook-aktiv" data-id="${h.id}">${h.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button> <button type="button" class="bbz-button bbz-button-sm bbz-button-danger" data-action="hook-loeschen" data-id="${h.id}" aria-label="Webhook ${h.name} löschen">✕</button>` },
        ],
      }),
    });
  },

  async outbox(ctx) {
    const status = ctx.query.status ?? '';
    const typ = ctx.query.typ ?? '';
    const [liste, statistik] = await Promise.all([get('/admin/outbox', { status, typ, limit: 200 }), get('/admin/outbox/statistik')]);
    const summe = (st) => statistik.filter((s) => s.status === st).reduce((x, s) => x + s.anzahl, 0);
    const typen = [...new Set(statistik.map((s) => s.typ))];
    ctx.aktion('verarbeiten', async () => {
      const r = await post('/admin/outbox/verarbeiten');
      toast(`Outbox verarbeitet: ${r.erledigt} erledigt, ${r.fehler} Fehler`, r.fehler ? 'warning' : 'success');
      ctx.neu();
    });
    ctx.aktion('wiederholen', async (el) => { await post(`/admin/outbox/${el.dataset.id}/wiederholen`); toast(`Auftrag #${el.dataset.id} wird erneut versucht`, 'success'); ctx.neu(); });
    ctx.aenderung('filter', (el) => {
      const f = el.closest('form');
      const qs = new URLSearchParams(ohneLeere({ status: f.status.value, typ: f.typ.value }));
      ctx.navigiere(`/admin/outbox?${qs}`);
    });
    ctx.formular('filter', () => undefined);
    return html`
      <div class="bbz-kpis">
        ${kpi({ titel: 'Offen', zahl: summe('offen') + summe('in_arbeit') })}
        ${kpi({ titel: 'Fehler', zahl: html`<span class="${summe('fehler') ? 'bbz-warning' : ''}">${summe('fehler')}</span>`, sub: 'wird mit Backoff wiederholt' })}
        ${kpi({ titel: 'Tot', zahl: html`<span class="${summe('tot') ? 'bbz-danger' : ''}">${summe('tot')}</span>`, sub: 'max. Versuche erreicht' })}
        ${kpi({ titel: 'Erledigt', zahl: summe('erledigt') })}
      </div>
      <form class="bbz-filterbar compact" data-form="filter" aria-label="Outbox filtern">
        ${feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('outboxStatus'), wert: status, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
        ${feld({ name: 'typ', label: 'Typ', typ: 'select', optionen: typen, wert: typ, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      </form>
      ${sektion({
        titel: `Aufträge (${liste.length})`, untertitel: 'Moodle-Einschreibungen, Webhooks und Mails (neueste zuerst)', flush: true,
        aktionen: html`<button type="button" class="bbz-button bbz-button-sm bbz-button-primary" data-action="verarbeiten">Jetzt verarbeiten</button>`,
        inhalt: tabelle({
          zeilen: liste, leer: 'Keine Aufträge', beschriftung: 'Outbox',
          spalten: [
            { titel: '#', klasse: 'num', wert: (e) => e.id },
            { titel: 'Typ', wert: (e) => html`${e.typ}${e.payload?.ereignis ? html`<div class="bbz-small bbz-muted">${e.payload.ereignis}</div>` : ''}` },
            { titel: 'Status', wert: (e) => statusChip('outboxStatus', e.status) },
            { titel: 'Versuche', klasse: 'num', wert: (e) => `${e.versuche}/${e.maxVersuche}` },
            { titel: 'Nächster Versuch', klasse: 'nowrap', wert: (e) => (['offen', 'fehler'].includes(e.status) ? datumZeit(e.naechsterVersuchAm) : '–') },
            { titel: 'Letzter Fehler', wert: (e) => (e.letzterFehler ? html`<span class="bbz-small bbz-danger">${e.letzterFehler.slice(0, 160)}</span>` : '–') },
            { titel: '', klasse: 'act', wert: (e) => (['fehler', 'tot'].includes(e.status) ? html`<button type="button" class="bbz-button bbz-button-sm" data-action="wiederholen" data-id="${e.id}">Wiederholen</button>` : '') },
          ],
        }),
      })}`;
  },

  async integration() {
    const laeufe = await get('/admin/integration/laeufe');
    return sektion({
      titel: 'Integrationsläufe', untertitel: 'Moodle-Sync, Importe (die letzten 50)', flush: true,
      inhalt: tabelle({
        zeilen: laeufe, leer: 'Noch keine Integrationsläufe', beschriftung: 'Integrationsläufe',
        spalten: [
          { titel: '#', klasse: 'num', wert: (l) => l.id },
          { titel: 'Typ', wert: (l) => l.typ },
          { titel: 'Gestartet', klasse: 'nowrap', wert: (l) => datumZeit(l.gestartetAm) },
          { titel: 'Beendet', klasse: 'nowrap', wert: (l) => datumZeit(l.beendetAm) },
          { titel: 'Status', wert: (l) => chip(l.status, { ok: 'green', teilweise: 'amber', fehler: 'red', laeuft: 'blue' }[l.status] ?? '') },
          { titel: 'Ergebnis', wert: (l) => html`<details><summary class="bbz-small">anzeigen</summary><pre class="bbz-mono bbz-pre">${JSON.stringify(l.ergebnis, null, 2)}</pre></details>` },
        ],
      }),
    });
  },

  async moodle() {
    let s;
    try { s = await get('/integration/moodle/status', undefined, { ruhig: true }); } catch (e) {
      if (e instanceof ApiFehler && e.body && typeof e.body === 'object' && 'konfiguriert' in e.body) s = e.body; else throw e;
    }
    if (!s.konfiguriert) return sektion({ titel: 'Moodle (mybbz)', inhalt: banner(html`Nicht konfiguriert. ${s.hinweis ?? ''}`, 'warning') });
    return sektion({
      titel: 'Moodle (mybbz)', testid: 'moodle-status',
      inhalt: html`${s.erreichbar ? banner('Moodle ist erreichbar.', 'success') : banner(html`Nicht erreichbar: ${s.fehler ?? ''}`, 'error')}
        ${s.erreichbar ? html`<dl class="bbz-dl"><dt>Site</dt><dd>${s.site}</dd><dt>Release</dt><dd>${s.release} (${s.version})</dd>
          <dt>Fehlende Funktionen</dt><dd>${s.fehlendeFunktionen?.length ? s.fehlendeFunktionen.map((f) => chip(f, 'red')) : chip('keine', 'green')}</dd>
          <dt>Face-to-Face</dt><dd>${s.faceToFaceFunktionen?.length ? s.faceToFaceFunktionen.map((f) => chip(f, 'blue')) : 'keine Web-Service-Funktionen freigegeben'}</dd></dl>` : ''}`,
    });
  },
};


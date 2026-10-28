// Einstieg: Anmeldung, App-Shell (Desktop-Nav + Bottom-Nav), Router, zentrale Event-Delegation.
// Interaktion ausschliesslich ueber data-action / data-form / data-change / data-input (keine Inline-Handler).
import { auth } from './auth.js';
import { get, herunterladen, ApiFehler } from './api.js';
import { html, raw, setHtml, toast, modal, ladeanzeige, banner, formWerte, personName } from './ui.js';
import { ROUTEN, NAV, icon } from './routen.js';
import { definiere, aufloesen, navigiere, setzeQuery } from './router.js';
import * as store from './store.js';

const root = document.getElementById('app-root');
let main = null;
let renderNr = 0;
let ctx = null;
let loginListe = [];

/* ---------- Anmeldung ---------- */
async function zeigeLogin(hinweis) {
  main = null;
  ctx = null;
  store.verwerfe();
  if (auth.modus === 'entra') {
    setHtml(root, html`<main class="bbz-login" id="inhalt"><div class="bbz-login-card">
      <span class="bbz-brand-mark" aria-hidden="true">bbz</span><h1>bbz ERP</h1>
      <p>Anmeldung mit Ihrem Microsoft-Konto der bbz.</p>${hinweis ? banner(hinweis, 'warning') : ''}
      <button type="button" class="bbz-button bbz-button-primary" data-action="entra-login">Mit Microsoft anmelden</button></div></main>`);
    return;
  }
  try { loginListe = await get('/mitarbeitende', { aktiv: 'true' }, { ruhig: true }); } catch { loginListe = []; }
  const erste = loginListe[0];
  setHtml(root, html`<main class="bbz-login" id="inhalt"><form class="bbz-login-card" data-form="login" data-testid="login">
    <span class="bbz-brand-mark" aria-hidden="true">bbz</span><h1>bbz ERP</h1>
    <p>Entwicklungsmodus: Person und Rolle wählen. Im Betrieb erfolgt die Anmeldung über Microsoft Entra ID.</p>
    ${hinweis ? banner(hinweis, 'warning') : ''}
    <div class="bbz-field">${loginListe.length
      ? html`<label for="login-kuerzel">Person (Kürzel)</label><select id="login-kuerzel" name="kuerzel" class="bbz-select" data-change="login-person" required>
          ${loginListe.map((m) => html`<option value="${m.kuerzel}">${m.kuerzel} – ${personName(m)}${m.rolle === 'admin' ? ' (Admin)' : ''}</option>`)}</select>`
      : html`<label for="login-kuerzel">Kürzel</label><input id="login-kuerzel" name="kuerzel" class="bbz-input" required pattern="[A-Za-z]{2,4}" autocomplete="username">
          <div class="bbz-field-hint">Keine Mitarbeitenden erfasst – Kürzel frei eingeben.</div>`}</div>
    <fieldset class="bbz-field bbz-multi"><legend class="bbz-field-label">Rolle</legend><div class="bbz-radio-row">
      <label class="bbz-checkbox"><input type="radio" name="rolle" value="standard" ${erste?.rolle !== 'admin' ? raw('checked') : ''}> Standard</label>
      <label class="bbz-checkbox"><input type="radio" name="rolle" value="admin" ${erste?.rolle === 'admin' ? raw('checked') : ''}> Admin</label>
    </div></fieldset>
    <button type="submit" class="bbz-button bbz-button-primary bbz-button-block">Anmelden</button>
  </form></main>`);
  root.querySelector('#login-kuerzel')?.focus();
}

const GLOBAL_FORM = {
  login(_f, w) {
    const k = String(w.kuerzel ?? '').trim().toLowerCase();
    if (!k) return;
    const ma = loginListe.find((m) => m.kuerzel === k);
    auth.setzeSitzung({ kuerzel: k, rolle: w.rolle === 'admin' ? 'admin' : 'standard', name: ma ? personName(ma) : k, mitarbeitendeId: ma?.id ?? null, email: ma?.email ?? null });
    if (!location.hash || location.hash === '#') location.hash = '#/';
    zeigeApp();
  },
};

async function entraPerson(st) {
  const liste = await get('/mitarbeitende', { aktiv: 'true' });
  const ma = liste.find((m) => (m.email ?? '').toLowerCase() === st.email);
  if (!ma) throw new Error(`Für ${st.email} ist kein aktives bbz-Konto (Mitarbeitende) erfasst.`);
  auth.setzeSitzung({
    kuerzel: ma.kuerzel, rolle: ma.rolle === 'admin' || st.roles.includes('bbz.admin') ? 'admin' : 'standard',
    name: personName(ma), mitarbeitendeId: ma.id, email: ma.email,
  });
}

/* ---------- Shell ---------- */
function zeigeApp() {
  const b = auth.benutzer;
  const nav = NAV.filter((n) => !n.admin || auth.istAdmin());
  setHtml(root, html`<div id="app-shell">
    <header class="bbz-header">
      <a class="bbz-brand" href="#/" aria-label="bbz ERP – Cockpit"><span class="bbz-brand-mark" aria-hidden="true">bbz</span><span class="bbz-brand-text">bbz <span>ERP</span></span></a>
      <nav class="bbz-nav" aria-label="Hauptnavigation">${nav.map((n) => html`<a class="bbz-nav-btn" href="${n.href}" data-bereich="${n.bereich}">${n.label}</a>`)}</nav>
      <div class="bbz-toolbar">
        <button type="button" class="bbz-hbtn bbz-hbtn-primary" data-action="aktivitaet-neu" aria-label="Aktivität erfassen">+<span class="bbz-hbtn-text"> Aktivität</span></button>
        <span class="bbz-auth" data-testid="benutzer"><span class="bbz-auth-dot" aria-hidden="true"></span><b>${b.kuerzel}</b>${b.rolle === 'admin' ? ' · Admin' : ''}</span>
        <button type="button" class="bbz-hbtn" data-action="abmelden">Abmelden</button>
      </div>
    </header>
    <main class="bbz-main" id="inhalt" tabindex="-1"></main>
    <nav class="bbz-bottom-nav" aria-label="Navigation">
      ${nav.filter((n) => n.mobil).map((n) => html`<a class="bbz-bottom-btn" href="${n.href}" data-bereich="${n.bereich}">${raw(icon(n.icon))}<span>${n.label}</span></a>`)}
      <button type="button" class="bbz-bottom-btn" data-action="mehr" data-bereich="mehr">${raw(icon('more'))}<span>Mehr</span></button>
    </nav>
  </div>`);
  main = document.getElementById('inhalt');
  route();
}

function markiereNav(bereich) {
  const mobil = NAV.some((n) => n.mobil && n.bereich === bereich);
  document.querySelectorAll('[data-bereich]').forEach((a) => {
    const an = a.dataset.bereich === bereich || (a.dataset.bereich === 'mehr' && bereich && !mobil);
    if (an) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/* ---------- Router ---------- */
function neuerKontext(nr, r, params, query) {
  const c = {
    params, query, bereich: r.bereich, benutzer: auth.benutzer, istAdmin: auth.istAdmin(), el: main,
    aktionen: {}, formulare: {}, aenderungen: {}, eingaben: {},
    aktiv: () => nr === renderNr,
    zeige(inhalt) { if (nr === renderNr) setHtml(main, inhalt); },
    aktion(name, fn) { c.aktionen[name] = fn; },
    formular(name, fn) { c.formulare[name] = fn; },
    aenderung(name, fn) { c.aenderungen[name] = fn; },
    eingabe(name, fn) { c.eingaben[name] = fn; },
    neu: () => route({ still: true }),
    setzeQuery,
    navigiere,
  };
  return c;
}

async function route({ still = false } = {}) {
  if (!main) return;
  const nr = (renderNr += 1);
  const { route: r, params, query } = aufloesen();
  markiereNav(r?.bereich);
  if (!r) { setHtml(main, banner('Diese Seite gibt es nicht.', 'warning')); return; }
  if (r.admin && !auth.istAdmin()) { setHtml(main, banner('Keine Berechtigung: Dieser Bereich ist Administratorinnen und Administratoren vorbehalten.', 'error')); return; }
  const scroll = window.scrollY;
  const c = neuerKontext(nr, r, params, query);
  ctx = c;
  if (!still) setHtml(main, ladeanzeige());
  try {
    const mod = await r.modul();
    if (nr !== renderNr) return;
    await mod[r.fn](c);
    if (nr !== renderNr) return;
    if (still) window.scrollTo(0, scroll);
    else main.querySelector('h1')?.focus({ preventScroll: true });
  } catch (e) {
    if (nr !== renderNr || e?.status === 401) return;
    console.warn('Ansicht fehlgeschlagen', e);
    setHtml(main, banner(html`<strong>Die Ansicht konnte nicht geladen werden.</strong> ${e?.message ?? ''}`, 'error'));
  }
}

/* ---------- Globale Aktionen ---------- */
const GLOBAL = {
  abmelden: () => auth.abmelden(),
  'entra-login': () => auth.entraAnmelden(),
  mehr() {
    const nav = NAV.filter((n) => !n.mobil && (!n.admin || auth.istAdmin()));
    const m = modal({
      titel: 'Weitere Bereiche',
      inhalt: html`<nav class="bbz-more-grid" aria-label="Weitere Bereiche">${nav.map((n) => html`<a href="${n.href}">${n.label}</a>`)}</nav>`,
    });
    m.el.addEventListener('click', (e) => { if (e.target.closest('a')) m.schliessen(); });
  },
  async 'aktivitaet-neu'(a) {
    const { aktivitaetErfassen } = await import('./views/formulare.js');
    const r = await aktivitaetErfassen({
      kontaktId: a.dataset.kontakt, organisationId: a.dataset.organisation,
      verkaufschanceId: a.dataset.verkaufschance, projektId: a.dataset.projekt,
    });
    if (r) { toast('Aktivität erfasst', 'success'); ctx?.neu(); }
  },
  async herunterladen(a) {
    await herunterladen(a.dataset.pfad, { dateiname: a.dataset.datei, oeffnen: a.dataset.oeffnen === '1' });
  },
  nav: (a) => navigiere(a.dataset.ziel),
};

function behandleFehler(err) {
  if (err instanceof ApiFehler) return;     // bereits als Toast gemeldet
  console.warn(err);
  toast(err?.message ?? 'Unerwarteter Fehler', 'error');
}

function registriereEvents() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (a) {
      const fn = ctx?.aktionen[a.dataset.action] ?? GLOBAL[a.dataset.action];
      if (!fn || a.disabled) return;
      e.preventDefault();
      const knopf = a.tagName === 'BUTTON' ? a : null;
      if (knopf) knopf.disabled = true;
      try { await fn(a, e); } catch (err) { behandleFehler(err); } finally { if (knopf) knopf.disabled = false; }
      return;
    }
    if (e.target.closest('a, button, input, select, textarea, label, summary, #modal-root')) return;
    const zeile = e.target.closest('[data-href]');
    if (zeile) navigiere(zeile.dataset.href.replace(/^#/, ''));
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const fn = ctx?.formulare[f.dataset.form] ?? GLOBAL_FORM[f.dataset.form];
    if (!fn) return;
    if (!f.reportValidity()) return;
    const knopf = f.querySelector('[type=submit]');
    if (knopf) knopf.disabled = true;
    try { await fn(f, formWerte(f), e); } catch (err) { behandleFehler(err); } finally { if (knopf) knopf.disabled = false; }
  });
  document.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-change]');
    if (!c) return;
    if (c.dataset.change === 'login-person') {
      const ma = loginListe.find((m) => m.kuerzel === c.value);
      const r = root.querySelector(`input[name=rolle][value=${ma?.rolle === 'admin' ? 'admin' : 'standard'}]`);
      if (r) r.checked = true;
      return;
    }
    const fn = ctx?.aenderungen[c.dataset.change];
    if (fn) { try { await fn(c, e); } catch (err) { behandleFehler(err); } }
  });
  document.addEventListener('input', (e) => {
    const c = e.target.closest('[data-input]');
    const fn = c && ctx?.eingaben[c.dataset.input];
    if (fn) fn(c, e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('[data-href][tabindex]')) navigiere(e.target.dataset.href.replace(/^#/, ''));
  });
  window.addEventListener('hashchange', () => { if (main) { window.scrollTo(0, 0); route(); } });
}

/* ---------- Start ---------- */
async function start() {
  definiere(ROUTEN);
  registriereEvents();
  auth.beiAblauf(() => zeigeLogin('Ihre Sitzung ist abgelaufen oder ungültig. Bitte erneut anmelden.'));
  try {
    const st = await auth.init();
    if (!st.angemeldet) { await zeigeLogin(); return; }
    if (auth.modus === 'entra' && !auth.benutzer) await entraPerson(st);
    zeigeApp();
  } catch (e) {
    setHtml(root, html`<main class="bbz-login"><div class="bbz-login-card"><h1>bbz ERP</h1>${banner(e?.message ?? String(e), 'error')}</div></main>`);
  }
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

start();

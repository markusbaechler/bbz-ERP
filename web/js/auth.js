// Anmeldung. dev: Kuerzel + Rolle (sessionStorage) -> Header x-user / x-user-role.
// entra: MSAL Browser (lokal vendored) -> Bearer-Token fuer config.apiScope. Die Person (Kuerzel, Rolle)
// wird ueber /mitarbeitende anhand der E-Mail des Kontos bestimmt (der Server prueft selbst; das UI blendet nur aus).
import config from '../config.js';

const SCHLUESSEL = 'bbz-erp.sitzung';
let sitzung = null;            // { kuerzel, rolle, name, mitarbeitendeId, email }
let msalApp = null;
let konto = null;
let token = null;              // { wert, bis }
let abgelaufenHandler = () => {};

function lies() {
  try { return JSON.parse(sessionStorage.getItem(SCHLUESSEL) ?? 'null'); } catch { return null; }
}
function schreibe(s) {
  try { if (s) sessionStorage.setItem(SCHLUESSEL, JSON.stringify(s)); else sessionStorage.removeItem(SCHLUESSEL); } catch { /* privat */ }
}
function ladeSkript(src) {
  return new Promise((ok, fehler) => {
    if (window.msal) { ok(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fehler(new Error(`${src} konnte nicht geladen werden`));
    document.head.appendChild(s);
  });
}
const redirectUri = () => location.origin + location.pathname;

export const auth = {
  modus: config.authMode === 'entra' ? 'entra' : 'dev',
  get benutzer() { return sitzung; },
  istAdmin: () => sitzung?.rolle === 'admin',
  beiAblauf(fn) { abgelaufenHandler = fn; },

  /** dev: gespeicherte Sitzung; entra: MSAL initialisieren, Redirect-Antwort verarbeiten. Liefert { angemeldet, email }. */
  async init() {
    if (this.modus === 'dev') {
      sitzung = lies();
      return { angemeldet: !!sitzung };
    }
    if (!config.clientId || !config.tenantId || !config.apiScope) {
      throw new Error('Entra-Konfiguration unvollständig: tenantId, clientId und apiScope in config.js setzen.');
    }
    await ladeSkript('lib/msal-browser.min.js');
    msalApp = new window.msal.PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: redirectUri(),
        postLogoutRedirectUri: redirectUri(),
        navigateToLoginRequestUrl: false,
      },
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
    });
    await msalApp.initialize();
    let antwort = null;
    try { antwort = await msalApp.handleRedirectPromise(); } catch (e) { console.warn('MSAL-Redirect', e); }
    konto = antwort?.account ?? msalApp.getActiveAccount() ?? msalApp.getAllAccounts()[0] ?? null;
    if (!konto) return { angemeldet: false };
    msalApp.setActiveAccount(konto);
    sitzung = lies();
    return { angemeldet: true, email: (konto.username ?? '').toLowerCase(), roles: konto.idTokenClaims?.roles ?? [] };
  },

  async headers() {
    if (this.modus === 'dev') {
      return sitzung ? { 'x-user': sitzung.kuerzel, 'x-user-role': sitzung.rolle } : {};
    }
    if (!msalApp || !konto) return {};
    if (!token || token.bis < Date.now() + 60000) {
      const anfrage = { scopes: [config.apiScope], account: konto };
      try {
        const r = await msalApp.acquireTokenSilent(anfrage);
        token = { wert: r.accessToken, bis: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 300000 };
      } catch (e) {
        if (e instanceof window.msal.InteractionRequiredAuthError) { await msalApp.acquireTokenRedirect(anfrage); return {}; }
        throw e;
      }
    }
    return { authorization: `Bearer ${token.wert}` };
  },

  /** Person zur Sitzung setzen (dev: aus der Anmeldemaske; entra: aus /mitarbeitende). */
  setzeSitzung(s) { sitzung = s; schreibe(s); },

  async entraAnmelden() {
    await msalApp.loginRedirect({ scopes: [config.apiScope], redirectUri: redirectUri() });
  },

  abmelden() {
    schreibe(null);
    sitzung = null;
    token = null;
    if (this.modus === 'entra' && msalApp && konto) {
      msalApp.logoutRedirect({ account: konto, postLogoutRedirectUri: redirectUri() });
      return;
    }
    location.hash = '#/';
    location.reload();
  },

  sitzungAbgelaufen() {
    if (this.modus === 'dev') { schreibe(null); sitzung = null; }
    token = null;
    abgelaufenHandler();
  },
};

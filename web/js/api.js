// Fetch-Wrapper fuer die ERP-API: Auth-Header, JSON, einheitliche Fehler.
// 400/404/409 -> Toast mit dem `error`-Text des Servers; 401 -> Anmeldung; 403 -> "Keine Berechtigung".
import config from '../config.js';
import { auth } from './auth.js';
import { toast } from './ui.js';

export class ApiFehler extends Error {
  constructor(status, body) {
    super(meldung(status, body));
    this.name = 'ApiFehler';
    this.status = status;
    this.body = body;
  }
}

function meldung(status, body) {
  if (status === 403) return body?.error ? `Keine Berechtigung: ${body.error}` : 'Keine Berechtigung';
  if (status === 401) return 'Anmeldung erforderlich';
  if (body && typeof body === 'object') {
    if (typeof body.error === 'string' && !(body.statusCode && body.message)) {
      return body.detail ? `${body.error} (${body.detail})` : body.error;
    }
    if (typeof body.message === 'string') return body.message;
  }
  if (status === 0) return 'Server nicht erreichbar';
  if (status >= 500) return 'Serverfehler – bitte später erneut versuchen';
  return `Fehler ${status}`;
}

/** Route existiert auf dem Server nicht (Modul noch nicht ausgerollt) – im Unterschied zu "Datensatz nicht gefunden". */
export const istModulFehlt = (e) => e instanceof ApiFehler && e.status === 404
  && typeof e.body?.message === 'string' && /^Route \S+ not found/.test(e.body.message);

let stummTiefe = 0;
/** Fuehrt fn aus, ohne Fehler-Toasts (der Aufrufer zeigt Fehler selbst an, z. B. im Formular). */
export async function stumm(fn) {
  stummTiefe += 1;
  try { return await fn(); } finally { stummTiefe -= 1; }
}

export function url(pfad, query) {
  const u = new URL((config.apiBasis || '') + pfad, location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return u;
}

/**
 * api('/organisation', { query: { suche } }) · api('/aktivitaet', { method: 'POST', body })
 * antwort: 'json' (Default) | 'blob' | 'text' · ruhig: keine Fehler-Toasts.
 */
export async function api(pfad, { method = 'GET', body, query, antwort = 'json', ruhig = false } = {}) {
  const headers = { accept: antwort === 'json' ? 'application/json' : '*/*', ...(await auth.headers()) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url(pfad, query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    const f = new ApiFehler(0, null);
    if (!ruhig && !stummTiefe) toast(f.message, 'error');
    throw f;
  }
  if (res.ok) {
    if (res.status === 204) return null;
    if (antwort === 'blob') return res.blob();
    if (antwort === 'text') return res.text();
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('json') ? res.json() : res.text();
  }
  let data = null;
  try { data = await res.json(); } catch { /* kein JSON */ }
  const fehler = new ApiFehler(res.status, data);
  if (res.status === 401) auth.sitzungAbgelaufen();
  else if (!ruhig && !stummTiefe && !istModulFehlt(fehler)) toast(fehler.message, 'error');
  throw fehler;
}

export const get = (pfad, query, opt = {}) => api(pfad, { ...opt, query });
export const post = (pfad, body = {}, opt = {}) => api(pfad, { ...opt, method: 'POST', body });
export const patch = (pfad, body = {}, opt = {}) => api(pfad, { ...opt, method: 'PATCH', body });
export const del = (pfad, opt = {}) => api(pfad, { ...opt, method: 'DELETE' });

/** Datei mit Auth-Headern laden (PDF, CSV) und speichern bzw. in neuem Tab oeffnen. */
export async function herunterladen(pfad, { dateiname = 'download', oeffnen = false, query } = {}) {
  const blob = await api(pfad, { antwort: 'blob', query });
  const objUrl = URL.createObjectURL(blob);
  let geoeffnet = false;
  if (oeffnen) geoeffnet = !!window.open(objUrl, '_blank');
  if (!geoeffnet) {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  return blob;
}

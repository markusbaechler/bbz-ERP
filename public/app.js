import { hole, ApiFehler } from './api.js';

const inhalt = document.getElementById('inhalt');
const banner = document.getElementById('fehlerbanner');
const streifen = document.getElementById('sperrstreifen');
const routen = [];

export function registriere(muster, laden) { routen.push({ muster, laden }); }

export function zeigeFehler(text) {
  banner.textContent = text;
  banner.hidden = false;
}
export function verbergeFehler() { banner.hidden = true; }

/**
 * Umhuellt einen asynchronen Ereignisbehandler: Fehler landen sichtbar im Banner
 * statt als unbehandelte Promise-Ablehnung, und das ausloesende Element ist
 * waehrend des Laufs gesperrt (kein Doppelklick, keine zwei Entwuerfe).
 *
 * Zuerst wird der Balken der vorigen Aktion geloescht. Die uebrigen Behandler
 * enden in `location.reload()` oder einem Hashwechsel und kommen damit ueber
 * `route()` zu `verbergeFehler()`; `#/system` zeichnet an Ort und Stelle neu —
 * dort stand sonst die rote Meldung des Fehlversuchs ueber der Erfolgsmeldung
 * des naechsten (Befund I3).
 */
export function aktion(fn) {
  return async (ereignis) => {
    verbergeFehler();
    const el = ereignis?.currentTarget;
    if (el) el.disabled = true;
    try {
      await fn(ereignis);
    } catch (e) {
      zeigeFehler(e instanceof ApiFehler ? e.meldung : String(e));
    } finally {
      if (el) el.disabled = false;
    }
  };
}

// Der gesperrte Zaehler blockiert die Kernaktion — er gehoert dauerhaft sichtbar,
// nicht erst in die Fehlermeldung nach dem Klick.
export async function aktualisiereSperrstreifen() {
  try {
    const z = await hole('/zaehler/rechnung');
    streifen.hidden = !z.gesperrt;
    if (z.gesperrt) {
      streifen.textContent =
        `Rechnungszähler steht auf ${z.wert}, Untergrenze ${z.untergrenze}. ` +
        `Festschreiben ist gesperrt, bis der FileMaker-Höchststand gesetzt ist.`;
    }
    return z;
  } catch { streifen.hidden = true; return null; }
}

async function route() {
  verbergeFehler();
  const pfad = location.hash.slice(1) || '/projekte';
  for (const { muster, laden } of routen) {
    const treffer = muster.exec(pfad);
    if (!treffer) continue;
    try { await laden(inhalt, treffer.slice(1)); }
    catch (e) { zeigeFehler(e instanceof ApiFehler ? e.meldung : String(e)); }
    inhalt.focus();
    return;
  }
  inhalt.innerHTML = '<p>Diese Ansicht gibt es nicht.</p>';
}

// Auffangnetz fuer alles, was trotz aktion() durchrutscht (z. B. Fehler aus
// Code, der (noch) nicht ueber aktion() laeuft) — sonst verschwindet der
// Fehler unbemerkt in der Konsole statt sichtbar im Banner zu landen.
addEventListener('unhandledrejection', (ereignis) => {
  zeigeFehler(ereignis.reason instanceof ApiFehler ? ereignis.reason.meldung : String(ereignis.reason));
});

addEventListener('hashchange', route);
addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    import('./screens/projekte.js'), import('./screens/projekt.js'),
    import('./screens/rechnung.js'), import('./screens/system.js'),
  ]);
  await aktualisiereSperrstreifen();
  await route();
});

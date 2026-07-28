import { registriere, aktualisiereSperrstreifen, aktion } from '../app.js';
import { hole, sende } from '../api.js';
import { text } from '../ui/format.js';
import { laedt } from '../ui/zustand.js';

// Zeichnet den Zustand neu, statt die Seite neu zu laden (anders als bei den
// uebrigen Screens): nach dem Setzen soll die Meldung neben dem aktuellen,
// nicht dem veralteten Stand stehen.
// Auch die Zahlen laufen durch text(): sie sind heute JSON-Zahlen und damit
// harmlos, aber eine Vorlage, in der manche Werte maskiert sind und andere
// nicht, laedt zum Nachahmen der falschen Haelfte ein (Befund M10).
function darstellen(el, z) {
  el.innerHTML = `
    <h1 class="titel-nummer">${text(z.wert)}</h1>
    <p class="titel-name">Stand des Rechnungszählers</p>
    <section class="kopfdaten">
      <dl>
        <dt>Untergrenze</dt><dd class="code">${text(z.untergrenze)}</dd>
        <dt>Festschreiben</dt>
        <dd>${z.gesperrt
          ? '<span class="status status-abgerechnet">gesperrt</span>'
          : '<span class="status status-bezahlt">möglich</span>'}</dd>
        <dt>Gesetzt am</dt><dd>${z.gesetztAm ? text(new Date(z.gesetztAm).toLocaleString('de-CH')) : '—'}</dd>
        <dt>Gesetzt durch</dt><dd>${text(z.gesetztDurch ?? '—')}</dd>
      </dl>
    </section>
    <p>Der Zähler muss auf den höchsten in FileMaker vergebenen Rechnungsnummer-Stand gesetzt werden.
       Die Untergrenze ${text(z.untergrenze)} ist nur der aus dem Export belegbare Boden — der echte Stand liegt darüber.
       Er lässt sich nur erhöhen, nie senken.</p>
    <label>Neuer Stand <span class="eck"><input id="z-wert" size="8" inputmode="numeric"></span></label>
    <button id="z-setzen" class="haupt">Zähler setzen</button>
    <p id="z-meldung" class="hinweis-fm"></p>`;

  // aktion(): eine abgewiesene PUT (z. B. Wert unter dem aktuellen Stand, den
  // der Server ablehnt) landet sichtbar im Fehlerbanner statt unbemerkt zu
  // verschwinden; das Element ist waehrend des Laufs gesperrt.
  el.querySelector('#z-setzen').addEventListener('click', aktion(async () => {
    const wert = Number(el.querySelector('#z-wert').value);
    const neu = await sende('PUT', '/zaehler/rechnung', { wert });
    await aktualisiereSperrstreifen();
    darstellen(el, neu);
    el.querySelector('#z-meldung').textContent = `Zähler steht jetzt auf ${neu.wert}.`;
  }));
}

registriere(/^\/system$/, async (el) => {
  laedt(el);
  const z = await hole('/zaehler/rechnung');
  darstellen(el, z);
});

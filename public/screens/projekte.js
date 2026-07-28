import { registriere } from '../app.js';
import { hole } from '../api.js';
import { franken, text } from '../ui/format.js';
import { tabelle } from '../ui/tabelle.js';
import { laedt, leer } from '../ui/zustand.js';

registriere(/^\/projekte$/, async (el) => {
  laedt(el);
  const alle = await hole('/projekt');

  el.innerHTML = `
    <h1 class="titel-nummer">Projekte</h1>
    <p class="titel-name">${text(alle.length)} Projekte</p>
    <div class="filterzeile">
      <label>Jahr <span class="eck"><input id="f-jahr" size="5" inputmode="numeric"></span></label>
      <label>Suche <span class="eck"><input id="f-text" size="30" placeholder="Nummer, Name oder Auftraggeber"></span></label>
    </div>
    <p class="hinweis-fm">„abgerechnet" und „offen" sind Stände aus FileMaker vom Zeitpunkt des Exports.
       Sie ändern sich nicht, wenn hier eine Rechnung erfasst wird.</p>
    <div id="liste"></div>`;

  const ziel = el.querySelector('#liste');
  const spalten = [
    { titel: 'Nummer', feld: 'nummer', klasse: 'code' },
    { titel: 'Name', feld: 'name' },
    { titel: 'Auftraggeber', feld: 'auftraggeberName' },
    { titel: 'Bereich', feld: 'bereich' },
    { titel: 'Budget', feld: 'budgetChf', klasse: 'betrag', render: franken },
    { titel: 'abgerechnet (FM)', feld: 'fmAbgerechnet', klasse: 'betrag', render: franken },
    { titel: 'offen (FM)', feld: 'fmOffenProv', klasse: 'betrag', render: franken },
  ];

  function zeichne() {
    const jahr = el.querySelector('#f-jahr').value.trim();
    // nicht `text` — das waere der importierte Maskierer, hier verdeckt
    const suche = el.querySelector('#f-text').value.trim().toLowerCase();
    const gefiltert = alle.filter((p) =>
      (jahr === '' || String(p.jahr) === jahr) &&
      (suche === '' || `${p.nummer} ${p.name} ${p.auftraggeberName}`.toLowerCase().includes(suche)));
    ziel.innerHTML = '';
    if (gefiltert.length === 0) { leer(ziel, 'Kein Projekt passt zu diesem Filter.'); return; }
    ziel.append(tabelle(spalten, gefiltert, (p) => { location.hash = `#/projekt/${p.id}`; }));
  }

  el.querySelector('#f-jahr').addEventListener('input', zeichne);
  el.querySelector('#f-text').addEventListener('input', zeichne);
  zeichne();
});

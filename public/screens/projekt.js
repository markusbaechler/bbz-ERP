import { registriere, aktualisiereSperrstreifen, aktion } from '../app.js';
import { hole, sende } from '../api.js';
import { franken, datum, text } from '../ui/format.js';
import { tabelle } from '../ui/tabelle.js';
import { laedt, leer } from '../ui/zustand.js';

registriere(/^\/projekt\/([0-9a-f-]+)$/, async (el, [id]) => {
  laedt(el);
  const [p, rechnungen] = await Promise.all([hole(`/projekt/${id}`), hole(`/projekt/${id}/rechnungen`)]);

  const adresse = p.auftraggeberAdresseUnvollstaendig
    ? `<div id="adressnachtrag" class="sperrhinweis">
         <p><strong>${text(p.auftraggeberName)}</strong> hat keine vollständige Adresse.
            Ohne Strasse, PLZ und Ort lässt sich keine Rechnung festschreiben.</p>
         <label>Strasse <span class="eck"><input id="a-strasse" size="28" aria-label="Strasse"></span></label>
         <label>PLZ <span class="eck"><input id="a-plz" size="6" aria-label="PLZ"></span></label>
         <label>Ort <span class="eck"><input id="a-ort" size="18" aria-label="Ort"></span></label>
         <label>Land <span class="eck"><input id="a-land" size="4" value="CH" aria-label="Land"></span></label>
         <button id="a-speichern" class="haupt">Adresse speichern</button>
       </div>`
    : `<p>${text(p.auftraggeberName)}${p.auftraggeberZusatz ? '<br>' + text(p.auftraggeberZusatz) : ''}<br>
          ${text(p.auftraggeberStrasse)}<br>${text(p.auftraggeberLand)}-${text(p.auftraggeberPlz)} ${text(p.auftraggeberOrt)}</p>`;

  el.innerHTML = `
    <h1 class="titel-nummer">${text(p.nummer)}</h1>
    <p class="titel-name">${text(p.name)}</p>
    <section class="kopfdaten">
      <dl>
        <dt>Auftraggeber</dt><dd>${adresse}</dd>
        <dt>Ansprechperson</dt><dd>${p.ansprechperson ? text(p.ansprechperson) : '—'}</dd>
        <dt>Bereich</dt><dd>${p.bereich ? text(p.bereich) : '—'}</dd>
        <dt>Projektleitung</dt><dd class="code">${p.projektleitungKuerzel ? text(p.projektleitungKuerzel) : '—'}</dd>
        <dt>Ertragskonto</dt><dd><span class="code">${p.ertragskontoNummer ? text(p.ertragskontoNummer) : '—'}</span>
            ${p.ertragskontoBezeichnung ? text(p.ertragskontoBezeichnung) : ''}</dd>
        <dt>Budget</dt><dd class="betrag">${franken(p.budgetChf)}</dd>
        <dt>Vorjahr</dt><dd class="code">${p.alteProjektNr ? text(p.alteProjektNr) : '—'}</dd>
      </dl>
      ${p.beschrieb ? `<pre class="beschrieb">${text(p.beschrieb)}</pre>` : ''}
    </section>
    <h2>Rechnungen</h2>
    <div id="rechnungen"></div>
    <button id="neu" class="haupt">Neue Rechnung</button>`;

  const ziel = el.querySelector('#rechnungen');
  if (rechnungen.length === 0) {
    leer(ziel, 'Für dieses Projekt gibt es noch keine Rechnung.');
  } else {
    ziel.append(tabelle([
      { titel: 'Nummer', feld: 'nummer', klasse: 'code' },
      { titel: 'Datum', feld: 'datum', render: datum },
      { titel: 'Status', feld: 'status', render: (s) => `<span class="status status-${text(s)}">${text(s)}</span>` },
      { titel: 'Total', feld: 'totalBrutto', klasse: 'betrag', render: franken },
    ], rechnungen, (r) => { location.hash = `#/rechnung/${r.id}`; }));
  }

  el.querySelector('#neu').addEventListener('click', aktion(async () => {
    const r = await sende('POST', '/rechnung', {
      projektId: p.id, auftraggeberId: p.auftraggeberId,
      datum: new Date().toISOString().slice(0, 10),
      betreff: p.name, mwstModus: p.mwstModus,
    });
    location.hash = `#/rechnung/${r.id}`;
  }));

  const speichern = el.querySelector('#a-speichern');
  if (speichern) speichern.addEventListener('click', aktion(async () => {
    await sende('PUT', `/auftraggeber/${p.auftraggeberId}`, {
      strasse: el.querySelector('#a-strasse').value.trim(),
      plz: el.querySelector('#a-plz').value.trim(),
      ort: el.querySelector('#a-ort').value.trim(),
      land: el.querySelector('#a-land').value.trim(),
    });
    await aktualisiereSperrstreifen();
    location.reload();
  }));
});

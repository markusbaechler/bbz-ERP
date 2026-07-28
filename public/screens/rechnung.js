import { registriere, aktualisiereSperrstreifen, aktion } from '../app.js';
import { hole, sende } from '../api.js';
import { berechneMwst } from '../ui/mwst.js';
import { franken, datum, prozent, menge, text } from '../ui/format.js';
import { laedt } from '../ui/zustand.js';
import { pruefePosition } from '../ui/eingabe.js';

const SAETZE = [8.1, 2.6, 3.8, 0];

registriere(/^\/rechnung\/([0-9a-f-]+)$/, async (el, [id]) => {
  laedt(el);
  const r = await hole(`/rechnung/${id}`);
  const p = await hole(`/projekt/${r.projektId}`);
  const zaehler = await aktualisiereSperrstreifen();
  const entwurf = r.status === 'offen_prov' || r.status === 'def_vereinbart';

  const e = berechneMwst(r.positionen.map((x) => ({ betrag: x.betragNetto, satz: x.mwstSatz })), r.mwstModus);

  el.innerHTML = `
    <h1 class="titel-nummer">${r.nummer ? text(r.nummer) : 'Entwurf'}</h1>
    <p class="titel-name">${text(p.nummer)} · ${text(p.name)} · ${text(p.auftraggeberName)}</p>
    <p><span class="status status-${text(r.status)}">${text(r.status)}</span> · ${datum(r.datum)} ·
       MWSt ${text(r.mwstModus)}.</p>

    <table id="positionen">
      <thead><tr>
        <th>Beschreibung</th><th class="betrag">Menge</th><th>Einheit</th>
        <th class="betrag">Einzelpreis</th><th class="betrag">MWSt</th><th class="betrag">Betrag</th>
      </tr></thead>
      <tbody>${r.positionen.map((x) => `<tr>
        <td>${text(x.beschreibung)}</td>
        <td class="betrag">${menge(x.menge)}</td>
        <td>${text(x.einheit)}</td>
        <td class="betrag">${franken(x.einzelpreis)}</td>
        <td class="betrag">${prozent(x.mwstSatz)}</td>
        <td class="betrag">${franken(x.betragNetto)}</td>
      </tr>`).join('')}</tbody>
    </table>

    ${entwurf ? `<fieldset id="neu-pos">
      <legend>Position hinzufügen</legend>
      <label>Beschreibung <span class="eck"><input id="p-text" size="36"></span></label>
      <label>Menge <span class="eck"><input id="p-menge" size="6" inputmode="decimal" value="1"></span></label>
      <label>Einheit <span class="eck"><select id="p-einheit">
        <option>Std</option><option>Tag</option><option>Pauschal</option><option>Stk</option>
      </select></span></label>
      <label>Einzelpreis <span class="eck"><input id="p-preis" size="10" inputmode="decimal"></span></label>
      <label>MWSt <span class="eck"><select id="p-satz">
        ${SAETZE.map((s) => `<option value="${text(s)}">${prozent(s)}</option>`).join('')}
      </select></span></label>
      <button id="p-add">Hinzufügen</button>
      <p id="p-fehler" class="feldfehler" hidden></p>
    </fieldset>` : ''}

    <!-- Aufbau wie die MWSt-Zusammenfassung auf dem gedruckten Beleg -->
    <table class="summen">
      <tbody>
        ${e.proSatz.map((z) => `<tr>
          <td>Netto ${prozent(z.satz)}</td><td class="betrag">${franken(z.netto)}</td>
          <td>MWSt</td><td class="betrag">${franken(z.steuer)}</td>
        </tr>`).join('')}
        <tr class="total">
          <td>Total netto</td><td class="betrag">${franken(e.totalNetto)}</td>
          <td>Total MWSt</td><td class="betrag">${franken(e.totalSteuer)}</td>
        </tr>
        <tr class="total"><td colspan="3">Rechnungsbetrag</td>
          <td class="betrag">${franken(e.totalBrutto)}</td></tr>
      </tbody>
    </table>

    <div class="aktionen">
      ${entwurf ? `<button id="fest" class="haupt">Festschreiben</button>` : ''}
      ${r.nummer ? `<a href="/rechnung/${text(r.id)}/pdf" target="_blank"><button>PDF öffnen</button></a>` : ''}
      <a href="#/projekt/${text(p.id)}"><button>Zurück zum Projekt</button></a>
    </div>
    <p id="sperrgrund" class="hinweis-fm"></p>

    ${entwurf ? `<div id="fest-bestaetigung" class="fest-bestaetigung" hidden>
      <p>Es wird eine Rechnungsnummer <strong>unwiderruflich</strong> vergeben.
         Die Rechnung ist danach nicht mehr änderbar — Korrekturen nur über Storno und Neuerfassung.</p>
      <p>Betrag: <span class="betrag">${franken(e.totalBrutto)}</span></p>
      <div class="aktionen">
        <button id="fest-abbrechen">Abbrechen</button>
        <button id="fest-bestaetigen" class="haupt">Endgültig festschreiben</button>
      </div>
    </div>` : ''}`;

  const hinzu = el.querySelector('#p-add');
  if (hinzu) {
    // Zu jedem prueffaehigen Feld die Eckmarke, die im Fehlerfall rot wird.
    const felder = {
      beschreibung: el.querySelector('#p-text'),
      menge: el.querySelector('#p-menge'),
      einzelpreis: el.querySelector('#p-preis'),
    };
    const meldung = el.querySelector('#p-fehler');

    function entmarkiere() {
      for (const feld of Object.values(felder)) feld.closest('.eck')?.classList.remove('fehlerhaft');
      meldung.hidden = true;
      meldung.textContent = '';
    }
    function markiere(fehler) {
      entmarkiere();
      const feld = felder[fehler.feld];
      feld.closest('.eck')?.classList.add('fehlerhaft');
      meldung.textContent = fehler.meldung;
      meldung.hidden = false;
      feld.focus();
    }
    for (const feld of Object.values(felder)) feld.addEventListener('input', entmarkiere);

    hinzu.addEventListener('click', aktion(async () => {
      // Vor dem Senden pruefen, damit die Meldung auf Deutsch am Feld steht.
      // Ohne das wurde aus „33,5" ein NaN, aus dem NaN durch JSON.stringify ein
      // null und daraus ein englisches „Internal Server Error" (Befund I2).
      const geprueft = pruefePosition({
        beschreibung: felder.beschreibung.value,
        menge: felder.menge.value,
        einzelpreis: felder.einzelpreis.value,
      });
      if (geprueft.fehler) { markiere(geprueft.fehler); return; }
      entmarkiere();

      await sende('POST', `/rechnung/${r.id}/position`, {
        ...geprueft.werte,
        einheit: el.querySelector('#p-einheit').value,
        mwstSatz: Number(el.querySelector('#p-satz').value),
      });
      location.reload();
    }));
  }

  const fest = el.querySelector('#fest');
  if (fest) {
    const gesperrt = zaehler?.gesperrt ?? false;
    const ohnePositionen = r.positionen.length === 0;
    const adresseFehlt = p.auftraggeberAdresseUnvollstaendig;
    fest.disabled = gesperrt || ohnePositionen || adresseFehlt;
    el.querySelector('#sperrgrund').textContent =
      gesperrt ? `Festschreiben gesperrt: der Rechnungszähler steht auf ${zaehler.wert}, Untergrenze ${zaehler.untergrenze}. Unter „System" setzen.`
      : adresseFehlt ? 'Festschreiben gesperrt: dem Auftraggeber fehlt die Adresse. Beim Projekt nachtragen.'
      : ohnePositionen ? 'Festschreiben möglich, sobald mindestens eine Position erfasst ist.'
      : '';

    const bestaetigung = el.querySelector('#fest-bestaetigung');
    const abbrechen = el.querySelector('#fest-abbrechen');
    const bestaetigen = el.querySelector('#fest-bestaetigen');

    fest.addEventListener('click', () => {
      fest.hidden = true;
      bestaetigung.hidden = false;
      abbrechen.focus();
    });

    abbrechen.addEventListener('click', () => {
      bestaetigung.hidden = true;
      fest.hidden = false;
      fest.focus();
    });

    bestaetigung.addEventListener('keydown', (ereignis) => {
      if (ereignis.key === 'Escape') abbrechen.click();
    });

    bestaetigen.addEventListener('click', aktion(async () => {
      await sende('POST', `/rechnung/${r.id}/festschreiben`, { erstellerKuerzel: p.projektleitungKuerzel ?? undefined });
      location.reload();
    }));
  }
});

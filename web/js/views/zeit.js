// Meine Zeit: Wochenraster der angemeldeten Person. Zeilen = Projekte (diese Woche + zuletzt verwendet + hinzugefuegt),
// Spalten = Mo-So. Eingaben werden als neue Zeiteintraege gespeichert (POST /zeiterfassung je Zelle).
import { get, post, del, stumm } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, sektion, tabelle, datum, zahl, heute, addTage, montag, WOCHENTAGE, wochentag, toast, banner, chip, bestaetigen,
  optionen, formWerte,
} from '../ui.js';

const AKTIVE = ['akquise', 'offeriert', 'laufend'];

export async function woche(ctx) {
  const ich = ctx.benutzer.mitarbeitendeId;
  if (!ich) {
    ctx.zeige(html`${seitenkopf({ titel: 'Meine Zeit' })}${banner('Ihr Kürzel ist nicht als Mitarbeitende erfasst – Zeiterfassung nicht möglich.', 'warning')}`);
    return;
  }
  const h = heute();
  const mo = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.woche ?? '') ? montag(ctx.query.woche) : montag(h);
  const tage = Array.from({ length: 7 }, (_, i) => addTage(mo, i));
  const extra = (ctx.query.plus ?? '').split(',').filter(Boolean);
  const [eintraege, verlauf, alleProjekte] = await Promise.all([
    get('/zeiterfassung', { mitarbeitendeId: ich, von: mo, bis: tage[6] }),
    get('/zeiterfassung', { mitarbeitendeId: ich, von: addTage(mo, -42), bis: addTage(mo, -1) }),
    store.projekte(),
  ]);
  const pMap = store.nachId(alleProjekte);
  const zeilenIds = [...new Set([...eintraege.map((e) => e.projektId), ...verlauf.map((e) => e.projektId), ...extra])]
    .filter((id) => pMap.has(id) && (AKTIVE.includes(pMap.get(id).status) || eintraege.some((e) => e.projektId === id)));
  const zeilen = zeilenIds.map((id) => pMap.get(id)).sort((a, b) => a.nummer.localeCompare(b.nummer));
  const letzteTaetigkeit = (pid) => [...verlauf, ...eintraege].filter((e) => e.projektId === pid).at(-1)?.taetigkeit ?? 'Projektarbeit';
  const ist = (pid, d) => eintraege.filter((e) => e.projektId === pid && e.datum === d).reduce((s, e) => s + e.stunden, 0);
  const tagTotal = (d) => eintraege.filter((e) => e.datum === d).reduce((s, e) => s + e.stunden, 0);
  const wocheTotal = eintraege.reduce((s, e) => s + e.stunden, 0);
  const waehlbar = alleProjekte.filter((p) => AKTIVE.includes(p.status) && !zeilenIds.includes(p.id));
  const kw = (() => { const d = new Date(`${mo}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - j) / 86400000 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); })();

  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Meine Zeit', untertitel: `KW ${kw} · ${datum(mo)} – ${datum(tage[6])} · ${zahl(wocheTotal, 2)} h erfasst`,
      aktionen: html`<a class="bbz-button" href="#/zeit?woche=${addTage(mo, -7)}" aria-label="Vorherige Woche">◀</a>
        <a class="bbz-button" href="#/zeit">Diese Woche</a>
        <a class="bbz-button" href="#/zeit?woche=${addTage(mo, 7)}" aria-label="Nächste Woche">▶</a>`,
    })}
    <form data-form="woche" data-testid="zeit-woche" aria-label="Stunden der Woche erfassen">
      <section class="bbz-section"><div class="bbz-table-wrap"><table class="bbz-week">
        <caption class="bbz-sr-only">Stunden je Projekt und Tag; graue Zahlen sind bereits erfasst, Eingaben werden zusätzlich gespeichert.</caption>
        <thead><tr><th scope="col" class="proj">Projekt / Tätigkeit</th>${tage.map((d) => html`<th scope="col" class="${d === h ? 'today' : ''}">${WOCHENTAGE[wochentag(d)]} ${d.slice(8)}.${d.slice(5, 7)}.</th>`)}<th scope="col">Total</th></tr></thead>
        <tbody>${zeilen.length ? zeilen.map((p) => html`<tr>
          <td class="proj"><a class="bbz-link" href="#/projekt/${p.id}/zeit">${p.nummer}</a> ${p.name}
            <div class="bbz-row bbz-mt"><label class="bbz-sr-only" for="t-${p.id}">Tätigkeit ${p.nummer}</label><input id="t-${p.id}" class="bbz-input bbz-input-sm" name="t__${p.id}" value="${letzteTaetigkeit(p.id)}">
            <label class="bbz-checkbox bbz-small"><input type="checkbox" name="v__${p.id}" checked> verrechenbar</label></div></td>
          ${tage.map((d) => html`<td class="day ${[0, 6].includes(wochentag(d)) ? 'we' : ''} ${d === h ? 'today' : ''}">
            <span class="ist">${ist(p.id, d) ? zahl(ist(p.id, d), 2) : ''}</span>
            <input class="bbz-input bbz-input-sm" type="number" min="0" max="24" step="0.25" inputmode="decimal" name="h__${p.id}__${d}" data-typ="zahl" aria-label="Stunden ${p.nummer} am ${datum(d)}"></td>`)}
          <td class="day"><strong>${zahl(eintraege.filter((e) => e.projektId === p.id).reduce((s, e) => s + e.stunden, 0), 2)}</strong></td></tr>`)
          : html`<tr><td colspan="9">${banner('Noch keine Projekte in dieser Woche – unten ein Projekt hinzufügen.', 'info')}</td></tr>`}</tbody>
        <tfoot><tr><td class="proj">Erfasst je Tag</td>${tage.map((d) => html`<td>${tagTotal(d) ? zahl(tagTotal(d), 2) : '–'}</td>`)}<td>${zahl(wocheTotal, 2)}</td></tr></tfoot>
      </table></div></section>
      <div class="bbz-row-between bbz-mb">
        <div class="bbz-row"><label for="z-plus" class="bbz-small bbz-muted">Projekt hinzufügen</label>
          <select id="z-plus" class="bbz-select bbz-input-sm" data-change="zeile-plus">${optionen(waehlbar.map((p) => [p.id, `${p.nummer} ${p.name}`]), '', '– wählen –')}</select></div>
        <button type="submit" class="bbz-button bbz-button-primary">Stunden speichern</button>
      </div>
    </form>
    ${sektion({
      titel: 'Einträge dieser Woche', flush: true,
      inhalt: tabelle({
        zeilen: eintraege, leer: 'In dieser Woche noch keine Einträge',
        spalten: [
          { titel: 'Datum', klasse: 'nowrap', wert: (e) => html`${WOCHENTAGE[wochentag(e.datum)]} ${datum(e.datum)}` },
          { titel: 'Projekt', wert: (e) => html`<a class="bbz-link" href="#/projekt/${e.projektId}/zeit">${pMap.get(e.projektId)?.nummer ?? ''}</a> ${pMap.get(e.projektId)?.name ?? ''}` },
          { titel: 'Tätigkeit', wert: (e) => e.taetigkeit },
          { titel: 'Std.', klasse: 'num', wert: (e) => zahl(e.stunden, 2) },
          { titel: 'Status', wert: (e) => (e.verrechnet ? chip('verrechnet', 'green') : e.verrechenbar ? chip('verrechenbar', 'blue') : chip('intern')) },
          { titel: '', klasse: 'act', wert: (e) => (e.verrechnet ? '' : html`<button type="button" class="bbz-icon-btn" data-action="loeschen" data-id="${e.id}" aria-label="Eintrag ${e.taetigkeit} vom ${datum(e.datum)} löschen">✕</button>`) },
        ],
      }),
    })}`);

  ctx.aenderung('zeile-plus', (el) => {
    if (!el.value) return;
    const qs = new URLSearchParams({ woche: mo, plus: [...extra, el.value].join(',') });
    ctx.navigiere(`/zeit?${qs}`);
  });
  ctx.formular('woche', async (form) => {
    const w = formWerte(form);
    const neu = [];
    for (const [k, v] of Object.entries(w)) {
      if (!k.startsWith('h__') || v === null || v === 0) continue;
      const [, projektId, d] = k.split('__');
      neu.push({ projektId, mitarbeitendeId: ich, datum: d, stunden: v, taetigkeit: w[`t__${projektId}`] ?? 'Projektarbeit', verrechenbar: w[`v__${projektId}`] === true });
    }
    if (!neu.length) { toast('Keine Stunden eingegeben', 'warning'); return; }
    const fehler = [];
    let ok = 0;
    await stumm(async () => {
      for (const e of neu) {
        try { await post('/zeiterfassung', e); ok += 1; } catch (err) { fehler.push(`${pMap.get(e.projektId)?.nummer} ${datum(e.datum)}: ${err.message}`); }
      }
    });
    if (ok) toast(`${ok} Zeiteintrag${ok === 1 ? '' : 'e'} gespeichert`, 'success');
    if (fehler.length) toast(fehler.join(' · '), 'error');
    ctx.neu();
  });
  ctx.aktion('loeschen', async (el) => {
    if (!(await bestaetigen('Zeiteintrag löschen?', { okText: 'Löschen', gefahr: true }))) return;
    await del(`/zeiterfassung/${el.dataset.id}`);
    toast('Eintrag gelöscht', 'success');
    ctx.neu();
  });
}

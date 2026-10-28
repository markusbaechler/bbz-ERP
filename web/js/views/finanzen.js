// Finanzen: Rechnungen (Liste, Detail mit Positionen, PDF, Mail, Festschreiben, Storno, Zahlung), offene Posten + Saldo,
// Zahlungsimport (camt.054), Mahnwesen (Vorschlag + Mahnlauf), Sammelrechnung je Bank, Kontenauswertung.
import { get, post, istModulFehlt, herunterladen } from '../api.js';
import * as store from '../store.js';
import {
  html, raw, seitenkopf, tabs, sektion, tabelle, feld, formGrid, formModal, formWerte, ohneLeere, datum, chf, zahl, label, optionenAus,
  statusChip, chip, banner, heute, addTage, tageZwischen, toast, bestaetigen, kpi, modal, modulFehlt, leerHinweis, setHtml,
} from '../ui.js';

const finanzTabs = (aktiv) => tabs([
  { href: '#/finanzen/rechnungen', label: 'Rechnungen', aktiv: aktiv === 'rechnungen' },
  { href: '#/finanzen/offene-posten', label: 'Offene Posten', aktiv: aktiv === 'op' },
  { href: '#/finanzen/zahlungen', label: 'Zahlungsimport', aktiv: aktiv === 'zahlungen' },
  { href: '#/finanzen/mahnwesen', label: 'Mahnwesen', aktiv: aktiv === 'mahnwesen' },
  { href: '#/finanzen/sammelrechnung', label: 'Sammelrechnung', aktiv: aktiv === 'sammelrechnung' },
  { href: '#/finanzen/auswertung', label: 'Kontenauswertung', aktiv: aktiv === 'auswertung' },
], 'Finanzen');
const istIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
const nurAdmin = (ctx, titel, tab) =>
  ctx.zeige(html`${seitenkopf({ titel })}${finanzTabs(tab)}${banner('Diese Funktion steht der Administration zur Verfügung.', 'info')}`);
const ZAHLUNGSFRIST = 30;
const STUFE = { 1: 'Erinnerung', 2: '2. Mahnung', 3: '3. Mahnung' };
/** Route /rechnung/:id/mahnungen fehlt auf dem Server (Modul nicht ausgerollt): nicht bei jedem Rendern erneut anfragen. */
let mahnungenFehlen = false;

export async function rechnungen(ctx) {
  const q = ctx.query;
  const [liste, ag, projekte] = await Promise.all([
    get('/rechnung', { status: q.status, jahr: q.jahr, auftraggeberId: q.auftraggeberId, projektId: q.projektId }),
    store.auftraggeber(), store.projekte(),
  ]);
  const agMap = store.nachId(ag);
  const pMap = store.nachId(projekte);
  const jahrHeute = Number(heute().slice(0, 4));
  const summe = (f) => liste.filter((r) => r.status !== 'storniert').reduce((s, r) => s + r[f], 0);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Rechnungen', untertitel: 'QR-Rechnungen mit lückenloser Nummer bei Festschreibung' })}
    ${finanzTabs('rechnungen')}
    <form class="bbz-filterbar compact" data-form="filter" aria-label="Rechnungen filtern">
      ${feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('rechnungStatus'), wert: q.status, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'jahr', label: 'Jahr', typ: 'select', optionen: [jahrHeute, jahrHeute - 1, jahrHeute - 2].map((j) => [String(j), String(j)]), wert: q.jahr, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
      ${feld({ name: 'auftraggeberId', label: 'Auftraggeber', typ: 'select', optionen: ag.map((a) => [a.id, a.name]), wert: q.auftraggeberId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <div class="bbz-kpis">
      ${kpi({ titel: 'Rechnungen', zahl: liste.length, sub: 'ohne Stornos in den Summen' })}
      ${kpi({ titel: 'Netto', zahl: chf(summe('totalNetto')) })}
      ${kpi({ titel: 'MWSt', zahl: chf(summe('totalMwst')) })}
      ${kpi({ titel: 'Brutto', zahl: chf(summe('totalBrutto')) })}
    </div>
    <section class="bbz-section">${tabelle({
      zeilen: liste, testid: 'rechnungen-tabelle', beschriftung: 'Rechnungen', leer: 'Keine Rechnungen für diese Filter',
      href: (r) => `#/finanzen/rechnung/${r.id}`,
      spalten: [
        { titel: 'Nummer', klasse: 'nowrap', wert: (r) => html`<a class="bbz-link" href="#/finanzen/rechnung/${r.id}">${r.nummer ?? 'Entwurf'}</a>` },
        { titel: 'Datum', klasse: 'nowrap', wert: (r) => datum(r.datum) },
        { titel: 'Auftraggeber', wert: (r) => agMap.get(r.auftraggeberId)?.name ?? '–' },
        { titel: 'Projekt', klasse: 'nowrap', wert: (r) => pMap.get(r.projektId)?.nummer ?? '–' },
        { titel: 'Betreff', wert: (r) => r.betreff ?? '–' },
        { titel: 'Netto', klasse: 'num', wert: (r) => chf(r.totalNetto) },
        { titel: 'Brutto', klasse: 'num', wert: (r) => chf(r.totalBrutto) },
        { titel: 'Status', wert: (r) => statusChip('rechnungStatus', r.status) },
      ],
      karte: (r) => ({ titel: `${r.nummer ?? 'Entwurf'} · ${agMap.get(r.auftraggeberId)?.name ?? ''}`, sub: `${datum(r.datum)} · ${label('rechnungStatus', r.status)}`, rechts: chf(r.totalBrutto) }),
    })}</section>`);
  const filtern = () => {
    const w = formWerte(ctx.el.querySelector('form[data-form=filter]'));
    ctx.navigiere(`/finanzen/rechnungen?${new URLSearchParams(ohneLeere(w))}`);
  };
  ctx.aenderung('filter', filtern);
  ctx.formular('filter', filtern);
}

export async function rechnung(ctx) {
  const id = ctx.params.id;
  const r = await get(`/rechnung/${id}`);
  const [ag, projekte, op, mahnungen] = await Promise.all([
    store.auftraggeber(), store.projekte(),
    ['abgerechnet', 'bezahlt'].includes(r.status) ? get('/debitoren/offene-posten', { auftraggeberId: r.auftraggeberId }) : Promise.resolve([]),
    mahnungenFehlen ? Promise.resolve(null) : get(`/rechnung/${id}/mahnungen`, undefined, { ruhig: true }).catch((e) => { if (istModulFehlt(e)) mahnungenFehlen = true; return null; }),
  ]);
  const a = ag.find((x) => x.id === r.auftraggeberId);
  const p = projekte.find((x) => x.id === r.projektId);
  const posten = op.find((x) => x.rechnungId === id);
  const offen = r.status === 'bezahlt' ? 0 : posten?.offen ?? (r.status === 'abgerechnet' ? r.totalBrutto : null);
  const entwurf = ['offen_prov', 'def_vereinbart'].includes(r.status);
  const faellig = addTage(r.datum, ZAHLUNGSFRIST);

  ctx.zeige(html`
    ${seitenkopf({
      krumen: html`<a href="#/finanzen/rechnungen">Rechnungen</a> ›`,
      titel: r.nummer ? `Rechnung ${r.nummer}` : 'Rechnungsentwurf',
      untertitel: html`${statusChip('rechnungStatus', r.status)} · ${a?.name ?? ''} · ${datum(r.datum)}${p ? html` · Projekt <a class="bbz-link" href="#/projekt/${p.id}/rechnungen">${p.nummer}</a>` : ''}`,
      aktionen: html`
        <button type="button" class="bbz-button" data-action="pdf">PDF</button>
        ${ctx.istAdmin && ['abgerechnet', 'bezahlt'].includes(r.status) ? html`<button type="button" class="bbz-button" data-action="mail">Per E-Mail</button>` : ''}
        ${ctx.istAdmin && entwurf ? html`<button type="button" class="bbz-button" data-action="position">+ Position</button>` : ''}
        ${ctx.istAdmin && r.status === 'offen_prov' ? html`<button type="button" class="bbz-button" data-action="def-vereinbart">Definitiv vereinbart</button>` : ''}
        ${ctx.istAdmin && entwurf ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="festschreiben" ${r.positionen.length ? '' : raw('disabled')}>Festschreiben</button>` : ''}
        ${ctx.istAdmin && r.status === 'abgerechnet' ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="zahlung">Zahlung erfassen</button>` : ''}
        ${ctx.istAdmin && ['abgerechnet', 'bezahlt'].includes(r.status) ? html`<button type="button" class="bbz-button bbz-button-danger" data-action="stornieren">Stornieren</button>` : ''}`,
    })}
    ${finanzTabs('rechnungen')}
    ${entwurf ? banner('Entwurf: Positionen sind änderbar. Mit dem Festschreiben erhält die Rechnung ihre lückenlose Nummer und ist danach gesperrt.', 'info') : ''}
    <div class="bbz-kpis">
      ${kpi({ titel: 'Netto', zahl: chf(r.totalNetto) })}
      ${kpi({ titel: 'MWSt', zahl: chf(r.totalMwst), sub: r.mwstModus === 'inkl' ? 'inklusive' : 'exklusive' })}
      ${kpi({ titel: 'Brutto', zahl: chf(r.totalBrutto) })}
      ${kpi({ titel: 'Offen', zahl: html`<span class="${offen > 0 && heute() > faellig ? 'bbz-danger' : ''}" data-testid="rechnung-offen">${offen === null ? '–' : chf(offen)}</span>`, sub: r.status === 'abgerechnet' ? `fällig ${datum(faellig)}` : '' })}
    </div>
    <div class="bbz-g2-wide">
      ${sektion({
        titel: `Positionen (${r.positionen.length})`, flush: true, testid: 'positionen',
        inhalt: tabelle({
          zeilen: r.positionen, leer: 'Noch keine Positionen',
          spalten: [
            { titel: 'Pos.', klasse: 'num', wert: (x) => x.position },
            { titel: 'Beschreibung', wert: (x) => html`<span class="bbz-pre">${x.beschreibung}</span>` },
            { titel: 'Menge', klasse: 'num', wert: (x) => html`${zahl(x.menge, 2)} ${x.einheit}` },
            { titel: 'Preis', klasse: 'num', wert: (x) => chf(x.einzelpreis) },
            { titel: 'MWSt', klasse: 'num', wert: (x) => `${zahl(x.mwstSatz)} %` },
            { titel: 'Netto', klasse: 'num', wert: (x) => chf(x.betragNetto) },
          ],
          fuss: html`<tr><td colspan="5">Total netto</td><td class="num">${chf(r.totalNetto)}</td></tr><tr><td colspan="5">MWSt</td><td class="num">${chf(r.totalMwst)}</td></tr><tr><td colspan="5">Total brutto</td><td class="num">${chf(r.totalBrutto)}</td></tr>`,
        }),
      })}
      <div>
        ${sektion({ titel: 'Rechnungsempfänger', inhalt: a ? html`<address class="bbz-pre">${a.name}\n${a.ansprechperson ? `${a.ansprechperson}\n` : ''}${a.strasse}\n${a.plz} ${a.ort}${a.land && a.land !== 'CH' ? `\n${a.land}` : ''}</address>` : leerHinweis('–') })}
        ${sektion({ titel: 'Angaben', inhalt: html`<dl class="bbz-dl"><dt>Betreff</dt><dd>${r.betreff ?? '–'}</dd><dt>Währung</dt><dd>${r.waehrung}</dd><dt>Laufnummer</dt><dd>${r.lfdNr ?? '–'}</dd>${posten ? html`<dt>Bezahlt</dt><dd>${chf(posten.bezahlt)}</dd>` : ''}</dl>` })}
        ${mahnungen?.length ? sektion({ titel: 'Mahnungen', inhalt: html`<ul class="bbz-tl">${mahnungen.map((m) => html`<li><span class="dot rot" aria-hidden="true"></span><div><div class="h">${m.bezeichnung ?? STUFE[m.stufe]}</div><div class="m">${datum(m.datum)} · Frist ${datum(m.fristBis)} · Gebühr ${chf(m.gebuehrChf)}</div></div></li>`)}</ul>` }) : ''}
      </div>
    </div>`);

  const fertig = (m) => { toast(m, 'success'); ctx.neu(); };
  ctx.aktion('pdf', () => herunterladen(`/rechnung/${id}/pdf`, { dateiname: `rechnung-${r.nummer ?? 'entwurf'}.pdf`.replace(/\s+/g, ''), oeffnen: true }));
  ctx.aktion('mail', async () => {
    const m = await formModal({
      titel: `Rechnung ${r.nummer} per E-Mail`, submitText: 'Versenden', testid: 'rechnung-mail',
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">Die Rechnung geht mit dem QR-PDF als Anhang in den Versand (Outbox). Leer = E-Mail-Adresse des Debitors${a?.email ? ` (${a.email})` : ''}.</p>`,
        feld({ name: 'an', label: 'An', typ: 'email', wert: '', span2: true, attr: { placeholder: a?.email ?? 'buchhaltung@bank.ch' } }),
      ),
      onSubmit: (w) => post(`/rechnung/${id}/mail`, ohneLeere(w)),
    });
    if (m) toast(`Rechnung an ${m.an} in den Versand gestellt`, 'success');
  });
  ctx.aktion('position', async () => {
    const MWST = await store.mwstOptionen();
    const x = await formModal({
      titel: 'Position hinzufügen',
      felder: formGrid(
        feld({ name: 'beschreibung', label: 'Beschreibung', typ: 'textarea', pflicht: true, span2: true }),
        feld({ name: 'menge', label: 'Menge', typ: 'number', wert: 1, pflicht: true, attr: { min: 0, step: '0.25' } }),
        feld({ name: 'einheit', label: 'Einheit', wert: 'Pauschal' }),
        feld({ name: 'einzelpreis', label: 'Einzelpreis CHF', typ: 'number', pflicht: true, attr: { step: '0.05' } }),
        feld({ name: 'mwstSatz', label: 'MWSt-Satz', typ: 'select', optionen: MWST, wert: '8.1' }),
      ),
      onSubmit: (w) => post(`/rechnung/${id}/position`, ohneLeere({ ...w, mwstSatz: Number(w.mwstSatz) })),
    });
    if (x) fertig('Position hinzugefügt');
  });
  ctx.aktion('def-vereinbart', async () => { await post(`/rechnung/${id}/def-vereinbart`); fertig('Als definitiv vereinbart markiert'); });
  ctx.aktion('festschreiben', async () => {
    if (!(await bestaetigen(`Rechnung über ${chf(r.totalBrutto)} festschreiben? Die Nummer wird vergeben und die Rechnung gesperrt.`, { okText: 'Festschreiben' }))) return;
    const f = await post(`/rechnung/${id}/festschreiben`, { erstellerKuerzel: ctx.benutzer.kuerzel });
    fertig(`Festgeschrieben: ${f.nummer}`);
  });
  ctx.aktion('zahlung', async () => {
    const z = await formModal({
      titel: 'Zahlung erfassen', testid: 'zahlung-form',
      felder: formGrid(
        feld({ name: 'datum', label: 'Valuta', typ: 'date', wert: heute(), pflicht: true }),
        feld({ name: 'betrag', label: 'Betrag CHF', typ: 'number', wert: offen ?? r.totalBrutto, pflicht: true, attr: { min: 0.05, step: '0.05' } }),
        feld({ name: 'bemerkung', label: 'Bemerkung', span2: true }),
      ),
      onSubmit: (w) => post(`/rechnung/${id}/zahlung`, ohneLeere({ ...w, erfasstDurch: ctx.benutzer.kuerzel })),
    });
    if (z) fertig(z.offen > 0 ? `Zahlung erfasst – noch offen ${chf(z.offen)}` : 'Zahlung erfasst – Rechnung bezahlt');
  });
  ctx.aktion('stornieren', async () => {
    const s = await formModal({
      titel: `Rechnung ${r.nummer} stornieren`, submitText: 'Stornieren', gefahr: true,
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">Die Nummer bleibt belegt. Verrechnete Zeit, Anmeldungen und SAQ-Fälle werden für eine korrigierte Rechnung freigegeben.</p>`,
        feld({ name: 'grund', label: 'Grund', pflicht: true, span2: true }),
      ),
      onSubmit: (w) => post(`/rechnung/${id}/stornieren`, w),
    });
    if (s) fertig('Rechnung storniert');
  });
}

export async function offenePosten(ctx) {
  const agId = ctx.query.auftraggeberId || undefined;
  const [op, ag, saldo] = await Promise.all([
    get('/debitoren/offene-posten', { auftraggeberId: agId }), store.auftraggeber(),
    agId ? get(`/auftraggeber/${agId}/saldo`) : Promise.resolve(null),
  ]);
  const agMap = store.nachId(ag);
  const h = heute();
  const total = op.reduce((s, p) => s + p.offen, 0);
  const ueberfaellig = (p) => tageZwischen(addTage(p.datum, ZAHLUNGSFRIST), h);
  const jeAg = [...op.reduce((m, p) => m.set(p.auftraggeberId, (m.get(p.auftraggeberId) ?? 0) + p.offen), new Map())]
    .map(([id, betrag]) => ({ id, betrag })).sort((a, b) => b.betrag - a.betrag);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Offene Posten', untertitel: `Festgeschriebene, nicht vollständig bezahlte Rechnungen · Zahlungsfrist ${ZAHLUNGSFRIST} Tage` })}
    ${finanzTabs('op')}
    <form class="bbz-filterbar compact" data-form="filter" aria-label="Offene Posten filtern">
      ${feld({ name: 'auftraggeberId', label: 'Auftraggeber', typ: 'select', optionen: ag.map((a) => [a.id, a.name]), wert: agId, leerOption: 'Alle', attr: { 'data-change': 'filter' } })}
    </form>
    <div class="bbz-kpis">
      ${kpi({ titel: 'Total offen', zahl: chf(total), sub: `${op.length} Rechnungen`, testid: 'op-total' })}
      ${kpi({ titel: 'Überfällig', zahl: chf(op.filter((p) => ueberfaellig(p) > 0).reduce((s, p) => s + p.offen, 0)), sub: `${op.filter((p) => ueberfaellig(p) > 0).length} Rechnungen` })}
      ${saldo ? kpi({ titel: 'Kontokorrent-Saldo', zahl: chf(saldo.saldo), sub: agMap.get(agId)?.name }) : kpi({ titel: 'Debitoren mit Saldo', zahl: jeAg.length })}
    </div>
    <div class="bbz-g2-wide">
      ${sektion({
        titel: 'Posten', flush: true,
        inhalt: tabelle({
          zeilen: op, leer: 'Keine offenen Posten', href: (p) => `#/finanzen/rechnung/${p.rechnungId}`, beschriftung: 'Offene Posten',
          spalten: [
            { titel: 'Nummer', klasse: 'nowrap', wert: (p) => html`<a class="bbz-link" href="#/finanzen/rechnung/${p.rechnungId}">${p.nummer ?? '–'}</a>` },
            { titel: 'Auftraggeber', wert: (p) => agMap.get(p.auftraggeberId)?.name ?? '–' },
            { titel: 'Datum', klasse: 'nowrap', wert: (p) => datum(p.datum) },
            { titel: 'Fällig', klasse: 'nowrap', wert: (p) => html`${datum(addTage(p.datum, ZAHLUNGSFRIST))}${ueberfaellig(p) > 0 ? html`<div class="bbz-small bbz-danger">${ueberfaellig(p)} Tage überfällig</div>` : ''}` },
            { titel: 'Brutto', klasse: 'num', wert: (p) => chf(p.totalBrutto) },
            { titel: 'Bezahlt', klasse: 'num', wert: (p) => chf(p.bezahlt) },
            { titel: 'Offen', klasse: 'num', wert: (p) => html`<strong>${chf(p.offen)}</strong>` },
          ],
          fuss: op.length ? html`<tr><td colspan="6">Total</td><td class="num">${chf(total)}</td></tr>` : '',
        }),
      })}
      ${sektion({
        titel: 'Saldo je Debitor', flush: true,
        inhalt: tabelle({
          zeilen: jeAg, leer: 'Keine Salden', href: (x) => `#/finanzen/offene-posten?auftraggeberId=${x.id}`,
          spalten: [
            { titel: 'Debitor', wert: (x) => html`<a class="bbz-link" href="#/finanzen/offene-posten?auftraggeberId=${x.id}">${agMap.get(x.id)?.name ?? '–'}</a>` },
            { titel: 'Saldo', klasse: 'num', wert: (x) => chf(x.betrag) },
          ],
        }),
      })}
    </div>`);
  ctx.aenderung('filter', (el) => ctx.navigiere(`/finanzen/offene-posten${el.value ? `?auftraggeberId=${encodeURIComponent(el.value)}` : ''}`));
  ctx.formular('filter', () => undefined);
}

export async function mahnwesen(ctx) {
  const stichtag = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.stichtag ?? '') ? ctx.query.stichtag : heute();
  let vorschlag;
  try {
    vorschlag = await get('/debitoren/mahnvorschlag', { stichtag }, { ruhig: true });
  } catch (e) {
    if (!istModulFehlt(e)) throw e;
    ctx.zeige(html`${seitenkopf({ titel: 'Mahnwesen' })}${finanzTabs('mahnwesen')}${modulFehlt('Mahnwesen')}`);
    return;
  }
  const ag = await store.auftraggeber();
  const agMap = store.nachId(ag);
  const faellig = vorschlag.filter((p) => p.naechsteStufe);
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Mahnwesen', untertitel: 'Stufe 1 Erinnerung (10 Tage, ohne Gebühr), ab Stufe 2 CHF 50 Gebühr, nach Stufe 3 Inkasso' })}
    ${finanzTabs('mahnwesen')}
    <form class="bbz-filterbar compact" data-form="stichtag" aria-label="Stichtag">
      ${feld({ name: 'stichtag', label: 'Stichtag', typ: 'date', wert: stichtag, attr: { 'data-change': 'stichtag' } })}
    </form>
    <form data-form="mahnlauf" data-testid="mahnvorschlag">
      <section class="bbz-section">
        <div class="bbz-section-header"><div><h2 class="bbz-section-title">Mahnvorschlag (${faellig.length} fällig)</h2><div class="bbz-section-subtitle">überfällige offene Posten mit nächster Stufe</div></div>
          ${ctx.istAdmin && faellig.length ? html`<button type="submit" class="bbz-button bbz-button-primary bbz-button-sm">Mahnlauf für Auswahl</button>` : ''}</div>
        ${tabelle({
          zeilen: vorschlag, leer: 'Keine überfälligen Posten', beschriftung: 'Mahnvorschlag',
          spalten: [
            { titel: '', wert: (p) => (p.naechsteStufe && ctx.istAdmin ? html`<input type="checkbox" name="rechnungIds" value="${p.rechnungId}" data-typ="liste" checked aria-label="${p.nummer ?? 'Rechnung'} mahnen">` : '') },
            { titel: 'Nummer', klasse: 'nowrap', wert: (p) => html`<a class="bbz-link" href="#/finanzen/rechnung/${p.rechnungId}">${p.nummer ?? '–'}</a>` },
            { titel: 'Auftraggeber', wert: (p) => agMap.get(p.auftraggeberId)?.name ?? '–' },
            { titel: 'Fällig', klasse: 'nowrap', wert: (p) => datum(p.faelligAm) },
            { titel: 'Offen', klasse: 'num', wert: (p) => chf(p.offen) },
            { titel: 'Letzte Stufe', wert: (p) => (p.letzteStufe ? STUFE[p.letzteStufe] : '–') },
            { titel: 'Nächste Stufe', wert: (p) => (p.inkasso ? chip('Inkasso', 'red') : p.naechsteStufe ? chip(STUFE[p.naechsteStufe], p.naechsteStufe > 1 ? 'red' : 'amber') : html`<span class="bbz-muted">Frist läuft</span>`) },
            { titel: 'Gebühr', klasse: 'num', wert: (p) => chf(p.gebuehr) },
          ],
        })}
      </section></form>`);
  ctx.aenderung('stichtag', (el) => ctx.navigiere(`/finanzen/mahnwesen?stichtag=${encodeURIComponent(el.value)}`));
  ctx.formular('stichtag', () => undefined);
  ctx.formular('mahnlauf', async (_f, w) => {
    const ids = w.rechnungIds ?? [];
    if (!ids.length) { toast('Keine Rechnung ausgewählt', 'warning'); return; }
    if (!(await bestaetigen(`Mahnlauf per ${datum(stichtag)} für ${ids.length} Rechnung(en) ausführen?`, { okText: 'Mahnlauf ausführen' }))) return;
    const r = await post('/debitoren/mahnlauf', { stichtag, rechnungIds: ids });
    modal({
      titel: 'Mahnlauf ausgeführt',
      inhalt: r.mahnungen?.length ? html`<ul class="bbz-tl">${r.mahnungen.map((m) => html`<li><span class="dot rot" aria-hidden="true"></span><div><div class="h">${m.bezeichnung ?? STUFE[m.stufe]}</div><div class="m">offen ${chf(m.offenChf)} · Gebühr ${chf(m.gebuehrChf)} · Frist ${datum(m.fristBis)}</div></div></li>`)}</ul>` : leerHinweis('Keine Mahnungen erzeugt'),
      fuss: html`<button type="button" class="bbz-button bbz-button-primary" data-modal-close>OK</button>`,
      onClose: () => ctx.neu(),
    });
  });
}

/* ---------- Zahlungsimport (camt.054) ---------- */

const camtErgebnis = (e) => html`
  <div class="bbz-kpis" data-testid="camt-ergebnis">
    ${kpi({ titel: 'Verbucht', zahl: e.verbucht.length, sub: chf(e.verbucht.reduce((s, v) => s + v.betrag, 0)) })}
    ${kpi({ titel: 'Bereits verbucht', zahl: e.bereitsVerbucht, sub: 'nicht doppelt erfasst' })}
    ${kpi({ titel: 'Nicht zugeordnet', zahl: e.nichtZugeordnet.length, sub: chf(e.nichtZugeordnet.reduce((s, n) => s + n.betrag, 0)) })}
    ${kpi({ titel: 'Belastungen', zahl: e.belastungenIgnoriert, sub: 'nicht verbucht' })}
  </div>
  ${sektion({ titel: 'Verbuchte Zahlungen', flush: true, inhalt: tabelle({
    zeilen: e.verbucht, leer: 'Keine Zahlung verbucht', href: (v) => `#/finanzen/rechnung/${v.rechnungId}`,
    spalten: [
      { titel: 'Rechnung', klasse: 'nowrap', wert: (v) => html`<a class="bbz-link" href="#/finanzen/rechnung/${v.rechnungId}">${v.nummer}</a>` },
      { titel: 'Valuta', klasse: 'nowrap', wert: (v) => datum(v.datum) },
      { titel: 'Betrag', klasse: 'num', wert: (v) => chf(v.betrag) },
      { titel: 'Noch offen', klasse: 'num', wert: (v) => chf(v.offen) },
      { titel: 'Status', wert: (v) => statusChip('rechnungStatus', v.rechnungStatus) },
    ],
  }) })}
  ${e.nichtZugeordnet.length ? sektion({ titel: 'Nicht zugeordnet – manuell erfassen', flush: true, inhalt: tabelle({
    zeilen: e.nichtZugeordnet, leer: '',
    spalten: [
      { titel: 'Valuta', klasse: 'nowrap', wert: (n) => datum(n.datum) },
      { titel: 'Betrag', klasse: 'num', wert: (n) => chf(n.betrag) },
      { titel: 'Referenz / Mitteilung', wert: (n) => n.referenz ?? n.mitteilung ?? '–' },
      { titel: 'Grund', wert: (n) => chip(n.grund, 'amber') },
    ],
  }) }) : ''}`;

export async function zahlungen(ctx) {
  if (!ctx.istAdmin) return nurAdmin(ctx, 'Zahlungsimport', 'zahlungen');
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Zahlungsimport', untertitel: 'Bankauszug camt.054 (QR-Zahlungen) verbuchen – Zuordnung über die QR-Referenz' })}
    ${finanzTabs('zahlungen')}
    <section class="bbz-section"><form data-form="camt" class="bbz-form-grid" data-testid="camt-form">
      ${feld({ name: 'datei', label: 'camt.054-Datei (XML)', typ: 'file', pflicht: true, span2: true, attr: { accept: '.xml,application/xml,text/xml' } })}
      <p class="bbz-span-2 bbz-small bbz-muted">Teilzahlungen bleiben als Restbetrag offen. Dieselbe Datei nochmals verbucht nichts doppelt. Zahlungen ohne passende Referenz bleiben stehen und werden aufgeführt.</p>
      <div class="bbz-field"><button type="submit" class="bbz-button bbz-button-primary">Verbuchen</button></div>
    </form></section>
    <div data-ergebnis></div>`);
  ctx.formular('camt', async (f) => {
    const datei = f.querySelector('input[type=file]').files?.[0];
    if (!datei) { toast('Keine Datei gewählt', 'warning'); return; }
    const e = await post('/debitoren/camt054', { xml: await datei.text() });
    toast(`${e.verbucht.length} Zahlung(en) verbucht${e.nichtZugeordnet.length ? `, ${e.nichtZugeordnet.length} nicht zugeordnet` : ''}`, e.nichtZugeordnet.length ? 'warning' : 'success');
    setHtml(ctx.el.querySelector('[data-ergebnis]'), camtErgebnis(e));
  });
}

/* ---------- Sammelrechnung je Bank ---------- */

/** Standard-Zeitraum: das letzte abgeschlossene Halbjahr. */
function letztesHalbjahr() {
  const h = heute(); const j = Number(h.slice(0, 4));
  return h.slice(5) > '06-30' ? { von: `${j}-01-01`, bis: `${j}-06-30` } : { von: `${j - 1}-07-01`, bis: `${j - 1}-12-31` };
}

export async function sammelrechnung(ctx) {
  if (!ctx.istAdmin) return nurAdmin(ctx, 'Sammelrechnung', 'sammelrechnung');
  const std = letztesHalbjahr();
  const von = istIso(ctx.query.von) ? ctx.query.von : std.von;
  const bis = istIso(ctx.query.bis) ? ctx.query.bis : std.bis;
  const v = await get('/verrechnung/sammelrechnung', { von, bis });
  const total = v.empfaenger.reduce((s, e) => s + e.betragChf, 0);
  const ohne = [...v.ohneEmpfaenger.map((o) => ({ ...o, grund: 'kein Rechnungsempfänger' })), ...v.ohneProjekt.map((o) => ({ ...o, grund: 'Durchführung ohne Projekt' }))];
  ctx.zeige(html`
    ${seitenkopf({
      titel: 'Sammelrechnung je Bank', untertitel: 'Alle offenen Anmeldungen der Kurse, die im Zeitraum beginnen – je Rechnungsempfänger eine Rechnung (Firmenkurse ausgenommen)',
      aktionen: v.empfaenger.length ? html`<button type="button" class="bbz-button bbz-button-primary" data-action="sammel-erstellen">Rechnungsentwürfe erstellen</button>` : '',
    })}
    ${finanzTabs('sammelrechnung')}
    <form class="bbz-filterbar compact" data-form="zeitraum" aria-label="Zeitraum">
      ${feld({ name: 'von', label: 'Kursbeginn von', typ: 'date', wert: von, attr: { 'data-change': 'zeitraum' } })}
      ${feld({ name: 'bis', label: 'bis', typ: 'date', wert: bis, attr: { 'data-change': 'zeitraum' } })}
    </form>
    <div class="bbz-kpis">
      ${kpi({ titel: 'Rechnungsempfänger', zahl: v.empfaenger.length })}
      ${kpi({ titel: 'Anmeldungen', zahl: v.empfaenger.reduce((s, e) => s + e.anmeldungen, 0) })}
      ${kpi({ titel: 'Betrag', zahl: chf(total), sub: 'ohne Nebenkosten und MWSt' })}
      ${kpi({ titel: 'Zu klären', zahl: ohne.length, sub: 'werden nicht verrechnet' })}
    </div>
    <div class="bbz-g2-wide">
      ${sektion({ titel: 'Je Rechnungsempfänger', flush: true, testid: 'sammel-vorschau', inhalt: tabelle({
        zeilen: v.empfaenger, leer: 'Nichts zu verrechnen in diesem Zeitraum',
        spalten: [
          { titel: 'Empfänger', wert: (e) => html`<a class="bbz-link" href="#/finanzen/rechnungen?auftraggeberId=${e.auftraggeberId}">${e.name}</a>` },
          { titel: 'Anmeldungen', klasse: 'num', wert: (e) => e.anmeldungen },
          { titel: 'Betrag', klasse: 'num', wert: (e) => chf(e.betragChf) },
        ],
        fuss: v.empfaenger.length ? html`<tr><td colspan="2">Total</td><td class="num">${chf(total)}</td></tr>` : '',
      }) })}
      ${sektion({ titel: `Zu klären (${ohne.length})`, untertitel: 'Rechnungsempfänger an der Anmeldung setzen oder die Person einer Organisation mit Debitor zuordnen', flush: true, inhalt: tabelle({
        zeilen: ohne, leer: 'Alles zugeordnet',
        spalten: [
          { titel: 'Person', wert: (o) => o.name },
          { titel: 'Durchführung', klasse: 'nowrap', wert: (o) => o.durchfuehrungCode ?? '–' },
          { titel: 'Grund', wert: (o) => chip(o.grund, 'amber') },
        ],
      }) })}
    </div>`);
  ctx.aenderung('zeitraum', () => {
    const w = formWerte(ctx.el.querySelector('form[data-form=zeitraum]'));
    ctx.navigiere(`/finanzen/sammelrechnung?${new URLSearchParams(ohneLeere(w))}`);
  });
  ctx.formular('zeitraum', () => undefined);
  ctx.aktion('sammel-erstellen', async () => {
    const e = await formModal({
      titel: 'Sammelrechnungen erstellen', submitText: 'Entwürfe erstellen', testid: 'sammel-form',
      felder: formGrid(
        html`<p class="bbz-span-2 bbz-small bbz-muted">${v.empfaenger.length} Rechnungsentwürfe über ${chf(total)} (zzgl. Nebenkosten/MWSt). Die Anmeldungen gelten danach als verrechnet; Festschreiben wie gewohnt in der Rechnung.</p>`,
        feld({ name: 'datum', label: 'Rechnungsdatum', typ: 'date', wert: heute(), pflicht: true }),
      ),
      onSubmit: (w) => post('/verrechnung/sammelrechnung', { von, bis, datum: w.datum }),
    });
    if (!e) return;
    modal({
      titel: `${e.rechnungen.length} Sammelrechnung(en) erstellt`,
      inhalt: html`<ul class="bbz-tl">${e.rechnungen.map((r) => html`<li><span class="dot" aria-hidden="true"></span><div><div class="h"><a class="bbz-link" href="#/finanzen/rechnung/${r.id}" data-modal-close>Entwurf ${datum(r.datum)}</a></div><div class="m">${r.positionen.length} Positionen · ${chf(r.totalBrutto)}</div></div></li>`)}</ul>`,
      fuss: html`<button type="button" class="bbz-button bbz-button-primary" data-modal-close>OK</button>`,
      onClose: () => ctx.neu(),
    });
  });
}

/* ---------- Kontenauswertung ---------- */

export async function auswertung(ctx) {
  if (!ctx.istAdmin) return nurAdmin(ctx, 'Kontenauswertung', 'auswertung');
  const j = heute().slice(0, 4);
  const von = istIso(ctx.query.von) ? ctx.query.von : `${j}-01-01`;
  const bis = istIso(ctx.query.bis) ? ctx.query.bis : `${j}-12-31`;
  const a = await get('/finanzen/konten-auswertung', { von, bis });
  const summe = (l, f) => l.reduce((s, x) => s + x[f], 0);
  const konto = (x) => (x.kontoNummer ? `${x.kontoNummer}${x.bezeichnung ? ` ${x.bezeichnung}` : ''}` : 'ohne Konto');
  ctx.zeige(html`
    ${seitenkopf({ titel: 'Kontenauswertung', untertitel: 'Ertrag festgeschriebener Rechnungen je Konto und Kunde (Storno netto 0), Honorare je Aufwandkonto' })}
    ${finanzTabs('auswertung')}
    <form class="bbz-filterbar compact" data-form="zeitraum" aria-label="Zeitraum">
      ${feld({ name: 'von', label: 'Von', typ: 'date', wert: von, attr: { 'data-change': 'zeitraum' } })}
      ${feld({ name: 'bis', label: 'Bis', typ: 'date', wert: bis, attr: { 'data-change': 'zeitraum' } })}
    </form>
    <div class="bbz-kpis">
      ${kpi({ titel: 'Ertrag netto', zahl: chf(summe(a.ertrag, 'nettoChf')), testid: 'ertrag-total' })}
      ${kpi({ titel: 'Honorare', zahl: chf(summe(a.aufwand, 'honorarChf')) })}
      ${kpi({ titel: 'Deckungsbeitrag', zahl: chf(summe(a.ertrag, 'nettoChf') - summe(a.aufwand, 'honorarChf')), sub: 'Ertrag minus Honorare' })}
    </div>
    <div class="bbz-g2-wide">
      <div>
        ${sektion({ titel: 'Ertrag je Konto', flush: true, inhalt: tabelle({
          zeilen: a.ertrag, leer: 'Kein Ertrag im Zeitraum',
          spalten: [{ titel: 'Konto', wert: konto }, { titel: 'Netto', klasse: 'num', wert: (x) => chf(x.nettoChf) }],
          fuss: a.ertrag.length ? html`<tr><td>Total</td><td class="num">${chf(summe(a.ertrag, 'nettoChf'))}</td></tr>` : '',
        }) })}
        ${sektion({ titel: 'Ertrag je Konto und Kunde', flush: true, inhalt: tabelle({
          zeilen: a.ertragJeAuftraggeber, leer: 'Kein Ertrag im Zeitraum',
          spalten: [
            { titel: 'Konto', klasse: 'nowrap', wert: (x) => x.kontoNummer ?? '–' },
            { titel: 'Kunde', wert: (x) => html`<a class="bbz-link" href="#/finanzen/rechnungen?auftraggeberId=${x.auftraggeberId}">${x.auftraggeber}</a>` },
            { titel: 'Netto', klasse: 'num', wert: (x) => chf(x.nettoChf) },
          ],
        }) })}
      </div>
      ${sektion({ titel: 'Aufwand (Honorare) je Konto', flush: true, inhalt: tabelle({
        zeilen: a.aufwand, leer: 'Keine Honorare im Zeitraum',
        spalten: [{ titel: 'Konto', wert: konto }, { titel: 'Honorare', klasse: 'num', wert: (x) => chf(x.honorarChf) }],
      }) })}
    </div>`);
  ctx.aenderung('zeitraum', () => {
    const w = formWerte(ctx.el.querySelector('form[data-form=zeitraum]'));
    ctx.navigiere(`/finanzen/auswertung?${new URLSearchParams(ohneLeere(w))}`);
  });
  ctx.formular('zeitraum', () => undefined);
}

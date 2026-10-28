// Cockpit (Startseite): Zone 1 "Handeln" (was braucht mich jetzt?), Zone 2 "Steuern" (Pipeline, Projekte, Kurse, Finanzen).
// Aggregation clientseitig, da GET /dashboard (Spec §5.6) serverseitig noch fehlt.
import { get, patch } from '../api.js';
import * as store from '../store.js';
import {
  html, seitenkopf, sektion, chf, chfKurz, datum, label, ampel, belegung, leerHinweis, heute, toast, balken, statusChip, zahl,
} from '../ui.js';
import { aufgabenListe } from './teile.js';

const OFFENE_PHASEN = ['lead', 'qualifiziert', 'offeriert', 'verhandlung'];

function kachel({ n, titel, sub, href, heiss = false, testid }) {
  const cls = n === 0 ? 'is-zero' : heiss ? 'is-hot' : '';
  const inner = html`<div class="n">${n}</div><div class="t">${titel}</div>${sub ? html`<div class="s">${sub}</div>` : ''}`;
  return n === 0 || !href
    ? html`<div class="bbz-ai ${cls}" data-testid="${testid}">${inner}</div>`
    : html`<a class="bbz-ai ${cls}" href="${href}" data-testid="${testid}">${inner}</a>`;
}

const zone = (no, titel, frage) => html`<div class="bbz-zone"><span class="no" aria-hidden="true">${no}</span><h2>${titel}</h2><span class="q">${frage}</span><span class="ln"></span></div>`;

export async function cockpit(ctx) {
  const ich = ctx.benutzer.mitarbeitendeId;
  const h = heute();
  const [wv, meine, anfragen, pipeline, portfolio, durchf, op, outbox, ma, ag] = await Promise.all([
    get('/crm/wiedervorlagen', { mitarbeitendeId: ich }),
    ich ? get('/aufgabe', { zustaendigId: ich, status: 'offen,in_arbeit,review' }) : Promise.resolve([]),
    get('/anfrage', { status: 'neu', limit: 5 }),
    get('/verkaufschance/pipeline'),
    get('/projekt/portfolio', { status: 'akquise,offeriert,laufend' }),
    get('/durchfuehrung', { von: h, status: 'geplant,ausgeschrieben,bestaetigt' }),
    get('/debitoren/offene-posten'),
    ctx.istAdmin ? Promise.all([get('/admin/outbox', { status: 'fehler' }), get('/admin/outbox', { status: 'tot' })]) : Promise.resolve(null),
    store.mitarbeitende(), store.auftraggeber(),
  ]);
  const maMap = store.nachId(ma);
  const agMap = store.nachId(ag);
  const projektAufgaben = meine.filter((a) => a.projektId);
  const ueberProjekt = projektAufgaben.filter((a) => a.faelligAm && a.faelligAm < h);
  const ueberfaellig = wv.ueberfaellig.length + ueberProjekt.length;
  const crmListe = [...wv.ueberfaellig, ...wv.dieseWoche, ...wv.spaeter, ...wv.ohneTermin];
  const kritisch = portfolio.filter((p) => p.ampel !== 'gruen').sort((a, b) => (a.ampel === 'rot' ? -1 : 0) - (b.ampel === 'rot' ? -1 : 0));
  const opTotal = op.reduce((s, p) => s + p.offen, 0);
  const opUeber = op.filter((p) => p.datum < h && (Date.parse(h) - Date.parse(p.datum)) / 86400000 > 30);
  const outboxFehler = outbox ? outbox[0].length + outbox[1].length : 0;
  const offenePhasen = pipeline.phasen.filter((p) => OFFENE_PHASEN.includes(p.phase));
  const maxGew = Math.max(1, ...offenePhasen.map((p) => p.gewichtetChf));
  const naechste = durchf.slice(0, 6);
  const wochentagText = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' }).format(new Date());

  ctx.aktion('aufgabe-erledigt', async (el) => {
    await patch(`/aufgabe/${el.dataset.id}`, { status: 'erledigt' });
    toast('Aufgabe erledigt', 'success');
    ctx.neu();
  });

  ctx.zeige(html`<div data-testid="cockpit">
    ${seitenkopf({ titel: `Guten Tag, ${ctx.benutzer.name ?? ctx.benutzer.kuerzel}`, untertitel: wochentagText })}
    ${!ich ? html`<div class="bbz-banner bbz-banner-warning">Ihr Kürzel ist nicht als Mitarbeitende erfasst – persönliche Aufgaben können nicht zugeordnet werden.</div>` : ''}
    ${zone(1, 'Handeln', 'Was braucht mich jetzt?')}
    <div class="bbz-act" data-testid="cockpit-kacheln">
      ${kachel({ n: ueberfaellig, titel: 'Überfällig', sub: 'Wiedervorlagen und Projektaufgaben', href: '#/?fokus=aufgaben', heiss: true, testid: 'kachel-ueberfaellig' })}
      ${kachel({ n: wv.dieseWoche.length, titel: 'Diese Woche', sub: 'Wiedervorlagen fällig', href: '#/?fokus=aufgaben', testid: 'kachel-woche' })}
      ${kachel({ n: wv.ohneTermin.length, titel: 'Ohne Termin', sub: 'offene Wiedervorlagen', href: '#/?fokus=aufgaben', testid: 'kachel-ohne-termin' })}
      ${kachel({ n: anfragen.length, titel: 'Neue Anfragen', sub: 'im Eingang', href: '#/crm/anfragen', heiss: true, testid: 'kachel-anfragen' })}
    </div>
    <div class="bbz-g2" id="aufgaben">
      ${sektion({ titel: 'Meine Wiedervorlagen', untertitel: 'CRM-Aufgaben ohne Projekt', inhalt: aufgabenListe(crmListe, { maMap, leer: 'Keine offenen Wiedervorlagen' }), testid: 'meine-wiedervorlagen' })}
      ${sektion({ titel: 'Meine Projektaufgaben', untertitel: 'offen, in Arbeit, Review', inhalt: aufgabenListe(projektAufgaben, { maMap, leer: 'Keine offenen Projektaufgaben' }), testid: 'meine-projektaufgaben' })}
    </div>
    ${zone(2, 'Steuern', 'Wohin entwickelt sich das Geschäft?')}
    <div class="bbz-kpis">
      <div class="bbz-kpi" data-testid="kpi-pipeline"><div class="k-t">Pipeline gewichtet</div><div class="k-n">${chfKurz(pipeline.offen.gewichtetChf)}</div><div class="k-s">${pipeline.offen.anzahl} offene Chancen · Volumen ${chfKurz(pipeline.offen.summeChf)}</div></div>
      <a class="bbz-kpi" href="#/finanzen/offene-posten" data-testid="kpi-offene-posten"><div class="k-t">Offene Posten</div><div class="k-n">${chf(opTotal)}</div><div class="k-s">${op.length} Rechnungen${opUeber.length ? html` · <span class="bbz-danger">${opUeber.length} über 30 Tage</span>` : ''}</div></a>
      <a class="bbz-kpi" href="#/projekte" data-testid="kpi-projekte"><div class="k-t">Projekte aktiv</div><div class="k-n">${portfolio.length}</div><div class="k-s">${kritisch.filter((p) => p.ampel === 'rot').length} rot · ${kritisch.filter((p) => p.ampel === 'gelb').length} gelb</div></a>
      ${ctx.istAdmin
        ? html`<a class="bbz-kpi" href="#/admin/outbox" data-testid="kpi-outbox"><div class="k-t">Outbox-Fehler</div><div class="k-n ${outboxFehler ? 'bbz-danger' : ''}">${outboxFehler}</div><div class="k-s">Moodle, Webhooks, Mail</div></a>`
        : html`<a class="bbz-kpi" href="#/crm/anfragen"><div class="k-t">Neue Anfragen</div><div class="k-n">${anfragen.length}</div><div class="k-s">im Eingang</div></a>`}
    </div>
    <div class="bbz-g3">
      ${sektion({
        titel: 'Pipeline gewichtet', untertitel: 'offene Phasen, Wert × Wahrscheinlichkeit', testid: 'cockpit-pipeline',
        aktionen: html`<a class="bbz-button bbz-button-sm" href="#/crm/pipeline">Pipeline</a>`,
        inhalt: html`${offenePhasen.map((p) => html`<div class="bbz-bar-row"><span class="lbl">${label('vkPhase', p.phase)} (${p.anzahl})</span>${balken((p.gewichtetChf / maxGew) * 100, { variante: 'green', label: `${label('vkPhase', p.phase)}: ${chf(p.gewichtetChf)}` })}<span class="val">${chfKurz(p.gewichtetChf)}</span></div>`)}
          ${pipeline.forecast.length ? html`<div class="bbz-small bbz-muted bbz-mt">Forecast nächster Monat: ${chfKurz(pipeline.forecast.find((f) => f.monat >= h.slice(0, 7))?.gewichtetChf ?? 0)}</div>` : ''}`,
      })}
      ${sektion({
        titel: 'Projekte mit Handlungsbedarf', untertitel: 'Ampel gelb oder rot', testid: 'cockpit-ampel',
        aktionen: html`<a class="bbz-button bbz-button-sm" href="#/projekte">Portfolio</a>`,
        inhalt: kritisch.length ? html`<ul class="bbz-tl">${kritisch.map((p) => html`<li><span class="dot ${p.ampel}" aria-hidden="true"></span><div>
            <div class="h"><a class="bbz-link" href="#/projekt/${p.projektId}">${p.nummer} ${p.name}</a> ${ampel(p.ampel)}</div>
            <div class="m">${agMap.get(p.auftraggeberId)?.name ?? ''}${p.projektleitungId ? ` · ${maMap.get(p.projektleitungId)?.kuerzel ?? ''}` : ''}</div>
            ${p.ampelGruende.map((g) => html`<div class="b">${g}</div>`)}</div></li>`)}</ul>` : leerHinweis('Alle aktiven Projekte sind im grünen Bereich'),
      })}
      ${sektion({
        titel: 'Nächste Durchführungen', untertitel: 'Belegung (aktiv / Kapazität)', testid: 'cockpit-durchfuehrungen',
        aktionen: html`<a class="bbz-button bbz-button-sm" href="#/bildung/durchfuehrungen">Alle</a>`,
        inhalt: naechste.length ? html`<ul class="bbz-tl">${naechste.map((d) => html`<li><span class="dot" aria-hidden="true"></span><div>
            <div class="h"><a class="bbz-link" href="#/bildung/durchfuehrung/${d.id}">${d.titel ?? d.kursangebotTitel}</a></div>
            <div class="m">${datum(d.startDatum)}${d.ort ? ` · ${d.ort}` : ''} · ${d.code ?? ''} · ${label('durchfuehrungStatus', d.status)}</div>
            ${belegung(d.belegung)}</div></li>`)}</ul>` : leerHinweis('Keine geplanten Durchführungen'),
      })}
    </div>
    ${anfragen.length ? sektion({
      titel: 'Neue Anfragen', testid: 'cockpit-anfragen', aktionen: html`<a class="bbz-button bbz-button-sm" href="#/crm/anfragen">Zum Eingang</a>`,
      inhalt: html`<ul class="bbz-tl">${anfragen.map((a) => html`<li><span class="dot rot" aria-hidden="true"></span><div>
        <div class="h">${[a.vorname, a.nachname].filter(Boolean).join(' ') || a.email || a.telefon} ${statusChip('anfrageStatus', a.status)}</div>
        <div class="m">${label('anfrageTyp', a.typ)} via ${label('anfrageQuelle', a.quelle)} · ${datum(a.eingegangenAm)}${a.organisationName ? ` · ${a.organisationName}` : ''}</div></div></li>`)}</ul>`,
    }) : ''}
    <p class="bbz-small bbz-muted">Stand ${datum(h)} · Wiedervorlagen später fällig: ${zahl(wv.spaeter.length, 0)}</p>
  </div>`);
  if (ctx.query.fokus === 'aufgaben') document.getElementById('aufgaben')?.scrollIntoView({ block: 'start' });
}

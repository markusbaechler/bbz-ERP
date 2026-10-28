// Wiederverwendbare Ansichtsteile (Aufgaben, Aktivitaeten, Personenwahl). Eine Quelle je Darstellung.
import { get } from '../api.js';
import {
  html, raw, datum, datumZeit, label, statusChip, relativTage, heute, personName, chf, prozent, leerHinweis, setHtml, entprellen, tabs,
} from '../ui.js';

export const crmTabs = (aktiv) => tabs([
  { href: '#/crm/organisationen', label: 'Organisationen', aktiv: aktiv === 'organisationen' },
  { href: '#/crm/kontakte', label: 'Kontakte', aktiv: aktiv === 'kontakte' },
  { href: '#/crm/pipeline', label: 'Pipeline', aktiv: aktiv === 'pipeline' },
  { href: '#/crm/anfragen', label: 'Anfragen-Eingang', aktiv: aktiv === 'anfragen' },
], 'CRM');

/** Aufgabe als Zeile mit Erledigt-Checkbox (data-action="aufgabe-erledigt"). */
export function aufgabeZeile(a, { maMap, bezug = true } = {}) {
  const h = heute();
  const ueber = a.faelligAm && a.faelligAm < h && !['erledigt', 'abgebrochen'].includes(a.status);
  const zust = maMap?.get(a.zustaendigId)?.kuerzel;
  const bezugText = bezug ? [a.organisationName, a.kontaktName, a.verkaufschanceTitel].filter(Boolean).join(' · ') : '';
  const fertig = a.status === 'erledigt';
  return html`<div class="bbz-task">
    <input type="checkbox" ${fertig ? raw('checked disabled') : ''} data-action="aufgabe-erledigt" data-id="${a.id}" aria-label="Als erledigt markieren: ${a.titel}">
    <div class="bbz-task-body">
      <div class="bbz-task-title">${a.titel}</div>
      <div class="bbz-task-meta">
        ${a.faelligAm ? html`<span class="${ueber ? 'bbz-danger' : ''}">fällig ${datum(a.faelligAm)} (${relativTage(a.faelligAm)})</span>` : html`<span>ohne Termin</span>`}
        ${a.prioritaet && a.prioritaet !== 'normal' ? html` · ${label('prioritaet', a.prioritaet)}` : ''}
        ${zust ? html` · ${zust}` : ''}${bezugText ? html` · ${bezugText}` : ''}
        ${a.projektId && bezug ? html` · <a class="bbz-link" href="#/projekt/${a.projektId}/aufgaben">Projekt</a>` : ''}
      </div>
    </div>${a.status && a.status !== 'offen' ? statusChip('aufgabeStatus', a.status) : ''}</div>`;
}

export function aufgabenListe(liste, opts = {}) {
  if (!liste?.length) return leerHinweis(opts.leer ?? 'Keine offenen Aufgaben');
  return html`${liste.map((a) => aufgabeZeile(a, opts))}`;
}

export function aktivitaetenTimeline(liste, { maMap, kontaktMap, orgMap } = {}) {
  if (!liste?.length) return leerHinweis('Noch keine Aktivitäten');
  return html`<ul class="bbz-tl">${liste.map((a) => {
    const wer = maMap?.get(a.mitarbeitendeId)?.kuerzel;
    const k = kontaktMap?.get(a.kontaktId);
    const o = orgMap?.get(a.organisationId);
    return html`<li><span class="dot" aria-hidden="true"></span><div>
      <div class="h">${label('aktivitaetTyp', a.typ)}: ${a.betreff}</div>
      <div class="m">${datumZeit(a.datum)}${wer ? html` · ${wer}` : ''}${k ? html` · <a class="bbz-link" href="#/crm/kontakt/${k.id}">${personName(k)}</a>` : ''}${o ? html` · <a class="bbz-link" href="#/crm/organisation/${o.id}">${o.name}</a>` : ''}</div>
      ${a.notizen ? html`<div class="b">${a.notizen}</div>` : ''}</div></li>`;
  })}</ul>`;
}

export function chancenListe(liste, { orgName } = {}) {
  if (!liste?.length) return leerHinweis('Keine Verkaufschancen');
  return html`<ul class="bbz-tl">${liste.map((v) => html`<li><span class="dot" aria-hidden="true"></span><div>
    <div class="h"><a class="bbz-link" href="#/crm/pipeline?fokus=${v.id}">${v.titel}</a> ${statusChip('vkPhase', v.phase)}</div>
    <div class="m">${chf(v.wertChf)} · ${prozent(v.wahrscheinlichkeit)}${v.erwarteterAbschluss ? html` · Abschluss ${datum(v.erwarteterAbschluss)}` : ''}${orgName ? html` · ${orgName(v)}` : ''}${v.verlustgrund ? html` · Verlustgrund: ${v.verlustgrund}` : ''}</div>
    ${v.projektId ? html`<div class="m"><a class="bbz-link" href="#/projekt/${v.projektId}">Zum Projekt</a></div>` : ''}</div></li>`)}</ul>`;
}

/* ---------- Personenwahl (bestehender Kontakt suchen oder neue Person) ---------- */
let nr = 0;
export function personWahlFelder({ mitOrganisation = [], titel = 'Person' } = {}) {
  const id = `pw${(nr += 1)}`;
  return html`<fieldset class="bbz-field bbz-multi bbz-span-2" data-personwahl="${id}"><legend class="bbz-field-label">${titel}</legend>
    <label class="bbz-multi-item"><input type="radio" name="personModus" value="bestehend" checked> Bestehender Kontakt</label>
    <label class="bbz-multi-item"><input type="radio" name="personModus" value="neu"> Neue Person</label>
  </fieldset>
  <div class="bbz-span-2" data-pw-bestehend>
    <div class="bbz-field bbz-search"><label for="${id}-suche" class="bbz-sr-only">Kontakt suchen</label>
      <input id="${id}-suche" class="bbz-input" type="search" placeholder="Name oder E-Mail suchen …" autocomplete="off" data-pw-suche></div>
    <div data-pw-treffer role="radiogroup" aria-label="Suchtreffer" class="bbz-mt"><div class="bbz-field-hint">Mindestens 2 Zeichen eingeben.</div></div>
  </div>
  <div class="bbz-span-2 bbz-form-grid" data-pw-neu hidden>
    <div class="bbz-field"><label for="${id}-email">E-Mail <span class="bbz-req" aria-hidden="true">*</span></label><input id="${id}-email" class="bbz-input" type="email" name="neuEmail" autocomplete="off"></div>
    <div class="bbz-field"><label for="${id}-anrede">Anrede</label><select id="${id}-anrede" class="bbz-select" name="neuAnrede"><option value="">–</option><option>Frau</option><option>Herr</option><option>Divers</option></select></div>
    <div class="bbz-field"><label for="${id}-vorname">Vorname</label><input id="${id}-vorname" class="bbz-input" name="neuVorname" autocomplete="off"></div>
    <div class="bbz-field"><label for="${id}-nachname">Nachname <span class="bbz-req" aria-hidden="true">*</span></label><input id="${id}-nachname" class="bbz-input" name="neuNachname" autocomplete="off"></div>
    ${mitOrganisation.length ? html`<div class="bbz-field bbz-span-2"><label for="${id}-org">Organisation</label><select id="${id}-org" class="bbz-select" name="neuOrganisationId"><option value="">– keine –</option>${mitOrganisation.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></div>` : ''}
  </div>`;
}

/** Verdrahtet Suche und Moduswechsel im Formular (Listener am Formular, keine Inline-Handler). */
export function personWahlVerdrahten(form) {
  const bestehend = form.querySelector('[data-pw-bestehend]');
  const neu = form.querySelector('[data-pw-neu]');
  const treffer = form.querySelector('[data-pw-treffer]');
  form.querySelectorAll('input[name=personModus]').forEach((r) => r.addEventListener('change', () => {
    const istNeu = form.querySelector('input[name=personModus]:checked').value === 'neu';
    bestehend.hidden = istNeu;
    neu.hidden = !istNeu;
    neu.querySelector('[name=neuEmail]').required = istNeu;
    neu.querySelector('[name=neuNachname]').required = istNeu;
  }));
  const suche = entprellen(async (text) => {
    if (text.trim().length < 2) { setHtml(treffer, html`<div class="bbz-field-hint">Mindestens 2 Zeichen eingeben.</div>`); return; }
    const liste = await get('/kontakt', { suche: text.trim(), limit: 8 });
    setHtml(treffer, liste.length
      ? html`${liste.map((k, i) => html`<label class="bbz-checkbox bbz-treffer"><input type="radio" name="kontaktId" value="${k.id}" ${i === 0 ? raw('required') : ''}> <span><strong>${personName(k)}</strong> <span class="bbz-muted">${k.email ?? ''}${k.funktion ? ` · ${k.funktion}` : ''}</span></span></label>`)}`
      : html`<div class="bbz-field-hint">Keine Treffer – «Neue Person» wählen.</div>`);
  }, 250);
  form.querySelector('[data-pw-suche]').addEventListener('input', (e) => suche(e.target.value));
}

/** Formularwerte -> { kontaktId } oder { kontakt: {...} } (fuer meldeAn / SAQ-Fall). */
export function personAusWerten(w) {
  if (w.personModus === 'neu') {
    if (!w.neuEmail || !w.neuNachname) throw new Error('Für eine neue Person sind E-Mail und Nachname Pflicht.');
    return { kontakt: { email: w.neuEmail, nachname: w.neuNachname, vorname: w.neuVorname ?? null, anrede: w.neuAnrede ?? null, organisationId: w.neuOrganisationId ?? null } };
  }
  if (!w.kontaktId) throw new Error('Bitte einen Kontakt aus der Suche wählen.');
  return { kontaktId: w.kontaktId };
}

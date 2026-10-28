// Gemeinsame Erfassungsdialoge (CRM + PM): Aktivitaet, Aufgabe, Organisation, Kontakt, Verkaufschance, Projekt.
import { get, post, patch, del } from '../api.js';
import * as store from '../store.js';
import { auth } from '../auth.js';
import {
  html, feld, formGrid, formModal, optionenAus, optionen, personName, setHtml, ohneLeere, bestaetigen, heute,
} from '../ui.js';

const jetztLokal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const ich = () => auth.benutzer?.mitarbeitendeId ?? '';

/** Kontakt-Auswahl folgt der Organisation (ohne Re-Render: nur die Optionen werden ersetzt). */
function kontakteNachOrganisation(form, leer = '– keiner –') {
  const org = form.querySelector('[name=organisationId]');
  const sel = form.querySelector('[name=kontaktId]');
  if (!org || !sel) return;
  org.addEventListener('change', async () => {
    const liste = org.value ? await get('/kontakt', { organisationId: org.value }) : [];
    setHtml(sel, optionen(liste.map((k) => [k.id, personName(k)]), '', leer));
  });
}

export async function aktivitaetErfassen(vor = {}) {
  const [orgs, ma] = await Promise.all([store.organisationen(), store.mitarbeitende()]);
  const kontakt = vor.kontaktId ? await get(`/kontakt/${vor.kontaktId}`) : null;
  const orgId = vor.organisationId || kontakt?.organisationId || '';
  const kontakte = orgId ? await get('/kontakt', { organisationId: orgId }) : [];
  if (kontakt && !kontakte.some((k) => k.id === kontakt.id)) kontakte.unshift(kontakt);
  return formModal({
    titel: 'Aktivität erfassen', testid: 'aktivitaet-form', submitText: 'Erfassen',
    felder: formGrid(
      feld({ name: 'typ', label: 'Art', typ: 'select', optionen: optionenAus('aktivitaetTyp'), wert: 'telefon', pflicht: true }),
      feld({ name: 'datum', label: 'Zeitpunkt', typ: 'datetime-local', wert: jetztLokal(), pflicht: true }),
      feld({ name: 'betreff', label: 'Betreff', pflicht: true, span2: true, attr: { maxlength: 300 } }),
      feld({ name: 'organisationId', label: 'Organisation', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), wert: orgId, leerOption: '– keine –' }),
      feld({ name: 'kontaktId', label: 'Kontakt', typ: 'select', optionen: kontakte.map((k) => [k.id, personName(k)]), wert: vor.kontaktId ?? '', leerOption: '– keiner –' }),
      feld({ name: 'notizen', label: 'Notizen', typ: 'textarea', span2: true }),
      feld({ name: 'mitarbeitendeId', label: 'Erfasst für', typ: 'select', optionen: store.maOptionen(ma), wert: ich(), leerOption: '– angemeldete Person –' }),
      feld({ name: 'verkaufschanceId', typ: 'hidden', wert: vor.verkaufschanceId }),
      feld({ name: 'projektId', typ: 'hidden', wert: vor.projektId }),
    ),
    beimOeffnen: (form) => kontakteNachOrganisation(form),
    onSubmit: (w) => {
      if (!w.organisationId && !w.kontaktId) throw new Error('Bitte eine Organisation oder einen Kontakt wählen.');
      return post('/aktivitaet', ohneLeere({ ...w, datum: w.datum ? new Date(w.datum).toISOString() : undefined }));
    },
  });
}

/**
 * Aufgabe erfassen/bearbeiten. vor: { projektId, kontaktId, organisationId, verkaufschanceId, status }.
 * Bei Projektaufgaben: Phase und Vorgaenger waehlbar. Liefert die Aufgabe, { geloescht: true } oder null.
 */
export async function aufgabeFormular({ aufgabe = null, vor = {} } = {}) {
  const projektId = aufgabe?.projektId ?? vor.projektId ?? null;
  const [ma, phasen, geschwister] = await Promise.all([
    store.mitarbeitende(),
    projektId ? get(`/projekt/${projektId}/phase`) : [],
    projektId ? get('/aufgabe', { projektId }) : [],
  ]);
  const a = aufgabe ?? {};
  let geloescht = false;
  const r = await formModal({
    titel: aufgabe ? 'Aufgabe bearbeiten' : (projektId ? 'Aufgabe erfassen' : 'Wiedervorlage erfassen'), testid: 'aufgabe-form',
    felder: formGrid(
      feld({ name: 'titel', label: 'Titel', wert: a.titel, pflicht: true, span2: true }),
      feld({ name: 'beschreibung', label: 'Beschreibung', typ: 'textarea', wert: a.beschreibung, span2: true }),
      feld({ name: 'status', label: 'Status', typ: 'select', optionen: optionenAus('aufgabeStatus'), wert: a.status ?? vor.status ?? 'offen' }),
      feld({ name: 'prioritaet', label: 'Priorität', typ: 'select', optionen: optionenAus('prioritaet'), wert: a.prioritaet ?? 'normal' }),
      feld({ name: 'startDatum', label: 'Start', typ: 'date', wert: a.startDatum }),
      feld({ name: 'faelligAm', label: 'Fällig am', typ: 'date', wert: a.faelligAm }),
      feld({ name: 'zustaendigId', label: 'Zuständig', typ: 'select', optionen: store.maOptionen(ma), wert: a.zustaendigId ?? ich(), leerOption: '– offen –' }),
      projektId ? feld({ name: 'schaetzungStunden', label: 'Schätzung (h)', typ: 'number', wert: a.schaetzungStunden, attr: { min: 0, step: '0.25' } }) : '',
      projektId ? feld({ name: 'phaseId', label: 'Phase', typ: 'select', optionen: phasen.map((p) => [p.id, p.name]), wert: a.phaseId, leerOption: '– keine –' }) : '',
      projektId ? feld({
        name: 'vorgaengerId', label: 'Vorgänger', typ: 'select', leerOption: '– keiner –', wert: a.vorgaengerId,
        optionen: geschwister.filter((g) => g.id !== a.id).map((g) => [g.id, g.titel]),
        hint: 'Start (In Arbeit/Review/Erledigt) erst, wenn der Vorgänger erledigt ist.',
      }) : '',
      aufgabe ? html`<div class="bbz-span-2"><button type="button" class="bbz-button bbz-button-danger bbz-button-sm" data-maction="loeschen">Aufgabe löschen</button></div>` : '',
    ),
    aktionen: {
      async loeschen(_el, _e, m) {
        if (!(await bestaetigen(`Aufgabe «${a.titel}» löschen?`, { okText: 'Löschen', gefahr: true }))) return;
        await del(`/aufgabe/${a.id}`);
        geloescht = true;
        m.schliessen();
      },
    },
    onSubmit: (w) => {
      if (aufgabe) return patch(`/aufgabe/${aufgabe.id}`, w);
      return post('/aufgabe', ohneLeere({
        ...w, projektId, kontaktId: vor.kontaktId, organisationId: vor.organisationId, verkaufschanceId: vor.verkaufschanceId,
      }));
    },
  });
  return geloescht ? { geloescht: true } : r;
}

export async function organisationFormular(org = null) {
  const ma = await store.mitarbeitende();
  const o = org ?? {};
  const r = await formModal({
    titel: org ? 'Organisation bearbeiten' : 'Organisation erfassen', breit: true, testid: 'organisation-form',
    felder: formGrid(
      feld({ name: 'name', label: 'Name', wert: o.name, pflicht: true, span2: true }),
      feld({ name: 'kategorie', label: 'Kategorie', typ: 'select', optionen: optionenAus('kategorie'), wert: o.kategorie ?? 'kunde' }),
      feld({ name: 'klassifizierung', label: 'Klassifizierung', typ: 'select', optionen: optionenAus('klassifizierung'), wert: o.klassifizierung, leerOption: '– ohne –' }),
      feld({ name: 'branche', label: 'Branche', wert: o.branche }),
      feld({ name: 'betreuerId', label: 'Betreuung bbz', typ: 'select', optionen: store.maOptionen(ma), wert: o.betreuerId, leerOption: '– offen –' }),
      feld({ name: 'strasse', label: 'Strasse', wert: o.strasse, span2: true }),
      feld({ name: 'plz', label: 'PLZ', wert: o.plz }),
      feld({ name: 'ort', label: 'Ort', wert: o.ort }),
      feld({ name: 'land', label: 'Land', wert: o.land ?? 'CH', attr: { maxlength: 2 } }),
      feld({ name: 'telefon', label: 'Telefon', typ: 'tel', wert: o.telefon }),
      feld({ name: 'email', label: 'E-Mail', typ: 'email', wert: o.email }),
      feld({ name: 'website', label: 'Website', wert: o.website }),
      feld({ name: 'vip', label: 'VIP', typ: 'checkbox', wert: o.vip }),
      org ? feld({ name: 'archiviert', label: 'Archiviert', typ: 'checkbox', wert: o.archiviert }) : '',
      feld({ name: 'bemerkung', label: 'Bemerkung', typ: 'textarea', wert: o.bemerkung, span2: true }),
    ),
    onSubmit: (w) => (org ? patch(`/organisation/${org.id}`, w) : post('/organisation', ohneLeere(w))),
  });
  if (r) store.verwerfe('organisationen');
  return r;
}

export async function kontaktFormular(kontakt = null, vor = {}) {
  const [ma, orgs] = await Promise.all([store.mitarbeitende(), store.organisationen()]);
  const k = kontakt ?? {};
  return formModal({
    titel: kontakt ? 'Kontakt bearbeiten' : 'Kontakt erfassen', breit: true, testid: 'kontakt-form',
    felder: formGrid(
      feld({ name: 'anrede', label: 'Anrede', typ: 'select', optionen: ['Frau', 'Herr', 'Divers'], wert: k.anrede, leerOption: '–' }),
      feld({ name: 'titel', label: 'Titel', wert: k.titel }),
      feld({ name: 'vorname', label: 'Vorname', wert: k.vorname }),
      feld({ name: 'nachname', label: 'Nachname', wert: k.nachname, pflicht: true }),
      feld({ name: 'organisationId', label: 'Organisation', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), wert: k.organisationId ?? vor.organisationId, leerOption: '– keine –', span2: true }),
      feld({ name: 'funktion', label: 'Funktion', wert: k.funktion }),
      feld({ name: 'abteilung', label: 'Abteilung', wert: k.abteilung }),
      feld({ name: 'email', label: 'E-Mail', typ: 'email', wert: k.email, hint: 'Eindeutig unter aktiven Kontakten' }),
      feld({ name: 'telefon', label: 'Telefon', typ: 'tel', wert: k.telefon }),
      feld({ name: 'mobile', label: 'Mobile', typ: 'tel', wert: k.mobile }),
      feld({ name: 'betreuerId', label: 'Betreuung bbz', typ: 'select', optionen: store.maOptionen(ma), wert: k.betreuerId, leerOption: '– offen –' }),
      feld({ name: 'interessen', label: 'Interessen', typ: 'checkboxes', optionen: optionenAus('interesse'), wert: k.interessen ?? [], span2: true }),
      feld({ name: 'prioritaet', label: 'Priorität', typ: 'select', optionen: [['hoch', 'Hoch'], ['mittel', 'Mittel'], ['tief', 'Tief']], wert: k.prioritaet, leerOption: '–' }),
      feld({ name: 'newsletter', label: 'Newsletter (mit Einwilligung)', typ: 'checkbox', wert: k.newsletter, hint: 'Opt-in setzt den Einwilligungszeitpunkt (nDSG).' }),
      feld({ name: 'einwilligungQuelle', label: 'Quelle der Einwilligung', wert: k.einwilligungQuelle, span2: true }),
      kontakt ? feld({ name: 'archiviert', label: 'Archiviert', typ: 'checkbox', wert: k.archiviert }) : '',
      feld({ name: 'bemerkung', label: 'Bemerkung', typ: 'textarea', wert: k.bemerkung, span2: true }),
    ),
    onSubmit: (w) => (kontakt ? patch(`/kontakt/${kontakt.id}`, w) : post('/kontakt', ohneLeere(w))),
  });
}

export async function verkaufschanceFormular(vc = null, vor = {}) {
  const [ma, orgs] = await Promise.all([store.mitarbeitende(), store.organisationen()]);
  const v = vc ?? {};
  const orgId = v.organisationId ?? vor.organisationId ?? '';
  const kontakte = orgId ? await get('/kontakt', { organisationId: orgId }) : [];
  return formModal({
    titel: vc ? 'Verkaufschance bearbeiten' : 'Verkaufschance erfassen', testid: 'vc-form',
    felder: formGrid(
      feld({ name: 'titel', label: 'Titel', wert: v.titel, pflicht: true, span2: true }),
      feld({ name: 'organisationId', label: 'Organisation', typ: 'select', optionen: orgs.map((o) => [o.id, o.name]), wert: orgId, leerOption: '– wählen –', pflicht: true }),
      feld({ name: 'kontaktId', label: 'Kontakt', typ: 'select', optionen: kontakte.map((k) => [k.id, personName(k)]), wert: v.kontaktId ?? vor.kontaktId, leerOption: '– keiner –' }),
      feld({ name: 'wertChf', label: 'Wert (CHF)', typ: 'number', wert: v.wertChf, attr: { min: 0, step: '0.05' } }),
      vc ? feld({ name: 'wahrscheinlichkeit', label: 'Wahrscheinlichkeit (%)', typ: 'number', wert: v.wahrscheinlichkeit, attr: { min: 0, max: 100, step: 1 } }) : '',
      feld({ name: 'erwarteterAbschluss', label: 'Erwarteter Abschluss', typ: 'date', wert: v.erwarteterAbschluss }),
      feld({ name: 'bereich', label: 'Bereich', wert: v.bereich }),
      feld({ name: 'verantwortlichId', label: 'Verantwortlich', typ: 'select', optionen: store.maOptionen(ma), wert: v.verantwortlichId ?? ich(), leerOption: '– offen –' }),
      feld({ name: 'quelle', label: 'Quelle', wert: v.quelle }),
    ),
    beimOeffnen: (form) => kontakteNachOrganisation(form),
    onSubmit: (w) => (vc ? patch(`/verkaufschance/${vc.id}`, w) : post('/verkaufschance', ohneLeere(w))),
  });
}

/** Gewonnene Chance -> Projekt beim Debitor der Organisation (Stammnummer.Jahr). */
export async function projektEroeffnen(vc) {
  return formModal({
    titel: `Projekt eröffnen: ${vc.titel}`, submitText: 'Projekt eröffnen', testid: 'projekt-eroeffnen',
    felder: formGrid(
      feld({ name: 'stammnummer', label: 'Stammnummer', typ: 'number', pflicht: true, attr: { min: 1, max: 9999, step: 1 }, hint: 'Projektnummer = Stammnummer.Jahr (z. B. 6231.26)' }),
      feld({ name: 'jahr', label: 'Jahr', typ: 'number', pflicht: true, wert: Number(heute().slice(0, 4)), attr: { min: 2000, max: 2100, step: 1 } }),
      feld({ name: 'name', label: 'Projektname', wert: vc.titel, span2: true }),
    ),
    onSubmit: (w) => post(`/verkaufschance/${vc.id}/projekt`, ohneLeere(w)),
  });
}

/** Neues Projekt (Admin). */
export async function projektFormular(projekt = null) {
  const [ma, ag] = await Promise.all([store.mitarbeitende(), store.auftraggeber()]);
  const p = projekt ?? {};
  const r = await formModal({
    titel: projekt ? `Projekt ${p.nummer} bearbeiten` : 'Projekt erfassen', breit: true, testid: 'projekt-form',
    felder: formGrid(
      projekt ? '' : feld({ name: 'stammnummer', label: 'Stammnummer', typ: 'number', pflicht: true, attr: { min: 1, max: 9999, step: 1 } }),
      projekt ? '' : feld({ name: 'jahr', label: 'Jahr', typ: 'number', pflicht: true, wert: Number(heute().slice(0, 4)), attr: { step: 1 } }),
      feld({ name: 'name', label: 'Name', wert: p.name, pflicht: true, span2: true }),
      feld({ name: 'auftraggeberId', label: 'Auftraggeber (Debitor)', typ: 'select', optionen: ag.map((a) => [a.id, `${a.name}${a.nummer ? ` (${a.nummer})` : ''}`]), wert: p.auftraggeberId, leerOption: '– wählen –', pflicht: true, span2: true }),
      feld({ name: 'projektleitungId', label: 'Projektleitung', typ: 'select', optionen: store.maOptionen(ma), wert: p.projektleitungId, leerOption: '– offen –' }),
      feld({ name: 'bereich', label: 'Bereich', wert: p.bereich }),
      feld({ name: 'startDatum', label: 'Start', typ: 'date', wert: p.startDatum }),
      feld({ name: 'endDatum', label: 'Ende', typ: 'date', wert: p.endDatum }),
      feld({ name: 'budgetChf', label: 'Budget CHF', typ: 'number', wert: p.budgetChf, attr: { min: 0 } }),
      feld({ name: 'budgetStunden', label: 'Budget Stunden', typ: 'number', wert: p.budgetStunden, attr: { min: 0 } }),
      feld({ name: 'mwstModus', label: 'MWSt-Modus', typ: 'select', optionen: [['exkl', 'exklusive'], ['inkl', 'inklusive']], wert: p.mwstModus ?? 'exkl' }),
      feld({ name: 'kuerzel', label: 'Kürzel', wert: p.kuerzel }),
      feld({ name: 'beschrieb', label: 'Beschrieb', typ: 'textarea', wert: p.beschrieb, span2: true }),
    ),
    onSubmit: (w) => (projekt ? patch(`/projekt/${projekt.id}`, w) : post('/projekt', ohneLeere(w))),
  });
  if (r) store.verwerfe('projekte');
  return r;
}

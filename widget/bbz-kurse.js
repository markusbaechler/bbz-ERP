/*!
 * bbz-kurse.js – Kurskatalog + Anmeldung aus dem bbz-ERP fuer die Homepage (WordPress/Elementor).
 *
 * Einbindung (Elementor: Widget "HTML"):
 *   <div data-bbz-kurse data-bereich="Banking" data-anmeldung="ja"></div>
 *   <script src="https://erp.example.ch/widget/bbz-kurse.js" data-api="https://erp.example.ch"
 *           data-key="bbz_xxxxxxxx_..." defer></script>
 *
 * Optionen am Container: data-bereich (Filter), data-kurs (Slug: nur ein Kurs), data-anmeldung ("ja" = Formular).
 * Der Schluessel ist ein "publishable key" (Scopes public:read + public:anmeldung, Origin-gebunden) – er ist im
 * Seitenquelltext sichtbar und darf nichts anderes koennen. Darstellung im Shadow DOM (keine Theme-Kollisionen);
 * Farben ueber CSS-Variablen am Container anpassbar: --bbz-akzent, --bbz-text, --bbz-rahmen.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var API = (script && script.getAttribute('data-api')) || '';
  var KEY = (script && script.getAttribute('data-key')) || '';

  var CSS = [
    ':host{all:initial;display:block;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--bbz-text,#1d2733)}',
    '.kurs{border:1px solid var(--bbz-rahmen,#d5dbe3);border-radius:10px;padding:16px 18px;margin:0 0 14px;background:#fff}',
    'h3{margin:0 0 4px;font-size:1.15em}',
    '.meta{color:#56616e;font-size:.9em;margin:0 0 10px}',
    'table{width:100%;border-collapse:collapse;font-size:.95em}',
    'th,td{text-align:left;padding:6px 8px;border-top:1px solid #eef1f5;vertical-align:top}',
    '.frei{font-weight:600;color:#1f7a3d}.voll{font-weight:600;color:#a15c00}',
    'button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:6px 12px;background:var(--bbz-akzent,#00508c);color:#fff}',
    'button[disabled]{opacity:.6;cursor:wait}',
    'form{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:12px 0 4px;padding:14px;background:#f6f8fa;border-radius:8px}',
    'form .breit{grid-column:1/-1}label{display:flex;flex-direction:column;font-size:.9em;gap:3px}',
    'input,select,textarea{font:inherit;padding:6px 8px;border:1px solid var(--bbz-rahmen,#c4ccd6);border-radius:6px}',
    'label.check{flex-direction:row;align-items:flex-start;gap:8px}',
    '.hinweis{padding:10px 12px;border-radius:8px;margin:10px 0}.ok{background:#e7f5ec}.fehler{background:#fdecec}',
    '@media (max-width:600px){form{grid-template-columns:1fr}td,th{display:block;border:0;padding:2px 0}tr{display:block;padding:8px 0;border-top:1px solid #eef1f5}thead{display:none}}',
  ].join('');

  function el(tag, attrs, kinder) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kinder || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  function datumCh(iso) { var p = String(iso).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function chf(n) { return n == null ? 'auf Anfrage' : 'CHF ' + Number(n).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function termine(d) {
    var tage = d.kurstage && d.kurstage.length ? d.kurstage.map(function (t) { return datumCh(t.datum); }) : [datumCh(d.startDatum) + ' – ' + datumCh(d.endDatum)];
    return tage.join(', ');
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function api(pfad, opt) {
    opt = opt || {};
    var headers = { 'x-api-key': KEY };
    if (opt.body) headers['content-type'] = 'application/json';
    if (opt.idempotenz) headers['idempotency-key'] = opt.idempotenz;
    return fetch(API.replace(/\/$/, '') + pfad, { method: opt.method || 'GET', headers: headers, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; }); });
  }

  function formular(kurs, d, ziel) {
    var idem = uuid();   // pro geoeffnetem Formular: Doppelklick/Neuversand erzeugt keine Doppelanmeldung
    var f = el('form', { novalidate: '' });
    function feld(name, label, typ, pflicht, breit) {
      var inp = typ === 'textarea' ? el('textarea', { name: name, rows: '2' }) : el('input', { name: name, type: typ || 'text' });
      if (pflicht) inp.required = true;
      if (typ === 'email') inp.autocomplete = 'email';
      return el('label', { className: breit ? 'breit' : '' }, [label + (pflicht ? ' *' : ''), inp]);
    }
    var anrede = el('select', { name: 'anrede' }, [el('option', { value: '', text: '–' }), el('option', { value: 'Frau', text: 'Frau' }), el('option', { value: 'Herr', text: 'Herr' })]);
    f.appendChild(el('label', null, ['Anrede', anrede]));
    f.appendChild(el('span'));
    f.appendChild(feld('vorname', 'Vorname', 'text', true));
    f.appendChild(feld('nachname', 'Nachname', 'text', true));
    f.appendChild(feld('email', 'Geschäftliche E-Mail', 'email', true));
    f.appendChild(feld('telefon', 'Telefon', 'tel'));
    f.appendChild(feld('organisation', 'Bank / Arbeitgeber', 'text', true));
    f.appendChild(feld('funktion', 'Funktion'));
    f.appendChild(feld('rechnungsreferenz', 'Rechnungsreferenz (Kostenstelle, Bestell-Nr.)', 'text', false, true));
    f.appendChild(feld('bemerkung', 'Bemerkung', 'textarea', false, true));
    f.appendChild(el('label', { className: 'check breit' }, [el('input', { type: 'checkbox', name: 'datenschutz', required: '' }), 'Ich habe die Datenschutzerklärung gelesen und bin einverstanden. *']));
    f.appendChild(el('label', { className: 'check breit' }, [el('input', { type: 'checkbox', name: 'agb', required: '' }), 'Ich akzeptiere die AGB (Abmeldung bis 30 Tage vor Kursbeginn kostenlos). *']));
    var senden = el('button', { type: 'submit', text: d.freiePlaetze > 0 ? 'Verbindlich anmelden' : 'Auf die Warteliste' });
    var meldung = el('div', { className: 'breit', role: 'status', 'aria-live': 'polite' });
    f.appendChild(el('div', { className: 'breit' }, [senden]));
    f.appendChild(meldung);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var w = function (n) { return (f.elements[n] && f.elements[n].value || '').trim() || null; };
      senden.disabled = true;
      api('/public/v1/anmeldungen', {
        method: 'POST', idempotenz: idem,
        body: {
          durchfuehrungCode: d.code, organisation: w('organisation'), rechnungsreferenz: w('rechnungsreferenz'), bemerkung: w('bemerkung'),
          datenschutz: f.elements.datenschutz.checked, agb: f.elements.agb.checked,
          kontakt: { anrede: w('anrede'), vorname: w('vorname'), nachname: w('nachname'), email: w('email'), telefon: w('telefon'), funktion: w('funktion') },
        },
      }).then(function (r) {
        senden.disabled = false;
        if (r.status === 201 || r.status === 202) {
          var text = r.json.warteliste
            ? 'Danke! Der Kurs ist ausgebucht – Sie stehen auf der Warteliste (Position ' + r.json.wartelistenPosition + '). Wir melden uns, sobald ein Platz frei wird.'
            : r.status === 202 ? 'Danke! Wir prüfen Ihre Anmeldung und melden uns.'
            : 'Danke für Ihre Anmeldung zu «' + kurs.titel + '». Sie erhalten eine Bestätigung per E-Mail.';
          ziel.replaceChildren(el('div', { className: 'hinweis ok', text: text }));
        } else {
          var fehler = (r.json.fehler && r.json.fehler.join(', ')) || r.json.error || 'Die Anmeldung konnte nicht gespeichert werden.';
          meldung.replaceChildren(el('div', { className: 'hinweis fehler', text: fehler }));
        }
      }, function () {
        senden.disabled = false;
        meldung.replaceChildren(el('div', { className: 'hinweis fehler', text: 'Keine Verbindung. Bitte später erneut versuchen.' }));
      });
    });
    return f;
  }

  function kursKarte(kurs, mitAnmeldung) {
    var meta = [kurs.untertitel, kurs.lernstunden ? kurs.lernstunden + ' Lernstunden' : null, kurs.dauerTage ? kurs.dauerTage + ' Tage' : null, chf(kurs.preisChf), kurs.saqAnerkannt ? 'SAQ-anerkannt' : null]
      .filter(Boolean).join(' · ');
    var karte = el('article', { className: 'kurs', 'data-kurs': kurs.code }, [el('h3', { text: kurs.titel }), el('p', { className: 'meta', text: meta })]);
    if (!kurs.durchfuehrungen.length) { karte.appendChild(el('p', { text: 'Neue Termine folgen – Anfrage über das Kontaktformular.' })); return karte; }
    var tbody = el('tbody');
    kurs.durchfuehrungen.forEach(function (d) {
      var platz = d.freiePlaetze > 0 ? el('span', { className: 'frei', text: d.freiePlaetze + ' frei' }) : el('span', { className: 'voll', text: 'Warteliste' });
      var aktion = el('td');
      var zeile = el('tr', null, [el('td', { text: termine(d) }), el('td', { text: d.ort || '' }), el('td', null, [platz]), aktion]);
      tbody.appendChild(zeile);
      if (mitAnmeldung) {
        var btn = el('button', { type: 'button', text: 'Anmelden', 'aria-expanded': 'false' });
        aktion.appendChild(btn);
        btn.addEventListener('click', function () {
          var offen = zeile.nextSibling && zeile.nextSibling.className === 'formularzeile';
          if (offen) { zeile.parentNode.removeChild(zeile.nextSibling); btn.setAttribute('aria-expanded', 'false'); return; }
          var zelle = el('td', { colspan: '4' });
          zelle.appendChild(formular(kurs, d, zelle));
          zeile.parentNode.insertBefore(el('tr', { className: 'formularzeile' }, [zelle]), zeile.nextSibling);
          btn.setAttribute('aria-expanded', 'true');
        });
      }
    });
    karte.appendChild(el('table', null, [el('thead', null, [el('tr', null, [el('th', { text: 'Termin' }), el('th', { text: 'Ort' }), el('th', { text: 'Plätze' }), el('th')])]), tbody]));
    return karte;
  }

  function starte(container) {
    if (container.__bbz) return; container.__bbz = true;
    var root = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    var stil = el('style', { text: CSS });
    var inhalt = el('div', { role: 'region', 'aria-label': 'Kursangebot', 'aria-busy': 'true', text: 'Kurse werden geladen …' });
    root.appendChild(stil); root.appendChild(inhalt);
    var slug = container.getAttribute('data-kurs');
    var bereich = container.getAttribute('data-bereich');
    var pfad = slug ? '/public/v1/kurse/' + encodeURIComponent(slug) : '/public/v1/kurse' + (bereich ? '?bereich=' + encodeURIComponent(bereich) : '');
    var mitAnmeldung = /^(ja|true|1)$/i.test(container.getAttribute('data-anmeldung') || '');
    api(pfad).then(function (r) {
      inhalt.setAttribute('aria-busy', 'false');
      if (r.status !== 200) { inhalt.replaceChildren(el('p', { className: 'hinweis fehler', text: 'Das Kursangebot ist momentan nicht verfügbar.' })); return; }
      var kurse = Array.isArray(r.json) ? r.json : [r.json];
      inhalt.replaceChildren.apply(inhalt, kurse.length ? kurse.map(function (k) { return kursKarte(k, mitAnmeldung); }) : [el('p', { text: 'Zurzeit keine offenen Termine.' })]);
    }, function () {
      inhalt.replaceChildren(el('p', { className: 'hinweis fehler', text: 'Das Kursangebot ist momentan nicht verfügbar.' }));
    });
  }

  function alle() { Array.prototype.forEach.call(document.querySelectorAll('[data-bbz-kurse]'), starte); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', alle); else alle();
  window.bbzKurse = { starte: starte };
})();

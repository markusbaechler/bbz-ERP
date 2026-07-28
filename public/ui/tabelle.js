import { text } from './format.js';

// Vertrag fuer Task 5 (Rechnungsliste): Spalten ohne `render` werden maskiert
// (Freitext aus dem FileMaker-Export kann `&`, `<` etc. enthalten). Spalten
// MIT `render` werden NICHT maskiert — eine `render`-Funktion darf bewusst
// Markup liefern (z. B. fuer Status-Auszeichnung) und ist selbst dafuer
// verantwortlich, ihre Eingabe zu maskieren.
export function tabelle(spalten, zeilen, beiKlick) {
  let sortFeld = null;
  let absteigend = false;
  const t = document.createElement('table');

  function zeichne() {
    const daten = sortFeld === null ? zeilen : [...zeilen].sort((a, b) => {
      const x = a[sortFeld], y = b[sortFeld];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;   // Leerwerte immer ans Ende
      if (y === null || y === undefined) return -1;
      const v = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de-CH');
      return absteigend ? -v : v;
    });
    t.innerHTML =
      `<thead><tr>${spalten.map((s) => {
        const sortiertHier = sortFeld === s.feld;
        const ariaSort = sortiertHier ? (absteigend ? 'descending' : 'ascending') : 'none';
        return `<th class="${s.klasse ?? ''}" data-feld="${s.feld}" tabindex="0" role="button" ` +
          `aria-sort="${ariaSort}">${text(s.titel)}${sortiertHier ? (absteigend ? ' ↓' : ' ↑') : ''}</th>`;
      }).join('')}</tr></thead>` +
      `<tbody>${daten.map((z, i) =>
        `<tr data-i="${i}"${beiKlick ? ' tabindex="0" role="link"' : ''}>${spalten.map((s) =>
          `<td class="${s.klasse ?? ''}">${s.render ? s.render(z[s.feld])
            : (z[s.feld] === null || z[s.feld] === undefined ? '—' : text(z[s.feld]))}</td>`
        ).join('')}</tr>`).join('')}</tbody>`;

    function sortiereNach(f) {
      absteigend = sortFeld === f ? !absteigend : false;
      sortFeld = f;
      zeichne();
    }
    t.querySelectorAll('th').forEach((th) => {
      th.addEventListener('click', () => sortiereNach(th.dataset.feld));
      th.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();   // Leertaste soll hier sortieren, nicht die Seite scrollen
          sortiereNach(th.dataset.feld);
        }
      });
    });
    if (beiKlick) t.querySelectorAll('tbody tr').forEach((tr) => {
      const oeffnen = () => beiKlick(daten[Number(tr.dataset.i)]);
      tr.addEventListener('click', oeffnen);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') oeffnen();   // Leertaste bleibt bewusst frei zum Blaettern
      });
    });
  }

  zeichne();
  return t;
}

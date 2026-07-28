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
      `<thead><tr>${spalten.map((s) =>
        `<th class="${s.klasse ?? ''}" data-feld="${s.feld}">${s.titel}${
          sortFeld === s.feld ? (absteigend ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>` +
      `<tbody>${daten.map((z, i) =>
        `<tr data-i="${i}">${spalten.map((s) =>
          `<td class="${s.klasse ?? ''}">${s.render ? s.render(z[s.feld]) : (z[s.feld] ?? '—')}</td>`
        ).join('')}</tr>`).join('')}</tbody>`;
    t.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const f = th.dataset.feld;
      absteigend = sortFeld === f ? !absteigend : false;
      sortFeld = f;
      zeichne();
    }));
    if (beiKlick) t.querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', () => beiKlick(daten[Number(tr.dataset.i)])));
  }

  zeichne();
  return t;
}

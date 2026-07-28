const CHF = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Maskiert Freitext fuer die Verwendung in innerHTML — Projektname, Auftraggeber
// und Bereich kommen ungeprueft aus dem FileMaker-Export.
export function text(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function franken(n) {
  if (n === null || n === undefined) return '—';
  return CHF.format(n);
}

// Erwartet genau `YYYY-MM-DD` und gibt sonst einen Gedankenstrich aus. Dass die
// API dieses Format liefert, haengt am DATE-Typparser in src/db/pool.ts — ohne
// ihn kaeme ein ISO-Zeitstempel, und jedes Datum in der Oberflaeche wuerde
// stillschweigend zu „—".
export function datum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
}

export function prozent(n) {
  return `${Number(n)} %`;
}

export function menge(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

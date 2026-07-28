const CHF = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function franken(n) {
  if (n === null || n === undefined) return '—';
  return CHF.format(n);
}

export function datum(iso) {
  if (!iso) return '—';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

export function prozent(n) {
  return `${Number(n)} %`;
}

export function menge(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

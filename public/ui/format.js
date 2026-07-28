const CHF = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function franken(n) {
  if (n === null || n === undefined) return '—';
  return CHF.format(n);
}

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

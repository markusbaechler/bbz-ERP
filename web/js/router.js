// Hash-Router: '#/projekt/<id>/gantt?x=1' -> { route, params, query }. Muster mit :param und :param? (optional).
let routen = [];

export function definiere(liste) {
  routen = liste.map((r) => {
    const keys = [];
    const muster = r.pfad.split('/').filter(Boolean).map((teil) => {
      const m = /^:(\w+)(\?)?$/.exec(teil);
      if (!m) return `/${teil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
      keys.push(m[1]);
      return m[2] ? '(?:/([^/]+))?' : '/([^/]+)';
    }).join('');
    return { ...r, keys, regex: new RegExp(`^${muster || '/'}/?$`) };
  });
}

export function aktuellerPfad() {
  const h = location.hash.replace(/^#/, '');
  // Antwort eines Entra-Redirects (#code=..., #error=...) ist keine Route.
  if (!h || /^(code|error|state)=/.test(h)) return '/';
  return h.startsWith('/') ? h : `/${h}`;
}

export function aufloesen(hash = aktuellerPfad()) {
  const [pfad, qs = ''] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const r of routen) {
    const m = r.regex.exec(pfad);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params, query, pfad };
    }
  }
  return { route: null, params: {}, query, pfad };
}

export function navigiere(pfad) {
  if (`#${pfad}` === location.hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = pfad;
}

/** Query der aktuellen Route ersetzen, ohne neu zu rendern (Filter in der URL, bookmarkbar). */
export function setzeQuery(query) {
  const [pfad] = aktuellerPfad().split('?');
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)).toString();
  history.replaceState(null, '', `#${pfad}${qs ? `?${qs}` : ''}`);
}

// Routen- und Navigationstabelle (eine Quelle fuer Desktop-Nav, Bottom-Nav und Router).
const v = {
  cockpit: () => import('./views/cockpit.js'),
  organisationen: () => import('./views/organisationen.js'),
  kontakte: () => import('./views/kontakte.js'),
  pipeline: () => import('./views/pipeline.js'),
  anfragen: () => import('./views/anfragen.js'),
  projekte: () => import('./views/projekte.js'),
  projekt: () => import('./views/projekt.js'),
  zeit: () => import('./views/zeit.js'),
  bildung: () => import('./views/bildung.js'),
  durchfuehrung: () => import('./views/durchfuehrung.js'),
  saq: () => import('./views/saq.js'),
  finanzen: () => import('./views/finanzen.js'),
  ressourcen: () => import('./views/ressourcen.js'),
  admin: () => import('./views/admin.js'),
};

export const ROUTEN = [
  { pfad: '/', bereich: 'cockpit', modul: v.cockpit, fn: 'cockpit' },
  { pfad: '/crm/organisationen', bereich: 'crm', modul: v.organisationen, fn: 'liste' },
  { pfad: '/crm/organisation/:id', bereich: 'crm', modul: v.organisationen, fn: 'detail' },
  { pfad: '/crm/kontakte', bereich: 'crm', modul: v.kontakte, fn: 'liste' },
  { pfad: '/crm/kontakt/:id', bereich: 'crm', modul: v.kontakte, fn: 'detail' },
  { pfad: '/crm/pipeline', bereich: 'crm', modul: v.pipeline, fn: 'pipeline' },
  { pfad: '/crm/anfragen', bereich: 'crm', modul: v.anfragen, fn: 'anfragen' },
  { pfad: '/projekte', bereich: 'projekte', modul: v.projekte, fn: 'liste' },
  { pfad: '/projekt/:id/:tab?', bereich: 'projekte', modul: v.projekt, fn: 'detail' },
  { pfad: '/zeit', bereich: 'zeit', modul: v.zeit, fn: 'woche' },
  { pfad: '/bildung/kurse', bereich: 'bildung', modul: v.bildung, fn: 'kurse' },
  { pfad: '/bildung/durchfuehrungen', bereich: 'bildung', modul: v.bildung, fn: 'durchfuehrungen' },
  { pfad: '/bildung/rezertifizierung', bereich: 'bildung', modul: v.bildung, fn: 'rezertifizierung' },
  { pfad: '/bildung/durchfuehrung/:id', bereich: 'bildung', modul: v.durchfuehrung, fn: 'detail' },
  { pfad: '/saq', bereich: 'saq', modul: v.saq, fn: 'liste' },
  { pfad: '/saq/kennzahlen', bereich: 'saq', modul: v.saq, fn: 'kennzahlen' },
  { pfad: '/saq/fall/:id', bereich: 'saq', modul: v.saq, fn: 'detail' },
  { pfad: '/finanzen/rechnungen', bereich: 'finanzen', modul: v.finanzen, fn: 'rechnungen' },
  { pfad: '/finanzen/rechnung/:id', bereich: 'finanzen', modul: v.finanzen, fn: 'rechnung' },
  { pfad: '/finanzen/offene-posten', bereich: 'finanzen', modul: v.finanzen, fn: 'offenePosten' },
  { pfad: '/finanzen/mahnwesen', bereich: 'finanzen', modul: v.finanzen, fn: 'mahnwesen' },
  { pfad: '/finanzen/zahlungen', bereich: 'finanzen', modul: v.finanzen, fn: 'zahlungen' },
  { pfad: '/finanzen/sammelrechnung', bereich: 'finanzen', modul: v.finanzen, fn: 'sammelrechnung' },
  { pfad: '/finanzen/auswertung', bereich: 'finanzen', modul: v.finanzen, fn: 'auswertung' },
  { pfad: '/ressourcen', bereich: 'ressourcen', modul: v.ressourcen, fn: 'referenten' },
  { pfad: '/ressourcen/auslastung', bereich: 'ressourcen', modul: v.ressourcen, fn: 'auslastung' },
  { pfad: '/admin/:bereich?', bereich: 'admin', modul: v.admin, fn: 'admin', admin: true },
];

// Icons: statische SVG-Pfade (keine Nutzerdaten)
const I = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .7 3.2 2.6 3.5 5.5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M4 5h6a2 2 0 012 2v12a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v12a2 2 0 012-2h6z"/>',
  award: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13l-1.5 8 5-3 5 3-1.5-8"/>',
  chf: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[name] ?? ''}</svg>`;

export const NAV = [
  { bereich: 'cockpit', label: 'Cockpit', href: '#/', icon: 'home', mobil: true },
  { bereich: 'crm', label: 'CRM', href: '#/crm/organisationen', icon: 'users', mobil: true },
  { bereich: 'projekte', label: 'Projekte', href: '#/projekte', icon: 'folder', mobil: true },
  { bereich: 'zeit', label: 'Meine Zeit', href: '#/zeit', icon: 'clock', mobil: true },
  { bereich: 'bildung', label: 'Bildung', href: '#/bildung/durchfuehrungen', icon: 'book' },
  { bereich: 'saq', label: 'SAQ', href: '#/saq', icon: 'award' },
  { bereich: 'finanzen', label: 'Finanzen', href: '#/finanzen/rechnungen', icon: 'chf' },
  { bereich: 'ressourcen', label: 'Ressourcen', href: '#/ressourcen', icon: 'grid' },
  { bereich: 'admin', label: 'Admin', href: '#/admin/mitarbeitende', icon: 'gear', admin: true },
];

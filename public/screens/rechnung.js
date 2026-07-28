import { registriere } from '../app.js';

// Platzhalter — Task 6 fuellt die Rechnungserfassung.
registriere(/^\/rechnung\/([^/]+)$/, (el) => { el.innerHTML = '<p>Rechnung (folgt)</p>'; });

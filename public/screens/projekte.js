import { registriere } from '../app.js';

// Platzhalter — Task 4 fuellt die Projektliste.
registriere(/^\/projekte$/, (el) => { el.innerHTML = '<p>Projekte (folgt)</p>'; });

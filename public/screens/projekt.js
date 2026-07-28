import { registriere } from '../app.js';

// Platzhalter — Task 5 fuellt das Projektdetail.
registriere(/^\/projekt\/([^/]+)$/, (el) => { el.innerHTML = '<p>Projektdetail (folgt)</p>'; });

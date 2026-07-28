import { registriere } from '../app.js';

// Platzhalter — Task 7 fuellt den Systemstand.
registriere(/^\/system$/, (el) => { el.innerHTML = '<p>System (folgt)</p>'; });

import { text as maskiere } from './format.js';

// `text` wird maskiert: die naechste Meldung, die hier landet, kommt vom Server
// oder aus dem FileMaker-Bestand und ist kein Literal mehr (Befund I4).
export function laedt(el) { el.innerHTML = '<p class="hinweis-fm">Lädt …</p>'; }
export function leer(el, text) { el.innerHTML = `<p class="hinweis-fm">${maskiere(text)}</p>`; }
export function fehler(el, text) { el.innerHTML = `<p style="color:var(--storno)">${maskiere(text)}</p>`; }

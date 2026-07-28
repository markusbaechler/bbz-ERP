export function laedt(el) { el.innerHTML = '<p class="hinweis-fm">Lädt …</p>'; }
export function leer(el, text) { el.innerHTML = `<p class="hinweis-fm">${text}</p>`; }
export function fehler(el, text) { el.innerHTML = `<p style="color:var(--storno)">${text}</p>`; }

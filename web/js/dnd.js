// Drag&Drop fuer Kanban-Boards (Pipeline, Aufgaben). Karten tragen data-dnd-id, Spaltenlisten data-dnd-spalte.
// onDrop(id, spalte, index): index = Position unter den Geschwistern OHNE die gezogene Karte (wie kanbanEinordnen).
// Tastatur-/Touch-Alternative bieten die Ansichten selbst (Buttons bzw. Auswahlfeld je Karte).
export function kanbanDnD(board, onDrop) {
  let ziehId = null;
  const marker = document.createElement('div');
  marker.className = 'bbz-drop-marker';
  marker.setAttribute('aria-hidden', 'true');

  const karten = (liste) => [...liste.querySelectorAll('[data-dnd-id]')].filter((k) => k.dataset.dndId !== ziehId);
  function position(liste, y) {
    const k = karten(liste);
    const i = k.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return i === -1 ? k.length : i;
  }
  function aufraeumen() {
    marker.remove();
    board.querySelectorAll('.drop-ok').forEach((s) => s.classList.remove('drop-ok'));
    board.querySelectorAll('.dragging').forEach((s) => s.classList.remove('dragging'));
  }

  board.addEventListener('dragstart', (e) => {
    const k = e.target.closest?.('[data-dnd-id]');
    if (!k) return;
    ziehId = k.dataset.dndId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ziehId);
    k.classList.add('dragging');
  });
  board.addEventListener('dragend', () => { aufraeumen(); ziehId = null; });
  board.addEventListener('dragover', (e) => {
    const liste = e.target.closest?.('[data-dnd-spalte]');
    if (!liste || !ziehId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const spalte = liste.closest('.bbz-kanban-col') ?? liste;
    if (!spalte.classList.contains('drop-ok')) {
      board.querySelectorAll('.drop-ok').forEach((s) => s.classList.remove('drop-ok'));
      spalte.classList.add('drop-ok');
    }
    const k = karten(liste);
    const i = position(liste, e.clientY);
    if (k[i]) { if (marker.nextElementSibling !== k[i]) liste.insertBefore(marker, k[i]); }
    else if (liste.lastElementChild !== marker) liste.appendChild(marker);
  });
  board.addEventListener('drop', (e) => {
    const liste = e.target.closest?.('[data-dnd-spalte]');
    if (!liste || !ziehId) return;
    e.preventDefault();
    const id = ziehId;
    const index = position(liste, e.clientY);
    aufraeumen();
    ziehId = null;
    onDrop(id, liste.dataset.dndSpalte, index);
  });
}

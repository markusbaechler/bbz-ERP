// Gecachte Nachschlagelisten (Namen zu IDs). Nach Aenderungen gezielt verwerfen.
import { get } from './api.js';
import { personName } from './ui.js';

const cache = new Map();
function lade(name, pfad, query) {
  if (!cache.has(name)) cache.set(name, get(pfad, query).catch((e) => { cache.delete(name); throw e; }));
  return cache.get(name);
}
export const verwerfe = (...namen) => { if (!namen.length) cache.clear(); namen.forEach((n) => cache.delete(n)); };

export const mitarbeitende = () => lade('mitarbeitende', '/mitarbeitende');
export const auftraggeber = () => lade('auftraggeber', '/auftraggeber');
export const referenten = () => lade('referenten', '/referent');
export const kursangebote = () => lade('kursangebote', '/kursangebot');
export const organisationen = () => lade('organisationen', '/organisation', { limit: 2000 });
export const projekte = () => lade('projekte', '/projekt');

export const nachId = (liste) => new Map((liste ?? []).map((x) => [x.id, x]));
export const maLabel = (m) => (m ? `${m.kuerzel} – ${personName(m)}` : '–');
export const maOptionen = (liste, nurAktive = true) => liste.filter((m) => !nurAktive || m.aktiv).map((m) => [m.id, maLabel(m)]);
export const projektLabel = (p) => (p ? `${p.nummer} ${p.name}` : '–');

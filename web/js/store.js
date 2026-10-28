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
export const konten = () => lade('konten', '/konto');
export const mwstSaetze = () => lade('mwst', '/mwst-satz', { gueltigAm: new Date().toISOString().slice(0, 10) });

/** Fallback, falls noch keine MWSt-Saetze erfasst sind (Stand 2024: Normal 8.1, Beherbergung 3.8, reduziert 2.6). */
const MWST_FALLBACK = [[8.1, 'Normalsatz'], [3.8, 'Beherbergung'], [2.6, 'reduziert'], [0, 'ausgenommen/befreit']];

/** MWSt-Auswahl aus den am heutigen Tag gueltigen Saetzen der DB (ein Ort statt fest im Code). */
export async function mwstOptionen() {
  let liste = [];
  try { liste = await mwstSaetze(); } catch { liste = []; }
  const saetze = liste.length ? liste.map((x) => [x.satz, x.bezeichnung]) : MWST_FALLBACK;
  if (!saetze.some(([s]) => Number(s) === 0)) saetze.push([0, 'ausgenommen/befreit']);
  return saetze.map(([s, l]) => [String(s), `${s} % ${l}`]);
}

/** Ertragskonten fuer die Kontierung. */
export async function ertragskontoOptionen() {
  let liste = [];
  try { liste = await konten(); } catch { liste = []; }
  return liste.filter((k) => k.typ === 'Ertrag' && k.aktiv).map((k) => [k.id, `${k.nummer} ${k.bezeichnung}`]);
}

export const nachId = (liste) => new Map((liste ?? []).map((x) => [x.id, x]));
export const maLabel = (m) => (m ? `${m.kuerzel} – ${personName(m)}` : '–');
export const maOptionen = (liste, nurAktive = true) => liste.filter((m) => !nurAktive || m.aktiv).map((m) => [m.id, maLabel(m)]);
export const projektLabel = (p) => (p ? `${p.nummer} ${p.name}` : '–');

import type { FmInventar, FmDatei, FmScript, FmSchritt, FmFeld, FmLayout, FmTabellenvorkommen } from './typen';

/*
 * Weg D – Script-Ausdruck, wenn kein Konto mit [Vollzugriff] verfuegbar ist (der DDR braucht Vollzugriff):
 * Im Scriptarbeitsbereich alle Scripts markieren, "Datei > Script drucken…" nach "Microsoft Print to PDF",
 * dann `pdftotext -enc UTF-8 -layout <Datei>.pdf`. Je Seite ein Formfeed, Fusszeile
 * "<Datum> <Zeit>  <Datei>.fmp12 - <Script>  -<Seite>-". Lange Scripts laufen ueber mehrere Seiten.
 * Liefert Scripts mit Schritten (wie der DDR), dazu – aus den Schritten abgeleitet – Layouts, Dateiverweise und die
 * in Scripts referenzierten Felder. Formeln, Beziehungen, Wertelisten und Konten fehlen.
 */

const FUSSZEILE = /^\s*\d{1,2}\.\s+\S+\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)\.fmp12\s+-\s+(.*?)\s+-\d+-\s*$/;

/** Offene eckige Klammern ausserhalb von "…" (Formeltexte); > 0 heisst: der Schritt geht auf der naechsten Zeile weiter. */
function offeneKlammern(s: string): number {
  let tiefe = 0; let inText = false;
  for (const c of s) {
    if (c === '"') inText = !inText;
    else if (!inText && c === '[') tiefe++;
    else if (!inText && c === ']') tiefe--;
  }
  return tiefe;
}

function zuSchritt(roh: string): FmSchritt {
  let t = roh; let aktiv = true;
  if (t.startsWith('//')) { aktiv = false; t = t.slice(2).trim(); }
  // Kommentare koennen Personennamen enthalten (nDSG) – nur als Kommentar zaehlen
  if (t.startsWith('#')) return { id: null, name: '# (Kommentar)', aktiv, details: '' };
  const k = t.indexOf('[');
  const name = (k >= 0 ? t.slice(0, k) : t).trim();
  let details = k >= 0 ? t.slice(k).trim() : '';
  if (/konto|account|passwort|password/i.test(name)) details = details.replace(/(Kontoname|Konto|Account Name):\s*("[^"]*"|“[^”]*”|[^;\]]*)/gi, '$1: ***');
  return { id: null, name, aktiv, details: details.replace(/\s+/g, ' ').slice(0, 300) };
}

function schritte(zeilen: string[]): FmSchritt[] {
  const roh: string[] = [];
  for (const z of zeilen) {
    const t = z.trim();
    if (!t) continue;
    const i = roh.length - 1;
    if (i >= 0 && (t.startsWith('[') || offeneKlammern(roh[i]) > 0)) roh[i] += ` ${t}`;
    else roh.push(t);
  }
  return roh.map(zuSchritt);
}

/** Ein Textausdruck = eine FileMaker-Datei. */
export function parseScriptDruck(text: string): { datei: string; scripts: FmScript[] } {
  let datei = '';
  const roh: { name: string; fussName: string; zeilen: string[] }[] = [];
  for (const seite of text.replace(/\r\n?/g, '\n').split('\f')) {
    const zeilen = seite.split('\n');
    let i = zeilen.length - 1;
    while (i >= 0 && !zeilen[i].trim()) i--;
    const m = i >= 0 ? zeilen[i].match(FUSSZEILE) : null;
    if (!m) continue;
    datei ||= m[1].trim();
    const inhalt = zeilen.slice(0, i);
    const letzte = roh[roh.length - 1];
    if (letzte && letzte.fussName === m[2]) { letzte.zeilen.push(...inhalt); continue; }   // Folgeseite
    const k = inhalt.findIndex((z) => z.trim());
    roh.push({ name: k >= 0 ? inhalt[k].trim() : m[2], fussName: m[2], zeilen: inhalt.slice(k + 1) });
  }
  const scripts: FmScript[] = [];
  for (const r of roh) {
    if (/^[-–—]+$/.test(r.fussName.trim())) continue;   // Trennlinie in der Scriptliste
    // Kopfzeile = "<Ordner>: <Unterordner>: <Script>", die Fusszeile nennt nur das Script
    const fuss = r.fussName.trim();
    const ordner = r.name !== fuss && r.name.endsWith(fuss)
      ? r.name.slice(0, -fuss.length).replace(/:\s*$/, '').split(/:\s+/).filter(Boolean) : [];
    scripts.push({ id: String(scripts.length + 1), name: ordner.length ? fuss : r.name, ordner, imMenue: false, schritte: schritte(r.zeilen) });
  }
  return { datei, scripts };
}

// ---------------------------------------------------------------- aus Schritten abgeleitete Struktur

// Feldname endet an einem Trennzeichen oder – in Feldfolgen ohne Trennzeichen – vor der naechsten "<Tabelle>::"
const FELDREF = /([A-Za-zÄÖÜäöü_][\wÄÖÜäöüß.-]*(?: [\wÄÖÜäöüß.-]+){0,2})::((?:(?!\s+[A-Za-zÄÖÜäöü_][\wÄÖÜäöüß.-]*::)[^;[\]()=≠<>&*+/,"“”¶])+)/g;

function feldReferenzen(s: FmSchritt): { tv: string; feld: string }[] {
  return [...s.details.matchAll(FELDREF)].map((m) => ({ tv: m[1].trim(), feld: m[2].trim() })).filter((r) => r.feld);
}

function layoutVon(s: FmSchritt): { name: string; tv: string } | null {
  const m = /^gehe zu layout$/i.test(s.name) ? s.details.match(/“([^”]+)”\s*\(([^)]+)\)/) : s.details.match(/Mit Layout:\s*“([^”]+)”\s*\(([^)]+)\)/);
  return m ? { name: m[1], tv: m[2].trim() } : null;
}

function dateiVerweise(s: FmSchritt): string[] {
  const out = [...s.details.matchAll(/Aus Datei:\s*“([^”]+)”/g), ...s.details.matchAll(/file:([^”"/;]+?)\.fmp12/gi)].map((m) => m[1].trim());
  if (/^datei öffnen$|^open file$/i.test(s.name)) { const m = s.details.match(/“([^”]+)”/); if (m) out.push(m[1].trim()); }
  return out;
}

/** Angaben, die der Ausdruck nicht enthaelt (aus dem Statusbereich bzw. der Scriptliste abgelesen). */
export type ScriptDruckManifest = Record<string, { datensaetze?: number; gesperrteScripts?: number; scripts?: string[] }>;

const leeresFeld = (name: string): FmFeld => ({
  id: '', name, typ: '?', art: 'Normal', formel: null, autoEingabe: [], validierung: [], global: false, wiederholungen: 1,
  kommentar: null, naechsterSerienwert: null,
});

/**
 * Fuehrt die Ausdrucke mehrerer Dateien zu einem Inventar zusammen. Annahme [Hypothese]: eine Tabelle je Datei mit dem
 * Namen der Datei (aus FileMaker 6 konvertierte Loesung); Felder sind die, die irgendein Script als <Datei>::<Feld> nennt.
 */
export function baueInventarAusScriptDruck(texte: { name: string; inhalt: string }[], manifest: ScriptDruckManifest = {}): FmInventar {
  const gelesen = texte.map((t) => { const r = parseScriptDruck(t.inhalt); return { ...r, datei: r.datei || t.name.replace(/\.txt$/i, '') }; })
    .filter((r) => r.scripts.length);
  const namen = [...new Set([...gelesen.map((g) => g.datei), ...Object.keys(manifest)])];
  const dateiZu = (tv: string) => namen.find((n) => n.toLowerCase() === tv.toLowerCase()) ?? null;

  const felderJeDatei = new Map<string, Set<string>>();
  for (const g of gelesen) for (const s of g.scripts) for (const st of s.schritte) for (const r of feldReferenzen(st)) {
    const d = dateiZu(r.tv);
    if (d) felderJeDatei.set(d, (felderJeDatei.get(d) ?? new Set()).add(r.feld));
  }

  const dateien: FmDatei[] = namen.map((name) => {
    const g = gelesen.find((x) => x.datei === name);
    const m = manifest[name] ?? {};
    const scripts: FmScript[] = [...(g?.scripts ?? [])];
    for (const s of m.scripts ?? []) if (!scripts.some((x) => x.name === s)) scripts.push({ id: `m${scripts.length + 1}`, name: s, ordner: [], imMenue: false, schritte: [] });
    const alle = scripts.flatMap((s) => s.schritte);

    const layouts: FmLayout[] = [];
    for (const st of alle) {
      const l = layoutVon(st);
      if (l && !layouts.some((x) => x.name === l.name)) layouts.push({ id: String(layouts.length + 1), name: l.name, tabelle: l.tv, ordner: [], felder: [], scripts: [] });
    }
    const tvs = new Set([...alle.flatMap((st) => feldReferenzen(st).map((r) => r.tv)), ...layouts.map((l) => l.tabelle!)]);
    const tabellenvorkommen: FmTabellenvorkommen[] = [...tvs].sort((a, b) => a.localeCompare(b, 'de')).map((tv) => {
      const d = dateiZu(tv);
      return { name: tv, basisTabelle: d ?? '?', datei: d && d !== name ? d : null };
    });
    const verweise = [...new Set(alle.flatMap(dateiVerweise))].filter((v) => v !== name);

    return {
      name,
      tabellen: [{
        id: name, name, datensaetze: m.datensaetze ?? null,
        felder: [...(felderJeDatei.get(name) ?? [])].sort((a, b) => a.localeCompare(b, 'de')).map(leeresFeld),
      }],
      tabellenvorkommen, beziehungen: [], layouts, scripts,
      wertelisten: [], eigeneFunktionen: [], konten: [], berechtigungssaetze: [], erweiterteBerechtigungen: [],
      dateiReferenzen: verweise.map((v) => ({ name: v, pfad: `file:${v}` })),
      gesperrteScripts: m.gesperrteScripts ?? 0,
    };
  });
  if (!dateien.length) throw new Error('Keine Script-Ausdrucke gefunden');
  return { format: 'ScriptDruck', version: null, dateien };
}

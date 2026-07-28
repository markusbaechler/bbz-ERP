import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Befund I6: `public/screens/*.js` und `public/ui/tabelle.js` bauen ihr Markup
 * mit `innerHTML`. Ein direkt hineininterpolierter Wert aus dem FileMaker-Export
 * (`&`, `<`, Anfuehrungszeichen kommen dort vor) waere eine Luecke. Ein echter
 * Test dieser Module braeuchte ein DOM, ein DOM braeuchte jsdom oder happy-dom —
 * und eine neue Abhaengigkeit ist ausgeschlossen.
 *
 * Statt dessen dieser Stolperdraht: er liest die Dateien **als Text**, sucht in
 * jeder HTML-Vorlage (Template-Literal, dessen statischer Anteil ein Tag
 * enthaelt) alle `${…}` und verlangt, dass jeder Ausdruck entweder ein Literal
 * ist, ein Aufruf eines der Formatierer aus `format.js`, oder eine
 * Zusammensetzung (Ternaer, `||`/`??`, `+`, `.map(…).join('')`) aus solchen.
 *
 * Das ist als Entwurf sproede — er kennt kein JavaScript, sondern nur die
 * Schreibweisen, die hier heute vorkommen. Eine ungewohnte, voellig harmlose
 * Formulierung kann ihn ausloesen. Der Preis ist gering und der Nutzen konkret:
 * er schlaegt an dem Tag an, an dem jemand `${p.name}` schreibt. Faellt er bei
 * etwas Legitimem, dann bitte den Wert einpacken — und nur, wenn das wirklich
 * nicht geht, unten begruendet in AUSNAHMEN eintragen.
 *
 * Sobald ein DOM-Testumfeld vertretbar ist, ersetzt ein richtiger Test diesen
 * Draht (in HANDOVER.md vermerkt).
 */

const WURZEL = join(import.meta.dirname, '..', 'public');
const DATEIEN = [
  ...readdirSync(join(WURZEL, 'screens')).filter((d) => d.endsWith('.js')).map((d) => join('screens', d)),
  join('ui', 'tabelle.js'),
];

const FORMATIERER = ['text', 'franken', 'datum', 'prozent', 'menge'];

// Eng gefasste Ausnahmen. Jede braucht eine Begruendung.
const AUSNAHMEN = new Set([
  // tabelle.js: dokumentierter Vertrag — eine Spalte MIT `render` darf bewusst
  // Markup liefern (z. B. die Status-Auszeichnung) und maskiert ihre Eingabe
  // selbst. Genau dieser Ausstieg ist der Grund, warum es diesen Draht gibt.
  's.render(z[s.feld])',
  // projekt.js: `adresse` wird in derselben Datei aus HTML-Vorlagen gebaut, die
  // diese Pruefung selbst durchlaufen. Der Wert ist bereits geprueftes Markup.
  'adresse',
]);

const VORLAGE = '‹VORLAGE›';   // Platzhalter fuer ein verschachteltes Template-Literal

type Vorlage = { statisch: string; ausdruecke: string[] };

/** Zerlegt eine Quelldatei in ihre Template-Literale (auch verschachtelte). */
function findeVorlagen(src: string): Vorlage[] {
  const gefunden: Vorlage[] = [];

  // ab dem oeffnenden Backtick; liefert den Index nach dem schliessenden
  function template(start: number): number {
    let statisch = '';
    const ausdruecke: string[] = [];
    let j = start + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { statisch += src[j + 1] ?? ''; j += 2; continue; }
      if (c === '`') { gefunden.push({ statisch, ausdruecke }); return j + 1; }
      if (c === '$' && src[j + 1] === '{') {
        const a = ausdruck(j + 2);
        ausdruecke.push(a.text);
        j = a.ende;
        continue;
      }
      statisch += c; j++;
    }
    throw new Error(`unbeendetes Template-Literal ab Position ${start}`);
  }

  // ab der Position nach '${'; liefert Text (verschachtelte Templates als
  // Platzhalter) und den Index nach dem schliessenden '}'
  function ausdruck(start: number): { text: string; ende: number } {
    let text = '';
    let tiefe = 0;
    let j = start;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { text += src.slice(j, j + 2); j += 2; continue; }
      if (c === "'" || c === '"') { const e = einfacherString(j); text += src.slice(j, e); j = e; continue; }
      if (c === '`') { const e = template(j); text += VORLAGE; j = e; continue; }
      if (c === '{' || c === '(' || c === '[') { tiefe++; text += c; j++; continue; }
      if (c === ')' || c === ']') { tiefe--; text += c; j++; continue; }
      if (c === '}') {
        if (tiefe === 0) return { text, ende: j + 1 };
        tiefe--; text += c; j++; continue;
      }
      text += c; j++;
    }
    throw new Error(`unbeendeter \${…}-Ausdruck ab Position ${start}`);
  }

  function einfacherString(start: number): number {
    const q = src[start];
    let j = start + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === q) return j + 1;
      j++;
    }
    throw new Error(`unbeendeter String ab Position ${start}`);
  }

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "'" || c === '"') { i = einfacherString(i); continue; }
    if (c === '`') { i = template(i); continue; }
    i++;
  }
  return gefunden;
}

/** Index der zur Klammer an `von` passenden Schlussklammer, sonst -1. */
function passendeKlammer(s: string, von: number): number {
  const auf = s[von];
  const zu = auf === '(' ? ')' : auf === '[' ? ']' : '}';
  let tiefe = 0;
  for (let i = von; i < s.length; i++) {
    if ('([{'.includes(s[i])) tiefe++;
    else if (')]}'.includes(s[i])) { tiefe--; if (tiefe === 0) return s[i] === zu ? i : -1; }
  }
  return -1;
}

/** Positionen eines Operators auf oberster Klammerebene. */
function obersteEbene(s: string, treffer: (s: string, i: number) => number): number[] {
  const stellen: number[] = [];
  let tiefe = 0;
  for (let i = 0; i < s.length; i++) {
    if ('([{'.includes(s[i])) { tiefe++; continue; }
    if (')]}'.includes(s[i])) { tiefe--; continue; }
    if (tiefe !== 0) continue;
    const laenge = treffer(s, i);
    if (laenge > 0) { stellen.push(i); i += laenge - 1; }
  }
  return stellen;
}

function istStringLiteral(a: string): boolean {
  return /^'[^']*'$/.test(a) || /^"[^"]*"$/.test(a);
}

function sicher(roh: string): boolean {
  let a = roh.trim();
  if (a === '' || a === VORLAGE) return true;
  if (AUSNAHMEN.has(a)) return true;
  if (istStringLiteral(a)) return true;

  // umschliessende Klammern abstreifen
  while (a.startsWith('(') && passendeKlammer(a, 0) === a.length - 1) {
    a = a.slice(1, -1).trim();
    if (AUSNAHMEN.has(a) || a === VORLAGE || istStringLiteral(a)) return true;
  }

  // Ternaer: `?` auf oberster Ebene, weder `??` noch `?.`
  const frage = obersteEbene(a, (s, i) =>
    s[i] === '?' && s[i + 1] !== '?' && s[i + 1] !== '.' && s[i - 1] !== '?' ? 1 : 0);
  if (frage.length > 0) {
    const doppel = obersteEbene(a, (s, i) => (s[i] === ':' ? 1 : 0));
    if (doppel.length >= frage.length) {
      // der zum ersten `?` gehoerende `:` ist der, bei dem die Ternaertiefe wieder 0 wird
      let tiefe = 0, trenner = -1;
      const marken = [...frage.map((i) => ({ i, art: '?' })), ...doppel.map((i) => ({ i, art: ':' }))]
        .sort((x, y) => x.i - y.i);
      for (const m of marken) {
        if (m.art === '?') tiefe++;
        else { tiefe--; if (tiefe === 0) { trenner = m.i; break; } }
      }
      if (trenner > 0) {
        // die Bedingung selbst wird nicht ausgegeben und darum nicht geprueft
        return sicher(a.slice(frage[0] + 1, trenner)) && sicher(a.slice(trenner + 1));
      }
    }
  }

  // `||`, `??`, `&&`, `+` — jeder Operand muss fuer sich sicher sein
  for (const op of ['||', '??', '&&', '+']) {
    const stellen = obersteEbene(a, (s, i) => (s.startsWith(op, i) ? op.length : 0));
    if (stellen.length > 0) {
      const teile: string[] = [];
      let vorher = 0;
      for (const i of stellen) { teile.push(a.slice(vorher, i)); vorher = i + op.length; }
      teile.push(a.slice(vorher));
      return teile.every(sicher);
    }
  }

  // Formatierer-Aufruf: maskiert bzw. formatiert sein Argument selbst
  for (const f of FORMATIERER) {
    if (a.startsWith(f) && /^\s*\(/.test(a.slice(f.length))) {
      const auf = a.indexOf('(', f.length);
      if (passendeKlammer(a, auf) === a.length - 1) return true;
    }
  }

  // `….map(fn).join('…')` — die Vorlage im Rumpf wird fuer sich geprueft
  const join = /\.join\(\s*('[^']*'|"[^"]*")\s*\)$/.exec(a);
  if (join) {
    const kopf = a.slice(0, a.length - join[0].length).trim();
    const map = kopf.lastIndexOf('.map(');
    if (map > 0 && passendeKlammer(kopf, map + 4) === kopf.length - 1) {
      return rumpfSicher(kopf.slice(map + 5, kopf.length - 1));
    }
  }

  return false;
}

/** Rumpf einer Pfeilfunktion: Ausdruck oder Block mit `return`. */
function rumpfSicher(arg: string): boolean {
  const pfeil = obersteEbene(arg, (s, i) => (s.startsWith('=>', i) ? 2 : 0));
  if (pfeil.length === 0) return false;
  const rumpf = arg.slice(pfeil[0] + 2).trim();
  if (!rumpf.startsWith('{')) return sicher(rumpf);
  const rueckgaben = [...rumpf.matchAll(/\breturn\b([^;]*);/g)].map((m) => m[1]);
  return rueckgaben.length > 0 && rueckgaben.every(sicher);
}

describe('Maskierung in den innerHTML-Vorlagen', () => {
  for (const datei of DATEIEN) {
    it(`${datei.replace(/\\/g, '/')}: jeder interpolierte Wert ist maskiert oder formatiert`, () => {
      const src = readFileSync(join(WURZEL, datei), 'utf8');
      const htmlVorlagen = findeVorlagen(src).filter((v) => /<[a-zA-Z/]/.test(v.statisch));
      expect(htmlVorlagen.length).toBeGreaterThan(0);

      const beanstandet = htmlVorlagen
        .flatMap((v) => v.ausdruecke)
        .filter((a) => !sicher(a))
        .map((a) => a.replace(/\s+/g, ' ').trim());
      expect(beanstandet).toEqual([]);
    });
  }

  it('schlaegt an, wenn ein Wert direkt interpoliert wird', () => {
    const boese = 'el.innerHTML = `<td>${p.name}</td>`;';
    const vorlagen = findeVorlagen(boese).filter((v) => /<[a-zA-Z/]/.test(v.statisch));
    expect(vorlagen.flatMap((v) => v.ausdruecke).filter((a) => !sicher(a))).toEqual(['p.name']);
  });

  it('laesst Formatierer, Literale und deren Zusammensetzungen durch', () => {
    for (const a of ['text(p.name)', "franken(x.betrag)", "'Entwurf'", "r.nummer ? text(r.nummer) : 'Entwurf'",
      "text(s.klasse ?? '')", "'<br>' + text(p.zusatz)", "z.map((x) => `<tr>${text(x.a)}</tr>`).join('')"]) {
      expect(sicher(a.replace(/`[^`]*`/g, VORLAGE))).toBe(true);
    }
  });
});

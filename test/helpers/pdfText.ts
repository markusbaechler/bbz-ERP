import zlib from 'node:zlib';

// Eine aus dem PDF extrahierte Textzeile mitsamt ihrer vertikalen Position
// (PDFKit-interne Koordinate: groesser = weiter oben auf der Seite).
export type PdfZeile = { y: number; text: string };

// Extrahiert die sichtbaren Textzeilen aus einem von PDFKit erzeugten PDF-Puffer,
// ohne eine zusaetzliche Abhaengigkeit (z. B. pdf-parse) einzufuehren.
//
// PDFKit komprimiert Content-Streams standardmaessig mit FlateDecode; das laesst
// sich mit dem eingebauten `zlib`-Modul entpacken. Fuer Standardschriften
// (Helvetica) entsprechen die Hex-Glyphencodes in Tj/TJ-Operatoren direkt den
// WinAnsi-/Latin1-Bytewerten, daher genuegt eine simple Byte-zu-Zeichen-Dekodierung
// ohne echtes PDF-Parsing.
export function extrahierePdfZeilen(buf: Buffer): PdfZeile[] {
  const roh = buf.toString('latin1');
  const zeilen: PdfZeile[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRe.exec(roh))) {
    let inhalt: Buffer;
    try {
      inhalt = zlib.inflateSync(Buffer.from(streamMatch[1], 'latin1'));
    } catch {
      continue; // kein FlateDecode-Stream (z. B. eingebettete Schrift) - ueberspringen
    }
    const text = inhalt.toString('latin1');

    let aktuellesY = NaN;
    const opRe = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm|\[((?:<[0-9a-fA-F]+>|-?\d+(?:\.\d+)?|\s)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let op: RegExpExecArray | null;
    while ((op = opRe.exec(text))) {
      if (op[1] !== undefined) {
        aktuellesY = parseFloat(op[1]);
        continue;
      }
      let zeile = '';
      if (op[2] !== undefined) {
        const hexRe = /<([0-9a-fA-F]+)>/g;
        let h: RegExpExecArray | null;
        while ((h = hexRe.exec(op[2]))) zeile += Buffer.from(h[1], 'hex').toString('latin1');
      } else if (op[3] !== undefined) {
        zeile = op[3];
      }
      zeilen.push({ y: aktuellesY, text: zeile });
    }
  }
  return zeilen;
}

// Bequemlichkeitsfunktion: nur der zusammengefuegte Text, fuer einfache "enthaelt"-Pruefungen.
export function extrahierePdfText(buf: Buffer): string {
  return extrahierePdfZeilen(buf).map((z) => z.text).join('\n');
}

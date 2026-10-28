import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseScriptDruck, baueInventarAusScriptDruck } from '../tools/fm-analyse/scriptDruck';
import { analysiere, liesErpSchema, klassifiziereSchritt, ordneZu } from '../tools/fm-analyse/analyse';
import { berichtMarkdown } from '../tools/fm-analyse/report';
import { fuehreAus } from '../tools/fm-analyse/cli';

/*
 * Synthetischer Script-Ausdruck, wie ihn FileMaker 17 (DE) im Scriptarbeitsbereich ueber "Script drucken…" nach
 * "Microsoft Print to PDF" erzeugt und `pdftotext -enc UTF-8 -layout` als Text liefert: je Seite ein Formfeed,
 * Fusszeile "<Datum> <Zeit>  <Datei>.fmp12 - <Script>  -<Seite>-". Lange Scripts laufen ueber mehrere Seiten.
 */
const fuss = (datei: string, script: string, seite: number) => `28. Oktober 2026 14:33:39  ${datei}.fmp12 - ${script}        -${seite}-`;

const PROJEKTE = [
  [
    'Jahr auswählen', '',
    'Blätternmodus aktivieren',
    'Gehe zu Layout [ “Projekterfassung” (Projekte) ]',
    'Eigenes Dialogfeld anzeigen [ Titel: "Meldung"; Mitteilung: "Bitte im Feld \\"Jahr\\" suchen."; Standardtaste: “OK”, Schreiben: “Ja” ]',
    '', 'Suchenmodus aktivieren [ ]',
    'Gehe zu Feld [ Projekte::Jahr ]', '',
    fuss('Projekte', 'Jahr auswählen', 1), '',
  ],
  [
    'Projekt-Abrechnung', '',
    '#Rückfrage bei Muster',
    'Wenn [ Hole ( LetzteMeldungswahl ) = 1 ]', '',
    '      Gehe zu Layout [ “Budget (Ertrag)” (Projekte) ]',
    'Sonst',
    '      Feldwert setzen [ Projekte::Budget global; Projekte::Budget Tage * 1400 ]',
    'Ende (wenn)',
    'Sortieren [ Datensätze in Sortierfolge behalten; Angegebene Sortierfolge: Projekte::Konto; Aufsteigend; Sprache',
    'überschreiben: “Deutsch”', '',
    '      Seminar_Belegung::Seminar Nr.; Aufsteigend ]',
    '      [ Wiederherstellen ]', '',
    'Gehe zu Datens./Abfrage/Seite',
    '      [ Erste(r) ]',
    'Datensätze als PDF speichern [ Dateiname: “$Pfad”; Alle aufgerufenen Datensätze ]', '',
    fuss('Projekte', 'Projekt-Abrechnung', 2), '',
  ],
  [
    '      E-Mail senden [ Über E-Mail-Client senden; An: Projekte::Mail; Betreff: "Rechnung" ]',
    '// Datensätze importieren [ Quelle: “file:Faktura_P.fmp12”; Ziel: “move” ]',
    'Konto hinzufügen [ Kontoname: "geheim"; Passwort: ••••••; Berechtigungen: [Nur Lesezugriff]]',
    'Script ausführen [ “Termine” Aus Datei: “Schritte” ]',
    'Datei öffnen [ “Lizenz” ]', '',
    fuss('Projekte', 'Projekt-Abrechnung', 3), '',
  ],
].map((s) => s.join('\n')).join('\f');

const BELEGUNG = [
  ['-', '', '-', '', fuss('Seminar_Belegung', '-', 1), ''],   // Trennlinie in der Scriptliste
  [
    'Pruefung: Doublettenkontrolle', '',
    'Ergebnismenge suchen [ Angegebene Abfrage: Anfragen: Seminar_Belegung::Teilnehmer Nr. ]',
    'Telefonnummer wählen [ Seminar_Belegung::Telefon ]', '',
    fuss('Seminar_Belegung', 'Doublettenkontrolle', 2), '',
  ],
  [
    'Export', '',
    'Datensätze exportieren [ Feldfolge: Seminar_Belegung::Kurs Nr. Seminar_Belegung::Anmeldestatus: ]', '',
    fuss('Seminar_Belegung', 'Export', 3), '',
  ],
].map((s) => s.join('\n')).join('\f');

const MANIFEST = {
  Projekte: { datensaetze: 5020, gesperrteScripts: 1 },
  Seminar_Belegung: { datensaetze: 53436 },
  MWSt: { datensaetze: 4, scripts: ['Konti erstellen'], gesperrteScripts: 2 },
};

const schema = liesErpSchema(readdirSync(join(__dirname, '../db/migrations')).sort().map((f) => readFileSync(join(__dirname, '../db/migrations', f), 'utf8')));
const inventar = () => baueInventarAusScriptDruck([{ name: 'Projekte.txt', inhalt: PROJEKTE }, { name: 'Seminar_Belegung.txt', inhalt: BELEGUNG }], MANIFEST);

describe('fm-analyse: Script-Ausdruck (ohne Vollzugriff)', () => {
  it('liest Dateiname und Scripts aus den Fusszeilen, Folgeseiten gehoeren zum selben Script', () => {
    const r = parseScriptDruck(PROJEKTE);
    expect(r.datei).toBe('Projekte');
    expect(r.scripts.map((s) => s.name)).toEqual(['Jahr auswählen', 'Projekt-Abrechnung']);
    expect(r.scripts[0].schritte.map((s) => s.name)).toEqual(
      ['Blätternmodus aktivieren', 'Gehe zu Layout', 'Eigenes Dialogfeld anzeigen', 'Suchenmodus aktivieren', 'Gehe zu Feld']);
    expect(r.scripts[1].schritte).toHaveLength(14);
  });

  it('trennt den Ordnerpfad vom Scriptnamen und laesst Trennlinien weg', () => {
    const r = parseScriptDruck(BELEGUNG);
    expect(r.scripts.map((s) => [s.name, s.ordner])).toEqual([['Doublettenkontrolle', ['Pruefung']], ['Export', []]]);
  });

  it('fuehrt umbrochene Schritte und Optionszeilen zusammen', () => {
    const s = parseScriptDruck(PROJEKTE).scripts[1].schritte;
    const sort = s.find((x) => x.name === 'Sortieren')!;
    expect(sort.details).toContain('Seminar_Belegung::Seminar Nr.');
    expect(sort.details).toContain('Wiederherstellen');
    expect(s.find((x) => x.name === 'Gehe zu Datens./Abfrage/Seite')!.details).toContain('Erste(r)');
  });

  it('erkennt deaktivierte Schritte und laesst Kommentare und Kontonamen weg (nDSG)', () => {
    const s = parseScriptDruck(PROJEKTE).scripts[1].schritte;
    expect(s.find((x) => x.name === 'Datensätze importieren')!.aktiv).toBe(false);
    expect(s[0]).toMatchObject({ name: '# (Kommentar)', details: '' });
    const json = JSON.stringify(s);
    expect(json).not.toContain('Muster');
    expect(json).not.toContain('geheim');
  });

  it('baut ein Inventar: eine Tabelle je Datei mit den in Scripts referenzierten Feldern', () => {
    const inv = inventar();
    expect(inv.format).toBe('ScriptDruck');
    expect(inv.dateien.map((d) => d.name).sort()).toEqual(['MWSt', 'Projekte', 'Seminar_Belegung']);
    const p = inv.dateien.find((d) => d.name === 'Projekte')!;
    expect(p.tabellen).toHaveLength(1);
    expect(p.tabellen[0]).toMatchObject({ name: 'Projekte', datensaetze: 5020 });
    expect(p.tabellen[0].felder.map((f) => f.name)).toEqual(['Budget global', 'Budget Tage', 'Jahr', 'Konto', 'Mail']);
    const b = inv.dateien.find((d) => d.name === 'Seminar_Belegung')!.tabellen[0];
    // Feldfolgen ohne Trennzeichen: ein Feld endet vor der naechsten Referenz; ":" am Ende gehoert zum Namen
    expect(b.felder.map((f) => f.name)).toEqual(['Anmeldestatus:', 'Kurs Nr.', 'Seminar Nr.', 'Teilnehmer Nr.', 'Telefon']);
  });

  it('liest Layouts, Dateiverweise, Tabellenvorkommen und Angaben aus dem Manifest', () => {
    const inv = inventar();
    const p = inv.dateien.find((d) => d.name === 'Projekte')!;
    expect(p.layouts.map((l) => [l.name, l.tabelle])).toEqual([['Projekterfassung', 'Projekte'], ['Budget (Ertrag)', 'Projekte']]);
    expect(p.dateiReferenzen.map((r) => r.name).sort()).toEqual(['Faktura_P', 'Lizenz', 'Schritte']);
    expect(p.tabellenvorkommen.find((t) => t.name === 'Seminar_Belegung')).toEqual({ name: 'Seminar_Belegung', basisTabelle: 'Seminar_Belegung', datei: 'Seminar_Belegung' });
    expect(p.gesperrteScripts).toBe(1);
    const m = inv.dateien.find((d) => d.name === 'MWSt')!;
    expect(m.scripts.map((s) => [s.name, s.schritte.length])).toEqual([['Konti erstellen', 0]]);
    expect(m.tabellen[0].datensaetze).toBe(4);
  });

  it('klassifiziert die Schritte der deutschen Oberflaeche', () => {
    expect(klassifiziereSchritt(null, 'Datei öffnen')).toBe('Navigation');
    expect(klassifiziereSchritt(null, 'Konto hinzufügen')).toBe('Konten');
    expect(klassifiziereSchritt(null, 'Telefonnummer wählen')).toBe('Telefonie');
    expect(klassifiziereSchritt(null, 'Plug-In-Datei installieren')).toBe('Externe Programme');
  });

  it('ordnet die Dateinamen der Loesung den ERP-Modulen zu', () => {
    expect(ordneZu('Seminar_Belegung')?.zielTabelle).toBe('anmeldung');
    expect(ordneZu('P_Teilnehmer')?.zielTabelle).toBe('anmeldung');
    expect(ordneZu('Kurs_Typ')?.zielTabelle).toBe('kursangebot');
    expect(ordneZu('pos_fak1_P')?.zielTabelle).toBe('rechnungsposition');
    expect(ordneZu('pos_fak_konti')?.zielTabelle).toBe('rechnungsposition');
    expect(ordneZu('Konti')?.zielTabelle).toBe('konto');
    expect(ordneZu('VESR')?.zielTabelle).toBe('zahlungseingang');
    expect(ordneZu('Adressen')?.zielTabelle).toBe('organisation');
    expect(ordneZu('Filialen')?.zielTabelle).toBe('organisation');
    expect(ordneZu('Kommunik')?.zielTabelle).toBe('kontakt');
    expect(ordneZu('Korresp')?.zielTabelle).toBe('aktivitaet');
    expect(ordneZu('Story')?.zielTabelle).toBe('aktivitaet');
    expect(ordneZu('Wochenplan')?.zielTabelle).toBe('einsatz');
  });

  it('Analyse und Bericht: Funktionen erkannt, deaktivierter Import zaehlt nicht, Hinweis auf die Quelle', () => {
    const inv = inventar(); const a = analysiere(inv, schema);
    const f = Object.fromEntries(a.funktionen.map((x) => [x.funktion, x.scripts]));
    expect(f.PDF).toEqual(['Projekte: Projekt-Abrechnung']);
    expect(f['E-Mail']).toEqual(['Projekte: Projekt-Abrechnung']);
    expect(f.Import).toBeUndefined();
    expect(f.Telefonie).toEqual(['Seminar_Belegung: Doublettenkontrolle']);
    const md = berichtMarkdown(inv, a, { quelle: 'Script-Ausdruck' });
    expect(md).toContain('Quelle Script-Ausdruck');
    expect(md).toContain('1 Scripts ohne Leserecht');
    expect(md).not.toContain('geheim');
  });

  it('CLI liest einen Ordner mit Textausdrucken und dateien.json', () => {
    const ein = mkdtempSync(join(tmpdir(), 'fm-sd-'));
    writeFileSync(join(ein, 'Projekte.txt'), PROJEKTE);
    writeFileSync(join(ein, 'Seminar_Belegung.txt'), BELEGUNG);
    writeFileSync(join(ein, 'dateien.json'), JSON.stringify(MANIFEST));
    const out = mkdtempSync(join(tmpdir(), 'fm-sd-out-'));
    const r = fuehreAus(['--script-druck', ein, '--out', out]);
    expect(r.luecken).toBeGreaterThanOrEqual(0);
    for (const f of ['FUNKTIONSUMFANG.md', 'inventar.json', 'mapping-entwurf.json']) expect(existsSync(join(out, f))).toBe(true);
    expect(readFileSync(join(out, 'inventar.json'), 'utf8')).toContain('"format": "ScriptDruck"');
  });

  it('CLI: ohne Textausdrucke klare Meldung mit dem pdftotext-Aufruf', () => {
    const leer = mkdtempSync(join(tmpdir(), 'fm-sd-leer-'));
    expect(() => fuehreAus(['--script-druck', leer])).toThrow(/pdftotext/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { baueInventar, dekodiere, parseXml } from '../tools/fm-analyse/parser';
import { analysiere, liesErpSchema, klassifiziereSchritt, ordneZu, normalisiere, schlageFeldMappingVor } from '../tools/fm-analyse/analyse';
import { berichtMarkdown, mappingEntwurf } from '../tools/fm-analyse/report';
import { fuehreAus } from '../tools/fm-analyse/cli';

const DDR = join(__dirname, 'fixtures/ddr');
const lade = () => baueInventar(readdirSync(DDR).map((n) => ({ name: n, inhalt: readFileSync(join(DDR, n), 'utf8') })));
const schema = liesErpSchema(readdirSync(join(__dirname, '../db/migrations')).sort().map((f) => readFileSync(join(__dirname, '../db/migrations', f), 'utf8')));

describe('fm-analyse: Parser (DDR)', () => {
  const inv = lade();
  const projekte = inv.dateien.find((d) => d.name === 'Projekte')!;

  it('liest beide Dateien und ignoriert Summary.xml', () => {
    expect(inv.format).toBe('DDR');
    expect(inv.version).toBe('18.0.3');
    expect(inv.dateien.map((d) => d.name).sort()).toEqual(['Projekte', 'Seminare']);
  });
  it('liest Tabellen mit Datensatzanzahl und Feldeigenschaften', () => {
    const p = projekte.tabellen.find((t) => t.name === 'Projekte')!;
    expect(p.datensaetze).toBe(4967);
    expect(p.felder).toHaveLength(11);
    const nr = p.felder.find((f) => f.name === 'ProjektNr')!;
    expect(nr.validierung).toEqual(expect.arrayContaining(['notEmpty', 'unique']));
    expect(p.felder.find((f) => f.name === 'Total abgerechnet')!.formel).toBe('Sum ( Fakturen::Total netto )');
    expect(p.felder.find((f) => f.name === 'gSuche')!.global).toBe(true);
    expect(p.felder.find((f) => f.name === 'Anzahl Projekte')!.formel).toBe('Count(ProjektNr)');
    const rg = projekte.tabellen.find((t) => t.name === 'Fakturen')!.felder.find((f) => f.name === 'RgNr')!;
    expect(rg.autoEingabe).toContain('Seriennummer');
  });
  it('liest Beziehungen inkl. Kaskaden und externe Tabellenvorkommen', () => {
    const b = projekte.beziehungen.find((x) => x.rechts === 'Positionen')!;
    expect(b.kaskadeLoeschenRechts).toBe(true);
    expect(b.bedingungen[0]).toEqual({ typ: 'Equal', links: 'Fakturen::RgNr', rechts: 'Positionen::RgNr' });
    expect(projekte.tabellenvorkommen.find((t) => t.name === 'Seminare_Projekt')!.datei).toBe('Seminare');
    expect(projekte.dateiReferenzen).toEqual([{ name: 'Seminare', pfad: 'file:Seminare' }]);
  });
  it('liest Layouts mit Ordnern, Feldern und Button-Scripts', () => {
    const l = projekte.layouts.find((x) => x.name === 'Projekt Detail')!;
    expect(l.ordner).toEqual(['Projekte']);
    expect(l.tabelle).toBe('Projekte');
    expect(l.felder).toEqual(['Projekte::ProjektNr', 'Projekte::Projektname']);
    expect(l.scripts).toEqual(['Rechnung erstellen']);
  });
  it('liest Scripts mit Ordnern und Schritten (inkl. deaktivierter)', () => {
    const s = projekte.scripts.find((x) => x.name === 'Rechnung erstellen')!;
    expect(s.ordner).toEqual(['Faktura']);
    expect(s.imMenue).toBe(true);
    expect(s.schritte.map((x) => x.id)).toEqual([89, 141, 6, 7, 76]);
    expect(s.schritte[4].details).toContain('$projekt');
    const j = projekte.scripts.find((x) => x.name === 'Jahreswechsel Projekte')!;
    expect(j.schritte[2].aktiv).toBe(false);
  });
  it('liest Wertelisten, eigene Funktionen, Konten und Rechte', () => {
    expect(projekte.wertelisten[0].werte).toEqual(['Banking', 'Kundenberaterausbildung', 'Leadership', 'Beratung']);
    expect(projekte.wertelisten[1].feld).toBe('Auftraggeber::Name');
    expect(projekte.eigeneFunktionen[0]).toMatchObject({ name: 'QRRef', parameter: ['nr'] });
    expect(projekte.konten.filter((k) => k.aktiv)).toHaveLength(2);
    expect(projekte.berechtigungssaetze).toEqual(['[Full Access]', 'Standard']);
  });
  it('dekodiert UTF-16 mit BOM und erkennt fremde Formate', () => {
    const txt = '<?xml version="1.0"?><FMPReport type="Report" version="19"><File name="X"/></FMPReport>';
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(txt, 'utf16le')]);
    expect(dekodiere(buf)).toBe(txt);
    expect(parseXml(txt)!.dateien[0].name).toBe('X');
    expect(() => parseXml('<foo/>', 'x.xml')).toThrow(/weder DDR/);
  });
  it('liest das SaveAsXML-Format (experimentell)', () => {
    const x = `<FMSaveAsXML version="2.2.3.0" File="Projekte.fmp12"><Structure><AddAction>
      <BaseTablesCatalog><BaseTable id="130" name="Projekte"/></BaseTablesCatalog>
      <FieldsForTables><FieldCatalog><BaseTableReference id="130" name="Projekte"/><ObjectList>
        <Field id="1" name="ProjektNr" datatype="Text" fieldtype="Normal"/></ObjectList></FieldCatalog></FieldsForTables>
      <ScriptCatalog><Script id="1" name="Rechnung erstellen"/></ScriptCatalog>
      <StepsForScripts><Script><ScriptReference id="1" name="Rechnung erstellen"/><ObjectList><Step id="144" name="Datensätze als PDF speichern" enable="True"/></ObjectList></Script></StepsForScripts>
    </AddAction></Structure></FMSaveAsXML>`;
    const r = parseXml(x)!;
    expect(r.format).toBe('SaveAsXML');
    expect(r.dateien[0].tabellen[0].felder[0].name).toBe('ProjektNr');
    expect(r.dateien[0].scripts[0].schritte[0].id).toBe(144);
  });
});

describe('fm-analyse: Analyse', () => {
  it('klassifiziert Schritte ueber ID und Namen, Kommentare zaehlen nicht', () => {
    expect(klassifiziereSchritt(35, 'Datensätze importieren')).toBe('Import');
    expect(klassifiziereSchritt(null, 'Records as PDF')).toBe('PDF');
    expect(klassifiziereSchritt(89, '# (Kommentar)')).toBeNull();
    expect(klassifiziereSchritt(null, 'AppleScript ausführen')).toBe('Externe Programme');
  });
  it('ordnet Namen ERP-Modulen zu (Umlaute, Prioritaeten)', () => {
    expect(normalisiere('Datum von (Kurs)')).toBe('datum_von_kurs');
    expect(ordneZu('Auftraggeber')?.zielTabelle).toBe('auftraggeber');
    expect(ordneZu('Fakturen')?.zielTabelle).toBe('rechnung');
    expect(ordneZu('Positionen')?.zielTabelle).toBe('rechnungsposition');
    expect(ordneZu('Teilnehmer')?.modul).toBe('Bildung');
    expect(ordneZu('Raumreservation')).toBeNull();
  });
  it('liest das ERP-Schema aus den Migrationen (inkl. alter table)', () => {
    expect(schema.get('projekt')).toEqual(expect.arrayContaining(['stammnummer', 'jahr', 'status', 'projektleitung_id']));
    expect(schema.get('auftraggeber')).toContain('organisation_id');
    expect(schema.has('anmeldung')).toBe(true);
  });
  it('schlaegt Feld-Mappings vor (exakt, Synonym, offen) und ignoriert globale/berechnete Felder', () => {
    const t = lade().dateien[0].tabellen.find((x) => x.name === 'Projekte')!;
    const v = schlageFeldMappingVor(t, schema.get('projekt')!);
    expect(v.find((x) => x.fmFeld === 'Stammnummer')).toMatchObject({ erpSpalte: 'stammnummer', sicherheit: 'exakt' });
    expect(v.find((x) => x.fmFeld === 'Budget')).toMatchObject({ erpSpalte: 'budget_chf', sicherheit: 'synonym' });
    expect(v.find((x) => x.fmFeld === 'ProjektNr')).toMatchObject({ erpSpalte: 'nummer', sicherheit: 'synonym' });
    expect(v.find((x) => x.fmFeld === 'gSuche')).toBeUndefined();
    expect(v.find((x) => x.fmFeld === 'Total abgerechnet')).toBeUndefined();
  });
  it('baut Kennzahlen, Funktionsumfang und Luecken', () => {
    const a = analysiere(lade(), schema);
    expect(a.kennzahlen).toMatchObject({ dateien: 2, tabellen: 8, scripts: 7, datensaetze: 4967 + 412 + 15230 + 40122 + 1 + 380 + 9120 + 55 });
    const f = Object.fromEntries(a.funktionen.map((x) => [x.funktion, x.scripts]));
    expect(f.PDF).toEqual(['Projekte: QR-Rechnung als PDF']);
    expect(f['E-Mail']).toHaveLength(2);
    expect(f.Import).toEqual(['Seminare: Anmeldungen aus Excel importieren']);   // deaktivierter Import zaehlt nicht
    expect(f['Web/URL']).toEqual(['Projekte: Kursdaten nachladen']);
    expect(a.luecken.some((l) => l.includes('Raumreservation'))).toBe(true);
    expect(a.luecken.some((l) => l.includes('Externe Programme'))).toBe(true);
    expect(a.tabellen.find((t) => t.tabelle === 'Globals')!.modul).toBe('System');
  });
});

describe('fm-analyse: Bericht + CLI', () => {
  it('schreibt Bericht ohne Kontennamen (nDSG), mit Opt-in inkl. Namen', () => {
    const inv = lade(); const a = analysiere(inv, schema);
    const md = berichtMarkdown(inv, a);
    expect(md).toContain('## 5. Funktionsumfang aus Scripts');
    expect(md).toContain('| Projekte | Fakturen | 15230 |');
    expect(md).not.toContain('Max Muster');
    expect(berichtMarkdown(inv, a, { mitKonten: true })).toContain('Max Muster');
    expect(mappingEntwurf(a)['Projekte::Auftraggeber'].felder).toMatchObject({ Name: 'name', PLZ: 'plz', 'E-Mail': 'email' });
  });
  it('CLI erzeugt die drei Ausgabedateien', () => {
    const out = mkdtempSync(join(tmpdir(), 'fm-'));
    const r = fuehreAus([DDR, '--out', out]);
    expect(r.luecken).toBeGreaterThan(0);
    for (const f of ['FUNKTIONSUMFANG.md', 'inventar.json', 'mapping-entwurf.json']) expect(existsSync(join(out, f))).toBe(true);
  });
});

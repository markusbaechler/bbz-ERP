import { XMLParser } from 'fast-xml-parser';
import type {
  FmInventar, FmDatei, FmTabelle, FmFeld, FmBeziehung, FmLayout, FmScript, FmSchritt, FmWerteliste,
  FmEigeneFunktion, FmKonto, FmTabellenvorkommen, FmDateiReferenz,
} from './typen';

/*
 * Parser fuer zwei Exportformate von FileMaker:
 *  - DDR ("Datenbank-Designreport", FileMaker Pro Advanced 8-18, Werkzeuge > Datenbank-Designreport, Format XML):
 *    Wurzel <FMPReport type="Report"> mit je einer <File> und deren Katalogen.
 *  - "Kopie als XML speichern" (FileMaker 19.4+ / 2023+): Wurzel <FMSaveAsXML>. Experimentell.
 * Der Parser ist bewusst tolerant (Versionen unterscheiden sich in Details): Elemente werden per Tag-Name
 * in beliebiger Tiefe gesucht, fehlende Attribute ergeben null/leer statt Fehler.
 */

type Knoten = Record<string, any>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (_name, _jpath, _blatt, istAttribut) => !istAttribut, // alle Elemente als Array -> einheitlicher Zugriff
});

/** XML-Bytes dekodieren: DDR ist meist UTF-8, SaveAsXML teils UTF-16 mit BOM. */
export function dekodiere(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2)); sw.swap16(); return sw.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

const arr = (x: any): any[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const attr = (n: Knoten | undefined, a: string): string | null => {
  if (!n) return null;
  const v = n[`@_${a}`];
  return v === undefined || v === null ? null : String(v);
};
const istWahr = (v: string | null) => v !== null && /^(true|yes|1)$/i.test(v);

/** Textinhalt eines Elements (inkl. CDATA, das der Parser in #text zusammenfuehrt). */
function text(n: any): string {
  if (n === undefined || n === null) return '';
  if (typeof n !== 'object') return String(n);
  if (Array.isArray(n)) return n.map(text).join('');
  const t = n['#text'];
  return t === undefined ? '' : arr(t).join('');
}

/** Erstes direktes Kind mit Tag. */
const kind = (n: Knoten | undefined, tag: string): Knoten | undefined => (n ? arr(n[tag])[0] : undefined);
const kinder = (n: Knoten | undefined, tag: string): Knoten[] => (n ? arr(n[tag]) : []);

/** Alle Nachfahren mit Tag (Tiefensuche, Dokumentreihenfolge je Ebene). */
function alle(n: any, tag: string, out: Knoten[] = []): Knoten[] {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { for (const x of n) alle(x, tag, out); return out; }
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('@_') || k === '#text') continue;
    if (k === tag) for (const x of arr(v)) out.push(x);
    alle(v, tag, out);
  }
  return out;
}

/** Elemente eines Katalogs inkl. Ordnerpfad (Gruppen/Ordner koennen verschachtelt sein). */
function mitOrdnern(katalog: Knoten | undefined, tag: string, ordnerTags: string[], pfad: string[] = [], out: { k: Knoten; ordner: string[] }[] = []) {
  if (!katalog) return out;
  for (const [key, val] of Object.entries(katalog)) {
    if (key === tag) for (const x of arr(val)) out.push({ k: x, ordner: pfad });
    else if (ordnerTags.includes(key)) {
      for (const g of arr(val)) mitOrdnern(g, tag, ordnerTags, [...pfad, attr(g, 'name') ?? '?'], out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- DDR

function ddrFeld(f: Knoten): FmFeld {
  const auto = kind(f, 'AutoEnter');
  const autoEingabe: string[] = [];
  if (auto) {
    if (kind(auto, 'Serial')) autoEingabe.push('Seriennummer');
    if (istWahr(attr(auto, 'calculation')) || kind(auto, 'Calculation')) autoEingabe.push('Berechnung');
    if (istWahr(attr(auto, 'lookup')) || kind(auto, 'Lookup')) autoEingabe.push('Nachschlagen');
    if (istWahr(attr(auto, 'constant')) || kind(auto, 'ConstantData')) autoEingabe.push('Konstante');
    const v = attr(auto, 'value');
    if (v && !/^(none|constantdata|calculation|serialnumber|lookup)$/i.test(v)) autoEingabe.push(v);
    if (v && /^serialnumber$/i.test(v) && !autoEingabe.includes('Seriennummer')) autoEingabe.push('Seriennummer');
  }
  const val = kind(f, 'Validation');
  const validierung: string[] = [];
  if (val) {
    for (const a of ['notEmpty', 'unique', 'existing', 'strict']) if (istWahr(attr(val, a))) validierung.push(a);
    for (const c of ['Range', 'ValueList', 'MaxDataLength', 'Calculation', 'StrictDataType']) if (kind(val, c)) validierung.push(c);
  }
  const storage = kind(f, 'Storage');
  const calc = kind(f, 'Calculation');
  const summary = kind(f, 'SummaryInfo');
  let formel: string | null = calc ? text(calc) : null;
  if (!formel && summary) {
    const sf = alle(summary, 'Field')[0];
    formel = `${attr(summary, 'operation') ?? 'Summe'}(${sf ? attr(sf, 'name') : '?'})`;
  }
  return {
    id: attr(f, 'id') ?? '', name: attr(f, 'name') ?? '?', typ: attr(f, 'dataType') ?? '?',
    art: attr(f, 'fieldType') ?? 'Normal', formel: formel || null, autoEingabe, validierung,
    global: istWahr(attr(storage, 'global')), wiederholungen: Number(attr(storage, 'maxRepetition') ?? 1) || 1,
    kommentar: text(kind(f, 'Comment')) || null,
  };
}

function ddrSchritt(s: Knoten): FmSchritt {
  const teile: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('@_') || k === '#text') continue;
    for (const c of arr(v)) {
      if (k === 'Calculation' || k === 'Text') { const t = text(c); if (t) teile.push(t); continue; }
      const n = attr(c, 'name') ?? attr(c, 'value');
      if (n) teile.push(`${k}=${n}`);
      for (const calc of alle(c, 'Calculation')) { const t = text(calc); if (t) teile.push(t); }
    }
  }
  const id = attr(s, 'id');
  return {
    id: id === null ? null : Number(id), name: attr(s, 'name') ?? '?', aktiv: attr(s, 'enable') === null || istWahr(attr(s, 'enable')),
    details: teile.join(' | ').replace(/\s+/g, ' ').slice(0, 300),
  };
}

function ddrDatei(file: Knoten): FmDatei {
  const name = attr(file, 'name') ?? '?';

  const tabellen: FmTabelle[] = alle(kind(file, 'BaseTableCatalog'), 'BaseTable').map((t) => ({
    id: attr(t, 'id') ?? '', name: attr(t, 'name') ?? '?',
    datensaetze: attr(t, 'records') === null ? null : Number(attr(t, 'records')),
    felder: alle(kind(t, 'FieldCatalog') ?? t, 'Field').filter((f) => attr(f, 'dataType') !== null || attr(f, 'fieldType') !== null).map(ddrFeld),
  }));

  const graph = kind(file, 'RelationshipGraph');
  const tabellenvorkommen: FmTabellenvorkommen[] = alle(kind(graph, 'TableList'), 'Table').map((t) => ({
    name: attr(t, 'name') ?? '?', basisTabelle: attr(t, 'baseTable') ?? '?',
    datei: attr(t, 'fileReference') ?? attr(t, 'dataSource') ?? attr(kind(t, 'FileReference'), 'name') ?? null,
  }));
  const beziehungen: FmBeziehung[] = alle(kind(graph, 'RelationshipList'), 'Relationship').map((r) => {
    const l = kind(r, 'LeftTable'); const rt = kind(r, 'RightTable');
    return {
      links: attr(l, 'name') ?? '?', rechts: attr(rt, 'name') ?? '?',
      kaskadeErstellenRechts: istWahr(attr(rt, 'cascadeCreate')), kaskadeLoeschenRechts: istWahr(attr(rt, 'cascadeDelete')),
      bedingungen: alle(r, 'JoinPredicate').map((j) => {
        const lf = alle(kind(j, 'LeftField'), 'Field')[0]; const rf = alle(kind(j, 'RightField'), 'Field')[0];
        return {
          typ: attr(j, 'type') ?? 'Equal',
          links: `${attr(lf, 'table') ?? '?'}::${attr(lf, 'name') ?? '?'}`,
          rechts: `${attr(rf, 'table') ?? '?'}::${attr(rf, 'name') ?? '?'}`,
        };
      }),
    };
  });

  const layouts: FmLayout[] = mitOrdnern(kind(file, 'LayoutCatalog'), 'Layout', ['Group', 'Folder']).map(({ k, ordner }) => ({
    id: attr(k, 'id') ?? '', name: attr(k, 'name') ?? '?', ordner,
    tabelle: attr(kind(k, 'Table'), 'name') ?? attr(k, 'table'),
    felder: [...new Set(alle(k, 'FieldObj').map((f) => text(kind(f, 'Name')) || attr(f, 'name') || '').filter(Boolean))],
    scripts: [...new Set(alle(k, 'Script').map((s) => attr(s, 'name')).filter((x): x is string => !!x))],
  }));

  const scripts: FmScript[] = mitOrdnern(kind(file, 'ScriptCatalog'), 'Script', ['Group', 'Folder']).map(({ k, ordner }) => ({
    id: attr(k, 'id') ?? '', name: attr(k, 'name') ?? '?', ordner, imMenue: istWahr(attr(k, 'includeInMenu')),
    schritte: alle(kind(k, 'StepList') ?? k, 'Step').map(ddrSchritt),
  }));

  const wertelisten: FmWerteliste[] = alle(kind(file, 'ValueListCatalog'), 'ValueList').map((v) => {
    const src = attr(kind(v, 'Source'), 'value') ?? (kind(v, 'CustomValues') ? 'Custom' : '?');
    const pf = alle(kind(v, 'PrimaryField'), 'Field')[0];
    return {
      name: attr(v, 'name') ?? '?', quelle: src,
      werte: text(kind(kind(v, 'CustomValues'), 'Text')).split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean),
      feld: pf ? `${attr(pf, 'table')}::${attr(pf, 'name')}` : null,
    };
  });

  const eigeneFunktionen: FmEigeneFunktion[] = alle(kind(file, 'CustomFunctionCatalog'), 'CustomFunction').map((c) => ({
    name: attr(c, 'name') ?? '?', parameter: (attr(c, 'parameters') ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean),
    formel: text(kind(c, 'Calculation')),
  }));

  const konten: FmKonto[] = alle(kind(file, 'AccountCatalog'), 'Account').map((a) => ({
    name: attr(a, 'name') ?? '?', berechtigung: attr(a, 'privilegeSet') ?? '?',
    aktiv: !/inactive/i.test(attr(a, 'status') ?? 'Active'), typ: attr(a, 'type') ?? '?',
  }));

  const dateiReferenzen: FmDateiReferenz[] = alle(kind(file, 'FileReferenceCatalog') ?? kind(file, 'ExternalDataSourcesCatalog'), 'FileReference')
    .map((f) => ({ name: attr(f, 'name') ?? '?', pfad: attr(f, 'pathList') ?? attr(f, 'path') ?? '' }));

  return {
    name, tabellen, tabellenvorkommen, beziehungen, layouts, scripts, wertelisten, eigeneFunktionen, konten,
    berechtigungssaetze: alle(kind(file, 'PrivilegesCatalog'), 'PrivilegeSet').map((p) => attr(p, 'name') ?? '?'),
    erweiterteBerechtigungen: alle(kind(file, 'ExtendedPrivilegeCatalog'), 'ExtendedPrivilege').map((p) => attr(p, 'name') ?? '?'),
    dateiReferenzen,
  };
}

// ---------------------------------------------------------- SaveAsXML (experimentell)

function saveAsXmlDatei(root: Knoten, dateiname: string): FmDatei {
  const ref = (n: Knoten | undefined, tag: string) => attr(alle(n, tag)[0], 'name');
  const basis = alle(root, 'BaseTablesCatalog').flatMap((c) => alle(c, 'BaseTable'));
  const felderJeTabelle = new Map<string, FmFeld[]>();
  for (const fc of alle(kind(root, 'Structure') ?? root, 'FieldCatalog')) {
    const tab = ref(fc, 'BaseTableReference'); if (!tab) continue;
    const felder = alle(kind(fc, 'ObjectList') ?? fc, 'Field').map((f): FmFeld => ({
      id: attr(f, 'id') ?? '', name: attr(f, 'name') ?? '?', typ: attr(f, 'datatype') ?? attr(f, 'dataType') ?? '?',
      art: attr(f, 'fieldtype') ?? attr(f, 'fieldType') ?? 'Normal',
      formel: alle(f, 'Calculation').map(text).find(Boolean) ?? null,
      autoEingabe: kind(f, 'AutoEnter') ? [attr(kind(f, 'AutoEnter'), 'type') ?? 'AutoEnter'] : [],
      validierung: kind(f, 'Validation') ? ['Validation'] : [], global: istWahr(attr(kind(f, 'Storage'), 'global')),
      wiederholungen: Number(attr(kind(f, 'Storage'), 'maxRepetitions') ?? 1) || 1, kommentar: text(kind(f, 'Comment')) || null,
    }));
    felderJeTabelle.set(tab, [...(felderJeTabelle.get(tab) ?? []), ...felder]);
  }
  const tabellen: FmTabelle[] = basis.map((b) => ({
    id: attr(b, 'id') ?? '', name: attr(b, 'name') ?? '?', datensaetze: null, felder: felderJeTabelle.get(attr(b, 'name') ?? '') ?? [],
  }));
  const schritteJeScript = new Map<string, FmSchritt[]>();
  for (const s of alle(root, 'StepsForScripts').flatMap((x) => alle(x, 'Script'))) {
    const n = ref(s, 'ScriptReference'); if (!n) continue;
    schritteJeScript.set(n, alle(s, 'Step').map((st) => ({
      id: attr(st, 'id') === null ? null : Number(attr(st, 'id')), name: attr(st, 'name') ?? '?',
      aktiv: attr(st, 'enable') === null || istWahr(attr(st, 'enable')),
      details: alle(st, 'Calculation').map(text).join(' | ').slice(0, 300),
    })));
  }
  const scripts: FmScript[] = alle(root, 'ScriptCatalog').flatMap((c) => mitOrdnern(c, 'Script', ['Group', 'Folder']))
    .map(({ k, ordner }) => ({
      id: attr(k, 'id') ?? '', name: attr(k, 'name') ?? '?', ordner, imMenue: istWahr(attr(k, 'includeInMenu')),
      schritte: schritteJeScript.get(attr(k, 'name') ?? '') ?? [],
    }));
  const layouts: FmLayout[] = alle(root, 'LayoutCatalog').flatMap((c) => mitOrdnern(c, 'Layout', ['Group', 'Folder']))
    .map(({ k, ordner }) => ({ id: attr(k, 'id') ?? '', name: attr(k, 'name') ?? '?', ordner, tabelle: ref(k, 'TableOccurrenceReference'), felder: [], scripts: [] }));
  const beziehungen: FmBeziehung[] = alle(root, 'RelationshipCatalog').flatMap((c) => alle(c, 'Relationship')).map((r) => ({
    links: ref(kind(r, 'LeftTable'), 'TableOccurrenceReference') ?? '?', rechts: ref(kind(r, 'RightTable'), 'TableOccurrenceReference') ?? '?',
    kaskadeErstellenRechts: istWahr(attr(kind(r, 'RightTable'), 'cascadeCreate')), kaskadeLoeschenRechts: istWahr(attr(kind(r, 'RightTable'), 'cascadeDelete')),
    bedingungen: alle(r, 'JoinPredicate').map((j) => ({
      typ: attr(j, 'type') ?? 'Equal',
      links: `${ref(kind(j, 'LeftField'), 'TableOccurrenceReference')}::${ref(kind(j, 'LeftField'), 'FieldReference')}`,
      rechts: `${ref(kind(j, 'RightField'), 'TableOccurrenceReference')}::${ref(kind(j, 'RightField'), 'FieldReference')}`,
    })),
  }));
  return {
    name: attr(root, 'File') ?? dateiname, tabellen,
    tabellenvorkommen: alle(root, 'TableOccurrenceCatalog').flatMap((c) => alle(c, 'TableOccurrence')).map((t) => ({
      name: attr(t, 'name') ?? '?', basisTabelle: ref(t, 'BaseTableReference') ?? '?', datei: ref(t, 'DataSourceReference') ?? null,
    })),
    beziehungen, layouts, scripts,
    wertelisten: alle(root, 'ValueListCatalog').flatMap((c) => alle(c, 'ValueList')).map((v) => ({
      name: attr(v, 'name') ?? '?', quelle: attr(kind(v, 'Source'), 'value') ?? '?',
      werte: alle(v, 'CustomValues').map(text).join('\n').split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean), feld: null,
    })),
    eigeneFunktionen: alle(root, 'CustomFunctionsCatalog').flatMap((c) => alle(c, 'CustomFunction')).map((c) => ({
      name: attr(c, 'name') ?? '?', parameter: [], formel: alle(c, 'Calculation').map(text).join(''),
    })),
    konten: alle(root, 'AccountsCatalog').flatMap((c) => alle(c, 'Account')).map((a) => ({
      name: attr(a, 'name') ?? '?', berechtigung: ref(a, 'PrivilegeSetReference') ?? '?', aktiv: true, typ: attr(a, 'type') ?? '?',
    })),
    berechtigungssaetze: alle(root, 'PrivilegeSetsCatalog').flatMap((c) => alle(c, 'PrivilegeSet')).map((p) => attr(p, 'name') ?? '?'),
    erweiterteBerechtigungen: alle(root, 'ExtendedPrivilegesCatalog').flatMap((c) => alle(c, 'ExtendedPrivilege')).map((p) => attr(p, 'name') ?? '?'),
    dateiReferenzen: alle(root, 'ExternalDataSourcesCatalog').flatMap((c) => alle(c, 'FileReference')).map((f) => ({ name: attr(f, 'name') ?? '?', pfad: attr(f, 'pathList') ?? '' })),
  };
}

// ---------------------------------------------------------------- Einstieg

/** Parst eine XML-Datei; liefert null, wenn sie keine Struktur enthaelt (z. B. DDR-Summary.xml). */
export function parseXml(inhalt: string, dateiname = 'unbekannt'): { format: FmInventar['format']; version: string | null; dateien: FmDatei[] } | null {
  const doc = xml.parse(inhalt) as Knoten;
  const report = kind(doc, 'FMPReport');
  if (report) {
    if (/summary/i.test(attr(report, 'type') ?? '')) return null;
    return { format: 'DDR', version: attr(report, 'version'), dateien: kinder(report, 'File').map(ddrDatei) };
  }
  const save = kind(doc, 'FMSaveAsXML');
  if (save) return { format: 'SaveAsXML', version: attr(save, 'version'), dateien: [saveAsXmlDatei(save, dateiname.replace(/\.xml$/i, ''))] };
  throw new Error(`${dateiname}: weder DDR (<FMPReport>) noch SaveAsXML (<FMSaveAsXML>)`);
}

/** Fuehrt mehrere XML-Dateien (DDR erzeugt eine Datei je FileMaker-Datei) zu einem Inventar zusammen. */
export function baueInventar(dateien: { name: string; inhalt: string }[]): FmInventar {
  let format: FmInventar['format'] = 'DDR'; let version: string | null = null;
  const alleDateien: FmDatei[] = [];
  for (const d of dateien) {
    const r = parseXml(d.inhalt, d.name);
    if (!r) continue;
    format = r.format; version ??= r.version;
    alleDateien.push(...r.dateien);
  }
  if (!alleDateien.length) throw new Error('Keine FileMaker-Struktur gefunden (nur Summary.xml?)');
  return { format, version, dateien: alleDateien };
}

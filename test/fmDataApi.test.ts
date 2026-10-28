import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sammleUeberDataApi, pruefeServerUrl, flach, DataApiFehler } from '../tools/fm-analyse/dataApi';
import { fuehreAusDataApi } from '../tools/fm-analyse/cli';

/*
 * Synthetischer FileMaker-Server (Data API) mit Strukturen wie im DDR-Fixture. Datensatzinhalte tragen den
 * Marker GEHEIM, damit geprueft werden kann, dass sie nie ins Inventar gelangen.
 */
type Aufruf = { methode: string; pfad: string; auth: string | null };
function fakeServer(opts: { mitTable?: boolean; fehlerBeiLayout?: string; passwort?: string } = {}) {
  const aufrufe: Aufruf[] = [];
  const TOKEN = 'tok-123';
  const feld = (name: string, x: Record<string, unknown> = {}) => ({ name, type: 'normal', displayType: 'editText', result: 'text', global: false,
    autoEnter: false, fourDigitYear: false, maxRepeat: 1, maxCharacters: 0, notEmpty: false, numeric: false, repetitions: 1, timeOfDay: false, ...x });
  const layoutListe = [
    { name: 'Projekte Liste', table: 'Projekte' },
    { name: 'Faktura', isFolder: true, folderLayoutNames: [{ name: 'Faktura Detail', table: 'Fakturen' }, { name: '-', isFolder: false }] },
    { name: 'Seminar Teilnehmende', table: 'Teilnehmende' },
  ].map((l: any) => (opts.mitTable === false ? stripTable(l) : l));
  function stripTable(l: any): any { const { table, ...rest } = l; return { ...rest, ...(l.folderLayoutNames ? { folderLayoutNames: l.folderLayoutNames.map(stripTable) } : {}) }; }
  const meta: Record<string, unknown> = {
    'Projekte Liste': {
      fieldMetaData: [feld('ProjektNr', { notEmpty: true }), feld('Stammnummer', { result: 'number', numeric: true }), feld('Jahr', { result: 'number' }),
        feld('Bezeichnung', { maxCharacters: 120 }), feld('Bereich', { displayType: 'popupList', valueList: 'Bereiche' }),
        feld('Total abgerechnet', { type: 'calculation', result: 'number' }), feld('gSuche', { global: true }),
        feld('Auftraggeber::Name')],
      portalMetaData: { Fakturen: [feld('Fakturen::RgNr', { autoEnter: true }), feld('Fakturen::Total netto', { type: 'summary', result: 'number' })] },
      valueLists: [{ name: 'Bereiche', type: 'customList', values: [{ value: 'Weiterbildung', displayValue: 'Weiterbildung' }, { value: 'Beratung', displayValue: 'Beratung' }] },
        { name: 'Mitarbeitende', type: 'byField', values: [{ value: 'GEHEIM Max Muster', displayValue: 'GEHEIM Max Muster' }] }],
    },
    'Faktura Detail': { fieldMetaData: [feld('RgNr'), feld('Datum', { result: 'date' }), feld('Total netto', { type: 'summary', result: 'number' })], portalMetaData: {} },
    'Seminar Teilnehmende': { fieldMetaData: [feld('Nachname'), feld('Email')], portalMetaData: {} },
  };
  const anzahl: Record<string, [string, number]> = { 'Projekte Liste': ['Projekte', 4967], 'Faktura Detail': ['Fakturen', 33214], 'Seminar Teilnehmende': ['Teilnehmende', 0] };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const ok = (response: unknown) => json(200, { response, messages: [{ code: '0', message: 'OK' }] });

  const f = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const h = new Headers(init.headers);
    aufrufe.push({ methode: init.method ?? 'GET', pfad: decodeURIComponent(u.pathname) + u.search, auth: h.get('authorization') });
    const basis = '/fmi/data/v1/databases/Projekte';
    const p = decodeURIComponent(u.pathname);
    if (!p.startsWith(basis)) return json(404, { messages: [{ code: '802', message: 'Unable to open file' }] });
    const rest = p.slice(basis.length);
    if (rest === '/sessions' && init.method === 'POST') {
      const erwartet = `Basic ${Buffer.from(`analyse:${opts.passwort ?? 'pw-geheim'}`).toString('base64')}`;
      if (h.get('authorization') !== erwartet) return json(401, { messages: [{ code: '212', message: 'Invalid user account and/or password' }] });
      return json(200, { response: { token: TOKEN }, messages: [{ code: '0', message: 'OK' }] }, { 'x-fm-data-access-token': TOKEN });
    }
    if (rest === `/sessions/${TOKEN}` && init.method === 'DELETE') return ok({});
    if (h.get('authorization') !== `Bearer ${TOKEN}`) return json(401, { messages: [{ code: '952', message: 'Invalid FileMaker Data API token' }] });
    if (rest === '/layouts') return ok({ layouts: layoutListe });
    if (rest === '/scripts') return ok({ scripts: [{ name: 'Rechnung drucken', isFolder: false }, { name: 'Import', isFolder: true, folderScriptNames: [{ name: 'Excel-Intake Seminare', isFolder: false }] }] });
    const m = rest.match(/^\/layouts\/([^/]+)(\/records)?$/);
    if (m) {
      const name = m[1];
      if (name === opts.fehlerBeiLayout) return json(500, { messages: [{ code: '100', message: 'File is missing' }] });
      if (m[2]) {
        const [table, total] = anzahl[name];
        if (!total) return json(500, { messages: [{ code: '401', message: 'No records match the request' }] });
        return ok({ dataInfo: { database: 'Projekte', layout: name, table, totalRecordCount: total, foundCount: total, returnedCount: 1 },
          data: [{ fieldData: { Bezeichnung: 'GEHEIM Datensatz' }, recordId: '1', modId: '0' }] });
      }
      return meta[name] ? ok(meta[name]) : json(500, { messages: [{ code: '105', message: 'Layout is missing' }] });
    }
    return json(404, { messages: [{ code: '-1', message: 'unbekannt' }] });
  }) as typeof fetch;
  return { f, aufrufe };
}

const basis = { server: 'https://fms.example.test', datenbanken: ['Projekte'], benutzer: 'analyse', passwort: 'pw-geheim' };

describe('fm-analyse: Data API', () => {
  it('liest Layouts (mit Ordnern), Scripts, Felder, Wertelisten und Datensatzanzahlen', async () => {
    const { f } = fakeServer();
    const inv = await sammleUeberDataApi({ ...basis, fetch: f });
    expect(inv.format).toBe('DataAPI');
    const d = inv.dateien[0];
    expect(d.name).toBe('Projekte');
    expect(d.layouts.map((l) => [l.name, l.tabelle, l.ordner])).toEqual([
      ['Projekte Liste', 'Projekte', []], ['Faktura Detail', 'Fakturen', ['Faktura']], ['Seminar Teilnehmende', 'Teilnehmende', []]]);
    expect(d.scripts.map((s) => [s.name, s.ordner])).toEqual([['Rechnung drucken', []], ['Excel-Intake Seminare', ['Import']]]);

    const p = d.tabellen.find((t) => t.name === 'Projekte')!;
    expect(p.datensaetze).toBe(4967);
    expect(p.felder.find((x) => x.name === 'ProjektNr')!.validierung).toContain('notEmpty');
    expect(p.felder.find((x) => x.name === 'Stammnummer')).toMatchObject({ typ: 'Number', art: 'Normal' });
    expect(p.felder.find((x) => x.name === 'Total abgerechnet')!.art).toBe('Calculated');
    expect(p.felder.find((x) => x.name === 'gSuche')!.global).toBe(true);
    expect(p.felder.find((x) => x.name === 'Bereich')!.validierung).toContain('Werteliste Bereiche');

    // Felder aus Bezugs-TOs und Portalen landen beim richtigen Tabellenvorkommen, ohne Duplikate
    const fakt = d.tabellen.find((t) => t.name === 'Fakturen')!;
    expect(fakt.felder.map((x) => x.name).sort()).toEqual(['Datum', 'RgNr', 'Total netto']);
    expect(fakt.datensaetze).toBe(33214);
    expect(fakt.felder.find((x) => x.name === 'Total netto')!.art).toBe('Summary');
    expect(d.tabellen.find((t) => t.name === 'Auftraggeber')!.datensaetze).toBeNull();
    expect(d.tabellen.find((t) => t.name === 'Teilnehmende')!.datensaetze).toBe(0);
    expect(d.beziehungen.map((b) => `${b.links}->${b.rechts}`).sort()).toEqual(['Projekte->Auftraggeber', 'Projekte->Fakturen']);

    expect(d.wertelisten.find((w) => w.name === 'Bereiche')!.werte).toEqual(['Weiterbildung', 'Beratung']);
  });

  it('uebernimmt keine Datensatzinhalte und keine Werte feldbasierter Wertelisten', async () => {
    const { f } = fakeServer();
    const inv = await sammleUeberDataApi({ ...basis, fetch: f });
    expect(JSON.stringify(inv)).not.toContain('GEHEIM');
    expect(inv.dateien[0].wertelisten.find((w) => w.name === 'Mitarbeitende')).toMatchObject({ quelle: 'Feld', werte: [] });
    expect(JSON.stringify(inv)).not.toContain('pw-geheim');
  });

  it('meldet die Sitzung immer ab, auch wenn ein Layout fehlschlaegt', async () => {
    const { f, aufrufe } = fakeServer({ fehlerBeiLayout: 'Faktura Detail' });
    await expect(sammleUeberDataApi({ ...basis, fetch: f })).rejects.toThrow(/FileMaker 100/);
    expect(aufrufe.at(-1)).toMatchObject({ methode: 'DELETE', pfad: '/fmi/data/v1/databases/Projekte/sessions/tok-123' });
  });

  it('klare Meldung bei falschem Passwort, ohne das Passwort zu zeigen', async () => {
    const { f, aufrufe } = fakeServer({ passwort: 'anderes' });
    const fehler = await sammleUeberDataApi({ ...basis, fetch: f }).catch((e) => e);
    expect(fehler).toBeInstanceOf(DataApiFehler);
    expect(fehler.message).toMatch(/FileMaker 212.*fmrest/);
    expect(fehler.message).not.toContain('pw-geheim');
    expect(aufrufe.some((a) => a.methode === 'DELETE')).toBe(false);
  });

  it('aeltere Server ohne "table" in der Layoutliste: Tabellenvorkommen aus dataInfo', async () => {
    const { f } = fakeServer({ mitTable: false });
    const d = (await sammleUeberDataApi({ ...basis, fetch: f, mitAnzahl: false })).dateien[0];
    expect(d.layouts.find((l) => l.name === 'Projekte Liste')!.tabelle).toBe('Projekte');
    expect(d.tabellen.find((t) => t.name === 'Projekte')!.felder.length).toBeGreaterThan(5);
  });

  it('fragt die Datensatzanzahl je Tabellenvorkommen nur einmal ab und laesst sie mit mitAnzahl=false weg', async () => {
    const { f, aufrufe } = fakeServer();
    await sammleUeberDataApi({ ...basis, fetch: f });
    expect(aufrufe.filter((a) => a.pfad.includes('/records')).length).toBe(3);
    const ohne = fakeServer();
    const inv = await sammleUeberDataApi({ ...basis, fetch: ohne.f, mitAnzahl: false });
    expect(ohne.aufrufe.some((a) => a.pfad.includes('/records'))).toBe(false);
    expect(inv.dateien[0].tabellen.every((t) => t.datensaetze === null)).toBe(true);
  });

  it('nur https (http einzig fuer localhost), keine Zugangsdaten in der URL', () => {
    expect(pruefeServerUrl('https://fms.example.test/irgendwas')).toBe('https://fms.example.test');
    expect(pruefeServerUrl('http://localhost:8443')).toBe('http://localhost:8443');
    expect(() => pruefeServerUrl('http://fms.example.test')).toThrow(/https/);
    expect(() => pruefeServerUrl('https://u:p@fms.example.test')).toThrow(/Zugangsdaten/);
    expect(() => pruefeServerUrl('kein url')).toThrow(/Ungueltige/);
  });

  it('Ordnerbaeume werden flach, Trennlinien entfallen', () => {
    expect(flach([{ name: 'A', isFolder: true, folderScriptNames: [{ name: 'B', isFolder: true, folderScriptNames: [{ name: 'x' }] }] }, { name: '--' }], 'folderScriptNames'))
      .toEqual([{ name: 'x', table: null, ordner: ['A', 'B'] }]);
  });
});

describe('fm-analyse CLI: Data-API-Modus', () => {
  it('schreibt Bericht, Inventar und Mapping; Passwort nur aus FM_PASSWORT', async () => {
    const { f } = fakeServer();
    const out = mkdtempSync(join(tmpdir(), 'fm-dataapi-'));
    const argv = ['--data-api', 'https://fms.example.test', '--datenbank', 'Projekte', '--benutzer', 'analyse', '--out', out];
    const r = await fuehreAusDataApi(argv, { FM_PASSWORT: 'pw-geheim' }, f);
    const bericht = readFileSync(join(r.out, 'FUNKTIONSUMFANG.md'), 'utf8');
    expect(bericht).toContain('Quelle Data API');
    expect(bericht).toMatch(/Projekte \| 4967/);
    expect(bericht).toContain('auf Layout verwendet, Schluessel nur im DDR');
    expect(readFileSync(join(r.out, 'inventar.json'), 'utf8')).not.toContain('GEHEIM');
    await expect(fuehreAusDataApi([...argv, '--passwort', 'x'], {}, f)).rejects.toThrow(/FM_PASSWORT/);
    await expect(fuehreAusDataApi(argv, {}, f)).rejects.toThrow(/Passwort/);
  });
});

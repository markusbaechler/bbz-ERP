import type { FmInventar, FmDatei, FmTabelle, FmFeld, FmLayout, FmScript, FmWerteliste, FmBeziehung } from './typen';

/*
 * Dritter Analyseweg ohne FileMaker-Oberflaeche: liest Layouts, Scripts, Felder (inkl. Typ, Berechnung/Statistik,
 * Validierung), Wertelisten und Datensatzanzahlen ueber die FileMaker Data API des Servers, auf dem die Loesung
 * gehostet ist (Spec v1: Datei "Projekte" auf BBZ-AZ-SRVAPP01).
 *
 * Endpunkte [belegt: Client @proofgeist/fmdapi 4.4.0; Claris Data API Guide "Get layout metadata"]:
 *   POST   /fmi/data/{v}/databases/{db}/sessions            (Basic-Auth -> Header X-FM-Data-Access-Token)
 *   GET    /fmi/data/{v}/databases/{db}/layouts             (Baum mit isFolder/folderLayoutNames, optional table)
 *   GET    /fmi/data/{v}/databases/{db}/scripts             (Baum mit isFolder/folderScriptNames)
 *   GET    /fmi/data/{v}/databases/{db}/layouts/{layout}    (fieldMetaData, portalMetaData, valueLists)
 *   GET    /fmi/data/{v}/databases/{db}/layouts/{layout}/records?_limit=1   (nur dataInfo.table/totalRecordCount)
 *   DELETE /fmi/data/{v}/databases/{db}/sessions/{token}
 * Voraussetzung: FileMaker Server ab 18 [Hypothese: Metadaten-Endpunkte ab 18] mit aktivierter Data API und ein
 * Konto mit dem erweiterten Recht "fmrest".
 *
 * Grenzen gegenueber dem DDR: keine Script-Schritte, keine Formeln, keine Beziehungsschluessel, keine Konten; Tabellen
 * sind Tabellenvorkommen und nur sichtbar, soweit sie auf einem Layout liegen.
 * Datenschutz: Datensatzinhalte werden nie uebernommen (nur dataInfo); Werte feldbasierter Wertelisten ebenso nicht.
 * Das Passwort kommt nur aus dem Aufrufer (CLI: Umgebungsvariable) und wird nirgends ausgegeben.
 */

export type DataApiOptionen = {
  server: string;
  datenbanken: string[];
  benutzer: string;
  passwort: string;
  version?: string;
  /** Datensatzanzahl je Tabellenvorkommen ermitteln (ein Request je Tabellenvorkommen, Default true). */
  mitAnzahl?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type Antwort<T> = { response?: T; messages?: { code: string; message: string }[] };
type Knoten = { name: string; isFolder?: boolean; table?: string; folderLayoutNames?: Knoten[]; folderScriptNames?: Knoten[] };
type FeldMeta = {
  name: string; type?: string; result?: string; global?: boolean; autoEnter?: boolean; maxRepeat?: number;
  maxCharacters?: number; notEmpty?: boolean; numeric?: boolean; valueList?: string;
};
type LayoutMeta = { fieldMetaData?: FeldMeta[]; portalMetaData?: Record<string, FeldMeta[]>; valueLists?: { name: string; type?: string; values?: { value: string }[] }[] };
type DatenInfo = { dataInfo?: { table?: string; totalRecordCount?: number } };

export class DataApiFehler extends Error {
  constructor(message: string, readonly code: string | null = null) { super(message); }
}

const TYP: Record<string, string> = { text: 'Text', number: 'Number', date: 'Date', time: 'Time', timeStamp: 'TimeStamp', container: 'Binary' };
const ART: Record<string, string> = { normal: 'Normal', calculation: 'Calculated', summary: 'Summary' };

/** Nur https; http einzig fuer localhost (z. B. SSH-Tunnel). Kein Abschalten der TLS-Pruefung. */
export function pruefeServerUrl(server: string): string {
  let u: URL;
  try { u = new URL(server); } catch { throw new DataApiFehler(`Ungueltige Server-URL: ${server}`); }
  const lokal = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && lokal)) throw new DataApiFehler('Server-URL muss https:// verwenden');
  if (u.username || u.password) throw new DataApiFehler('Zugangsdaten nicht in die URL schreiben');
  return u.origin;
}

/** Ordnerbaum (Layouts/Scripts) flach machen; der Ordnerpfad bleibt erhalten. */
export function flach(knoten: Knoten[], kinderSchluessel: 'folderLayoutNames' | 'folderScriptNames', pfad: string[] = []): { name: string; table: string | null; ordner: string[] }[] {
  const out: { name: string; table: string | null; ordner: string[] }[] = [];
  for (const k of knoten ?? []) {
    if (k.isFolder) out.push(...flach(k[kinderSchluessel] ?? [], kinderSchluessel, [...pfad, k.name]));
    else if (k.name && !/^-+$/.test(k.name)) out.push({ name: k.name, table: k.table || null, ordner: pfad });
  }
  return out;
}

function zuFeld(to: string, name: string, m: FeldMeta): FmFeld {
  const validierung: string[] = [];
  if (m.notEmpty) validierung.push('notEmpty');
  if (m.numeric) validierung.push('numeric');
  if (m.maxCharacters && m.maxCharacters > 0) validierung.push(`maxCharacters ${m.maxCharacters}`);
  if (m.valueList) validierung.push(`Werteliste ${m.valueList}`);
  return {
    id: `${to}::${name}`, name, typ: TYP[m.result ?? ''] ?? m.result ?? '?', art: ART[m.type ?? ''] ?? m.type ?? '?',
    formel: null, autoEingabe: m.autoEnter ? ['autoEnter (Details nur im DDR)'] : [], validierung,
    global: m.global === true, wiederholungen: m.maxRepeat ?? 1, kommentar: null, naechsterSerienwert: null,
  };
}

/** "TO::Feld" -> [TO, Feld]; ohne "::" gehoert das Feld zum Tabellenvorkommen des Layouts. */
function teile(feld: string, layoutTo: string): [string, string] {
  const i = feld.indexOf('::');
  return i < 0 ? [layoutTo, feld] : [feld.slice(0, i), feld.slice(i + 2)];
}

class Sitzung {
  private token: string | null = null;
  constructor(private readonly basis: string, private readonly o: Required<Pick<DataApiOptionen, 'benutzer' | 'passwort' | 'timeoutMs'>> & { fetch: typeof fetch }) {}

  async anmelden(): Promise<void> {
    const r = await this.o.fetch(`${this.basis}/sessions`, {
      method: 'POST', signal: AbortSignal.timeout(this.o.timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.o.benutzer}:${this.o.passwort}`).toString('base64')}` },
      body: '{}',
    });
    if (!r.ok) {
      const m = ((await r.json().catch(() => ({}))) as Antwort<unknown>).messages?.[0];
      throw new DataApiFehler(`Anmeldung an der Data API fehlgeschlagen (HTTP ${r.status}${m ? `, FileMaker ${m.code}: ${m.message}` : ''}). Konto, Passwort und das Recht "fmrest" pruefen.`, m?.code ?? null);
    }
    this.token = r.headers.get('x-fm-data-access-token');
    if (!this.token) throw new DataApiFehler('Data API lieferte kein Sitzungs-Token');
  }

  /** GET; liefert null bei FileMaker-Code 401 (keine Datensaetze) bzw. 105 (Layout fehlt), sonst Fehler. */
  async hole<T>(pfad: string): Promise<T | null> {
    const r = await this.o.fetch(`${this.basis}${pfad}`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.o.timeoutMs) });
    const j = (await r.json().catch(() => ({}))) as Antwort<T>;
    const code = j.messages?.[0]?.code ?? (r.ok ? '0' : String(r.status));
    if (code === '0') return (j.response ?? null) as T | null;
    if (code === '401' || code === '105') return null;
    throw new DataApiFehler(`Data API ${pfad}: FileMaker ${code} ${j.messages?.[0]?.message ?? ''}`.trim(), code);
  }

  async abmelden(): Promise<void> {
    if (!this.token) return;
    const t = this.token; this.token = null;
    await this.o.fetch(`${this.basis}/sessions/${encodeURIComponent(t)}`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(this.o.timeoutMs) }).catch(() => undefined);
  }
}

async function sammleDatei(s: Sitzung, db: string, mitAnzahl: boolean): Promise<FmDatei> {
  const layouts = flach((await s.hole<{ layouts: Knoten[] }>('/layouts'))?.layouts ?? [], 'folderLayoutNames');
  const scripts = flach((await s.hole<{ scripts: Knoten[] }>('/scripts'))?.scripts ?? [], 'folderScriptNames');

  const tabellen = new Map<string, Map<string, FmFeld>>();
  const anzahl = new Map<string, number | null>();
  const wertelisten = new Map<string, FmWerteliste>();
  const bezug = new Map<string, Set<string>>();
  const fmLayouts: FmLayout[] = [];
  const feldAblegen = (to: string, name: string, m: FeldMeta) => {
    if (!tabellen.has(to)) tabellen.set(to, new Map());
    if (!tabellen.get(to)!.has(name)) tabellen.get(to)!.set(name, zuFeld(to, name, m));
  };

  for (const l of layouts) {
    const pfad = `/layouts/${encodeURIComponent(l.name)}`;
    let to = l.table;
    // Ohne "table" in der Layoutliste (aeltere Server) liefert dataInfo das Tabellenvorkommen
    if (!to || (mitAnzahl && !anzahl.has(to))) {
      const d = await s.hole<DatenInfo>(`${pfad}/records?_limit=1`);
      to ||= d?.dataInfo?.table ?? null;
      if (to && mitAnzahl && !anzahl.has(to)) anzahl.set(to, d?.dataInfo?.totalRecordCount ?? 0);
    }
    const meta = await s.hole<LayoutMeta>(pfad);
    const felder: string[] = [];
    const layoutTo = to ?? `(Layout ${l.name})`;
    const verarbeite = (m: FeldMeta) => {
      const [t, f] = teile(m.name, layoutTo);
      feldAblegen(t, f, m);
      felder.push(m.name);
      if (t !== layoutTo) (bezug.get(layoutTo) ?? bezug.set(layoutTo, new Set()).get(layoutTo)!).add(t);
    };
    for (const m of meta?.fieldMetaData ?? []) verarbeite(m);
    for (const portal of Object.values(meta?.portalMetaData ?? {})) for (const m of portal) verarbeite(m);
    for (const w of meta?.valueLists ?? []) {
      if (wertelisten.has(w.name)) continue;
      const feldbasiert = w.type === 'byField';
      // Werte feldbasierter Listen sind Datensatzinhalte (z. B. Namen) und werden nicht uebernommen
      wertelisten.set(w.name, { name: w.name, quelle: feldbasiert ? 'Feld' : 'Eigene Werte', werte: feldbasiert ? [] : (w.values ?? []).map((v) => v.value), feld: null });
    }
    fmLayouts.push({ id: l.name, name: l.name, tabelle: to, ordner: l.ordner, felder, scripts: [] });
  }

  const fmTabellen: FmTabelle[] = [...tabellen].map(([name, felder]) => ({ id: name, name, datensaetze: anzahl.get(name) ?? null, felder: [...felder.values()] }));
  const beziehungen: FmBeziehung[] = [...bezug].flatMap(([links, rechts]) => [...rechts].map((r) => ({ links, rechts: r, bedingungen: [], kaskadeErstellenRechts: false, kaskadeLoeschenRechts: false })));
  const fmScripts: FmScript[] = scripts.map((x) => ({ id: x.name, name: x.name, ordner: x.ordner, imMenue: false, schritte: [] }));
  return {
    name: db, tabellen: fmTabellen, tabellenvorkommen: [], beziehungen, layouts: fmLayouts, scripts: fmScripts,
    wertelisten: [...wertelisten.values()], eigeneFunktionen: [], konten: [], berechtigungssaetze: [], erweiterteBerechtigungen: [], dateiReferenzen: [],
  };
}

/** Sammelt das Inventar aller angegebenen Datenbanken; jede Sitzung wird auch im Fehlerfall wieder abgemeldet. */
export async function sammleUeberDataApi(o: DataApiOptionen): Promise<FmInventar> {
  const origin = pruefeServerUrl(o.server);
  if (!o.datenbanken.length) throw new DataApiFehler('Mindestens eine Datenbank angeben (--datenbank)');
  if (!o.benutzer || !o.passwort) throw new DataApiFehler('Benutzer und Passwort (FM_PASSWORT) sind noetig');
  const version = o.version ?? 'v1';
  if (!/^(v\d+|vLatest)$/.test(version)) throw new DataApiFehler(`Ungueltige API-Version: ${version}`);
  const f = o.fetch ?? fetch;
  const dateien: FmDatei[] = [];
  for (const db of o.datenbanken) {
    const s = new Sitzung(`${origin}/fmi/data/${version}/databases/${encodeURIComponent(db)}`,
      { benutzer: o.benutzer, passwort: o.passwort, timeoutMs: o.timeoutMs ?? 30_000, fetch: f });
    try {
      await s.anmelden();
      dateien.push(await sammleDatei(s, db, o.mitAnzahl !== false));
    } finally {
      await s.abmelden();
    }
  }
  return { format: 'DataAPI', version: null, dateien };
}

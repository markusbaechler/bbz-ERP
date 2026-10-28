import type { FmInventar, FmScript, FmTabelle } from './typen';

// ------------------------------------------------------------ Funktionsklassen der Script-Schritte

export type Funktion =
  | 'Import' | 'Export' | 'PDF' | 'Druck' | 'E-Mail' | 'Web/URL' | 'Server' | 'Datenpflege' | 'Suche'
  | 'Navigation' | 'Dialog' | 'Dateien' | 'Externe Programme' | 'Konten' | 'Telefonie';

/*
 * Zuordnung ueber Schritt-ID (sprachunabhaengig) und – als Rueckfall – ueber den Namen (DE/EN).
 * Die IDs entsprechen den FileMaker-Script-Step-IDs im XML; Abweichungen je Version faengt die Namensregel auf.
 */
const SCHRITT_REGELN: { funktion: Funktion; ids: number[]; name: RegExp }[] = [
  // vor "Datenpflege" (Konto loeschen) und "Dateien" (Plug-In-Datei)
  { funktion: 'Konten', ids: [], name: /konto|account|passwort|password|erneut anmelden|re-?login/i },
  { funktion: 'Telefonie', ids: [], name: /telefonnummer|dial phone/i },
  { funktion: 'Externe Programme', ids: [], name: /plug-?in/i },
  { funktion: 'Import', ids: [35], name: /import/i },
  { funktion: 'Export', ids: [36], name: /export|als excel|save records as (excel|snapshot)/i },
  { funktion: 'PDF', ids: [144], name: /pdf/i },
  { funktion: 'Druck', ids: [43, 42], name: /^(drucken|print)\b|drucker|print setup/i },
  { funktion: 'E-Mail', ids: [63], name: /e-?mail|mail senden|send mail/i },
  { funktion: 'Web/URL', ids: [160, 111], name: /url|web ?viewer|aus url|insert from url|open url/i },
  { funktion: 'Server', ids: [164], name: /auf server|on server/i },
  { funktion: 'Datenpflege', ids: [76, 7, 8, 9, 10, 91, 92, 93], name: /feldwert setzen|set field|neuer datensatz|new record|duplizier|duplicate|l[oö]sch|delete|ersetze|replace field/i },
  { funktion: 'Suche', ids: [28, 31, 22, 25], name: /suche|find|abfrage|show all|alle datens[aä]tze/i },
  // "Datei öffnen" oeffnet in FileMaker eine andere Datei der Loesung = Wechsel des Bereichs
  { funktion: 'Navigation', ids: [6, 16, 74], name: /gehe zu|go to|datei öffnen|datei schlie|open file|close file/i },
  { funktion: 'Dialog', ids: [87], name: /dialog|eigenes dialogfeld|custom dialog/i },
  { funktion: 'Dateien', ids: [], name: /datei|file|container|exportiere feldinhalt|export field contents/i },
  { funktion: 'Externe Programme', ids: [], name: /applescript|ereignis senden|send event|dde|odbc|sql/i },
];

const KOMMENTAR_ID = 89;

export function klassifiziereSchritt(id: number | null, name: string): Funktion | null {
  if (id === KOMMENTAR_ID || /^#|kommentar|comment/i.test(name)) return null;
  for (const r of SCHRITT_REGELN) if (id !== null && r.ids.includes(id)) return r.funktion;
  for (const r of SCHRITT_REGELN) if (r.name.test(name)) return r.funktion;
  return null;
}

export function funktionenVonScript(s: FmScript): Funktion[] {
  const f = new Set<Funktion>();
  for (const st of s.schritte) if (st.aktiv) { const k = klassifiziereSchritt(st.id, st.name); if (k) f.add(k); }
  return [...f];
}

// ------------------------------------------------------------ Zuordnung zu ERP-Modulen

export type ErpModul = 'Projekte/PM' | 'Finanzen' | 'CRM' | 'Bildung' | 'Personal/Ressourcen' | 'Stammdaten' | 'System';

export type ModulRegel = { modul: ErpModul; muster: RegExp; zielTabelle?: string };

/**
 * Reihenfolge = Prioritaet (erste passende Regel gewinnt). Muster greifen auf normalisierte Namen (a-z0-9_);
 * kurze Woerter nur mit Wortgrenze (^|_)…(_|$), sonst trifft z. B. "vat" auch "Raumreser-vat-ion".
 */
export const MODUL_REGELN: ModulRegel[] = [
  // (v)esr: Debitoren und Zahlungseingang der bbz-Loesung
  { modul: 'Finanzen', muster: /zahlung|debitor|op_?liste|offene_?posten|(^|_)v?esr(_|$)/, zielTabelle: 'zahlungseingang' },
  { modul: 'Finanzen', muster: /position|rechnungszeile|fakturazeile|(^|_)pos_fak/, zielTabelle: 'rechnungsposition' },
  { modul: 'Finanzen', muster: /rechnung|faktur|invoice|(^|_)qr(_|$)/, zielTabelle: 'rechnung' },
  { modul: 'Stammdaten', muster: /mwst|mehrwertsteuer|steuersatz|(^|_)vat(_|$)/, zielTabelle: 'mwst_satz' },
  { modul: 'Stammdaten', muster: /konto|konti|kontenplan|kontierung/, zielTabelle: 'konto' },
  { modul: 'Bildung', muster: /anmeldung|registration|buchung|belegung/, zielTabelle: 'anmeldung' },
  { modul: 'Bildung', muster: /teilnehm|participant/, zielTabelle: 'anmeldung' },
  { modul: 'Bildung', muster: /kurstag|seminartag|termin/, zielTabelle: 'kurstag' },
  { modul: 'Bildung', muster: /kurs_?typ|kursangebot/, zielTabelle: 'kursangebot' },
  { modul: 'Bildung', muster: /durchf|seminar|kurs|lehrgang|modul|ausbildung/, zielTabelle: 'durchfuehrung' },
  { modul: 'Bildung', muster: /zertifi|saq|pruefung|lernstunde/, zielTabelle: 'zertifizierung' },
  { modul: 'Personal/Ressourcen', muster: /referent|trainer|dozent|coach/, zielTabelle: 'referent' },
  // Projektschritte (Datum, Referent, Ort, abgerechnet) und Wochenplan sind Einsaetze
  { modul: 'Personal/Ressourcen', muster: /wochenplan|einsatz|(^|_)schritte(_|$)/, zielTabelle: 'einsatz' },
  { modul: 'Personal/Ressourcen', muster: /mitarbeit|personal|benutzer|(^|_)users?(_|$)|login|kuerzel/, zielTabelle: 'mitarbeitende' },
  { modul: 'Projekte/PM', muster: /zeit|rapport|stunden|aufwand|leistung/, zielTabelle: 'zeiterfassung' },
  { modul: 'Projekte/PM', muster: /aufgabe|task|pendenz|todo/, zielTabelle: 'aufgabe' },
  { modul: 'Finanzen', muster: /auftraggeber|debitor|kunde|(^|_)bank(en)?(_|$)/, zielTabelle: 'auftraggeber' },
  { modul: 'Projekte/PM', muster: /projekt|project|auftrag/, zielTabelle: 'projekt' },
  { modul: 'CRM', muster: /adress|firma|firmen|organisation|filiale|niederlass/, zielTabelle: 'organisation' },
  { modul: 'CRM', muster: /kontakt|person|ansprech|kommunik/, zielTabelle: 'kontakt' },
  { modul: 'CRM', muster: /aktivit|history|historie|notiz|besuch|telefon|korresp|(^|_)story(_|$)/, zielTabelle: 'aktivitaet' },
  { modul: 'CRM', muster: /serienbrief|mailing|newsletter|brief|vermerk|adr_?typ/ },
  { modul: 'Stammdaten', muster: /(^|_)plz(_|$)|postleitzahl/ },
  { modul: 'System', muster: /global|einstellung|setting|preference|(^|_)menue?(_|$)|navigation|dashboard|(^|_)start(_|$)|hilfe|(^|_)log(_|$)|logbuch|zaehler|counter|(^|_)temp(_|$)|(^|_)standards?(_|$)/ },
];

/** Kleinbuchstaben, Umlaute ausgeschrieben, nur [a-z0-9_]. */
export function normalisiere(name: string): string {
  return name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function ordneZu(name: string, regeln: ModulRegel[] = MODUL_REGELN): ModulRegel | null {
  const n = normalisiere(name);
  return regeln.find((r) => r.muster.test(n)) ?? null;
}

// ------------------------------------------------------------ ERP-Schema aus den Migrationen

/** Liest Tabellen und Spalten aus den SQL-Migrationen (create table + alter table add column). */
export function liesErpSchema(sqlDateien: string[]): Map<string, string[]> {
  const schema = new Map<string, string[]>();
  const add = (t: string, c: string) => { const l = schema.get(t) ?? []; if (!l.includes(c)) l.push(c); schema.set(t, l); };
  for (const roh of sqlDateien) {
    const sql = roh.replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/create table\s+(?:if not exists\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const tabelle = m[1].toLowerCase();
      schema.set(tabelle, schema.get(tabelle) ?? []);
      for (const zeile of m[2].split('\n')) {
        const c = zeile.trim().match(/^([a-z_][a-z0-9_]*)\s+(uuid|text|integer|int|bigint|bigserial|serial|numeric|boolean|date|time|timestamptz|timestamp|jsonb|json)\b/i);
        if (c && !/^(primary|unique|check|constraint|foreign)$/i.test(c[1])) add(tabelle, c[1].toLowerCase());
      }
    }
    for (const m of sql.matchAll(/alter table\s+(\w+)([\s\S]*?);/gi)) {
      for (const c of m[2].matchAll(/add column\s+([a-z_][a-z0-9_]*)/gi)) add(m[1].toLowerCase(), c[1].toLowerCase());
    }
  }
  return schema;
}

// ------------------------------------------------------------ Feld-Mapping-Entwurf

/** Synonyme FileMaker-Feldname -> ERP-Spalte (normalisiert). Erweiterbar, wenn der echte DDR vorliegt. */
const SYNONYME: Record<string, string[]> = {
  nummer: ['nr', 'nummer', 'projektnr', 'projektnummer', 'rechnungsnr', 'rgnr', 'kundennr', 'auftraggebernr', 'debitorennr'],
  name: ['name', 'bezeichnung', 'titel', 'firma', 'firmenname', 'projektname', 'auftraggeber'],
  nachname: ['nachname', 'name', 'familienname'],
  vorname: ['vorname'],
  strasse: ['strasse', 'adresse', 'str', 'adresse1'],
  plz: ['plz', 'postleitzahl', 'zip'],
  ort: ['ort', 'stadt', 'city', 'kursort', 'durchfuehrungsort'],
  email: ['email', 'e_mail', 'mail', 'emailadresse'],
  telefon: ['telefon', 'tel', 'telefonnummer', 'direktwahl'],
  datum: ['datum', 'rechnungsdatum', 'rgdatum', 'zahldatum'],
  betrag: ['betrag', 'summe', 'total', 'zahlbetrag'],
  budget_chf: ['budget', 'budgetchf', 'budget_fr', 'budgetbetrag'],
  budget_tage: ['budgettage', 'tage'],
  stammnummer: ['stammnummer', 'stammnr', 'projektstamm'],
  jahr: ['jahr', 'year'],
  bereich: ['bereich', 'geschaeftsfeld', 'sparte'],
  kuerzel: ['kuerzel', 'kurzzeichen', 'visum', 'initialen'],
  beschreibung: ['beschreibung', 'text', 'leistung', 'positionstext'],
  menge: ['menge', 'anzahl', 'stunden', 'tage'],
  einzelpreis: ['einzelpreis', 'preis', 'ansatz', 'tagesansatz'],
  mwst_satz: ['mwst', 'mwstsatz', 'mwst_satz', 'steuersatz'],
  start_datum: ['start', 'beginn', 'von', 'startdatum', 'datumvon'],
  end_datum: ['ende', 'bis', 'enddatum', 'datumbis'],
  kapazitaet: ['kapazitaet', 'maxteilnehmer', 'plaetze', 'max_tn'],
};

export type FeldVorschlag = { fmFeld: string; erpSpalte: string | null; sicherheit: 'exakt' | 'synonym' | 'keine' };

export function schlageFeldMappingVor(tabelle: FmTabelle, erpSpalten: string[]): FeldVorschlag[] {
  return tabelle.felder.filter((f) => f.art === 'Normal' && !f.global).map((f) => {
    const n = normalisiere(f.name);
    if (erpSpalten.includes(n)) return { fmFeld: f.name, erpSpalte: n, sicherheit: 'exakt' as const };
    const kompakt = n.replace(/_/g, '');
    for (const [spalte, syn] of Object.entries(SYNONYME)) {
      if (erpSpalten.includes(spalte) && syn.some((s) => s.replace(/_/g, '') === kompakt)) {
        return { fmFeld: f.name, erpSpalte: spalte, sicherheit: 'synonym' as const };
      }
    }
    return { fmFeld: f.name, erpSpalte: null, sicherheit: 'keine' as const };
  });
}

// ------------------------------------------------------------ Gesamtanalyse

export type TabellenAnalyse = {
  datei: string; tabelle: string; datensaetze: number | null; felder: number; berechnet: number; statistik: number;
  modul: ErpModul | null; zielTabelle: string | null; zielExistiert: boolean; feldMapping: FeldVorschlag[];
};

export type Analyse = {
  kennzahlen: { dateien: number; tabellen: number; felder: number; berechneteFelder: number; tabellenvorkommen: number;
    beziehungen: number; layouts: number; scripts: number; scriptSchritte: number; wertelisten: number;
    eigeneFunktionen: number; konten: number; datensaetze: number };
  tabellen: TabellenAnalyse[];
  funktionen: { funktion: Funktion; scripts: string[] }[];
  scriptsJeModul: { modul: ErpModul | 'nicht zugeordnet'; scripts: string[] }[];
  hotspots: { script: string; datei: string; schritte: number }[];
  luecken: string[];
};

/** Welche FileMaker-Funktionsklassen deckt das ERP ab (und womit)? */
export const ERP_ABDECKUNG: Record<Funktion, string | null> = {
  Import: 'tools/fm-import (Migration), Homepage-Anmelde-API statt Excel-Intake',
  Export: 'CSV-Exporte (Teilnehmerliste, Newsletter), REST-API',
  PDF: 'Rechnungs-PDF mit QR-Zahlteil (src/pdf)',
  Druck: 'PDF/Browser-Druck (Teilnehmerliste, Rechnung)',
  'E-Mail': 'Mail-Outbox (Auftraege mit Retry); Versandadapter zu konfigurieren',
  'Web/URL': 'REST-API, Webhooks, Moodle-Connector',
  Server: 'Outbox-Worker / Cron-Jobs',
  Datenpflege: 'Fachmodule (CRUD + Regeln serverseitig)',
  Suche: 'Listen-Filter der API/PWA',
  Navigation: 'PWA-Navigation',
  Dialog: 'PWA-Dialoge/Validierungsmeldungen',
  Dateien: null,
  'Externe Programme': null,
  Konten: 'Entra ID (Konten und Rollen zentral, keine Konten in der Anwendung)',
  Telefonie: 'tel:-Links in der PWA (web/js/ui.js, sichereUrl)',
};

export function analysiere(inv: FmInventar, erpSchema: Map<string, string[]>): Analyse {
  const tabellen: TabellenAnalyse[] = [];
  const funktionMap = new Map<Funktion, Set<string>>();
  const scriptsJeModul = new Map<string, Set<string>>();
  const hotspots: Analyse['hotspots'] = [];
  const luecken: string[] = [];
  const k = { dateien: inv.dateien.length, tabellen: 0, felder: 0, berechneteFelder: 0, tabellenvorkommen: 0, beziehungen: 0,
    layouts: 0, scripts: 0, scriptSchritte: 0, wertelisten: 0, eigeneFunktionen: 0, konten: 0, datensaetze: 0 };

  for (const d of inv.dateien) {
    k.tabellen += d.tabellen.length; k.tabellenvorkommen += d.tabellenvorkommen.length; k.beziehungen += d.beziehungen.length;
    k.layouts += d.layouts.length; k.scripts += d.scripts.length; k.wertelisten += d.wertelisten.length;
    k.eigeneFunktionen += d.eigeneFunktionen.length; k.konten += d.konten.length;
    for (const t of d.tabellen) {
      k.felder += t.felder.length; k.datensaetze += t.datensaetze ?? 0;
      const berechnet = t.felder.filter((f) => f.art === 'Calculated').length;
      k.berechneteFelder += berechnet;
      const regel = ordneZu(t.name);
      const ziel = regel?.zielTabelle ?? null;
      tabellen.push({
        datei: d.name, tabelle: t.name, datensaetze: t.datensaetze, felder: t.felder.length, berechnet,
        statistik: t.felder.filter((f) => f.art === 'Summary').length, modul: regel?.modul ?? null, zielTabelle: ziel,
        zielExistiert: ziel ? erpSchema.has(ziel) : false,
        feldMapping: ziel && erpSchema.has(ziel) ? schlageFeldMappingVor(t, erpSchema.get(ziel)!) : [],
      });
      if (!regel) luecken.push(`Tabelle ${d.name}::${t.name} (${t.datensaetze ?? '?'} Datensaetze) ist keinem ERP-Modul zugeordnet`);
      else if (ziel && !erpSchema.has(ziel)) luecken.push(`Tabelle ${d.name}::${t.name} -> Zieltabelle ${ziel} fehlt im ERP-Schema`);
    }
    for (const s of d.scripts) {
      k.scriptSchritte += s.schritte.length;
      hotspots.push({ script: s.name, datei: d.name, schritte: s.schritte.length });
      for (const f of funktionenVonScript(s)) {
        const set = funktionMap.get(f) ?? new Set(); set.add(`${d.name}: ${s.name}`); funktionMap.set(f, set);
        if (!ERP_ABDECKUNG[f]) luecken.push(`Script "${s.name}" nutzt Funktion "${f}" ohne ERP-Entsprechung`);
      }
      const modul = ordneZu([...s.ordner, s.name].join(' '))?.modul ?? 'nicht zugeordnet';
      const set = scriptsJeModul.get(modul) ?? new Set(); set.add(`${d.name}: ${s.name}`); scriptsJeModul.set(modul, set);
    }
  }
  hotspots.sort((a, b) => b.schritte - a.schritte);
  return {
    kennzahlen: k,
    tabellen,
    funktionen: [...funktionMap.entries()].map(([funktion, s]) => ({ funktion, scripts: [...s].sort() }))
      .sort((a, b) => b.scripts.length - a.scripts.length),
    scriptsJeModul: [...scriptsJeModul.entries()].map(([modul, s]) => ({ modul: modul as ErpModul, scripts: [...s].sort() }))
      .sort((a, b) => b.scripts.length - a.scripts.length),
    hotspots: hotspots.slice(0, 15),
    luecken: [...new Set(luecken)],
  };
}

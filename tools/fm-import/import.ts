import type pg from 'pg';
import { csvObjekte, zahl, datum } from './csv';
import { createAuftraggeber } from '../../src/repos/auftraggeberRepo';
import { createOrganisation } from '../../src/repos/organisationRepo';
import { findOrCreateKontaktByEmail, createKontakt } from '../../src/repos/kontaktRepo';
import { findeOrganisationPerName } from '../../src/repos/zuordnungRepo';
import { rappenRunden } from '../../src/domain/mwst';

/*
 * Datenmigration aus FileMaker (Plan 5, Spec v2 §8). Quelle: Exporte im Format "Seriendruck (.mer)" bzw. CSV
 * mit Kopfzeile. Zuordnung FileMaker-Feld -> ERP-Feld ueber eine Mapping-Datei (Vorlage: mapping.beispiel.json,
 * Vorschlag aus `npm run fm:analyse` -> mapping-entwurf.json).
 *
 * Ablauf in EINER Transaktion: Mitarbeitende -> Auftraggeber (+ CRM-Organisation) -> Projekte -> Kontakte ->
 * Rechnungen (Anfangsbestand inkl. Zahlungen) -> Zaehlerstand. Ein Probelauf fuehrt alles aus (alle Regeln und
 * DB-Constraints greifen) und rollt am Ende zurueck. Idempotent: bestehende Datensaetze (Nummer/Kuerzel/E-Mail)
 * werden erkannt und nicht doppelt angelegt.
 */

export type Tabelle = 'mitarbeitende' | 'auftraggeber' | 'projekte' | 'kontakte' | 'rechnungen';
export type TabellenMapping = { datei: string; felder: Record<string, string>; werte?: Record<string, Record<string, string>> };
export type Mapping = Partial<Record<Tabelle, TabellenMapping>>;
export type Quellen = Partial<Record<Tabelle, string>>;   // Dateiinhalt je Tabelle

export type Bericht = {
  probelauf: boolean;
  zaehler: Record<Tabelle, { gelesen: number; neu: number; vorhanden: number; fehler: number }>;
  fehler: { tabelle: Tabelle; zeile: number; schluessel: string | null; fehler: string }[];
  hinweise: string[];
  summen: {
    projekteJeJahr: { jahr: number; anzahl: number; budgetChf: number }[];
    rechnungen: { anzahl: number; bruttoChf: number; bezahltChf: number; offenChf: number };
    offenJeAuftraggeber: { nummer: string | null; name: string; offenChf: number }[];
  };
  zaehlerstandRechnung: number | null;
};

const TABELLEN: Tabelle[] = ['mitarbeitende', 'auftraggeber', 'projekte', 'kontakte', 'rechnungen'];
const leer = () => ({ gelesen: 0, neu: 0, vorhanden: 0, fehler: 0 });

class Zeilenfehler extends Error {}

/** Liest ein ERP-Feld aus einer FM-Zeile ueber das Mapping (Spaltenname case-insensitiv). */
function leser(m: TabellenMapping, zeile: Record<string, string>) {
  const index = new Map(Object.entries(zeile).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return (feld: string): string | null => {
    const spalte = m.felder[feld];
    if (!spalte) return null;
    const v = index.get(spalte.trim().toLowerCase());
    return v === undefined || v.trim() === '' ? null : v.trim();
  };
}

const pflicht = (v: string | null, feld: string): string => { if (!v) throw new Zeilenfehler(`${feld} fehlt`); return v; };
const zahlOderFehler = (v: string | null, feld: string): number | null => {
  const n = zahl(v ?? undefined);
  if (n !== null && Number.isNaN(n)) throw new Zeilenfehler(`${feld} keine Zahl: ${v}`);
  return n;
};
const datumOderFehler = (v: string | null, feld: string): string | null => {
  const d = datum(v ?? undefined);
  if (d === 'ungueltig') throw new Zeilenfehler(`${feld} kein Datum: ${v}`);
  return d;
};

/** "6231.26" -> {6231, 2026}; Jahr zweistellig = 20xx. */
export function projektnummer(nr: string): { stammnummer: number; jahr: number } | null {
  const m = /^(\d{3,5})\.(\d{2}|\d{4})$/.exec(nr.trim());
  if (!m) return null;
  return { stammnummer: Number(m[1]), jahr: m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]) };
}

export async function importiere(pool: pg.Pool, quellen: Quellen, mapping: Mapping, opts: { probelauf?: boolean; zaehlerStart?: number } = {}): Promise<Bericht> {
  const probelauf = opts.probelauf ?? true;
  const bericht: Bericht = {
    probelauf, zaehler: Object.fromEntries(TABELLEN.map((t) => [t, leer()])) as Bericht['zaehler'], fehler: [], hinweise: [],
    summen: { projekteJeJahr: [], rechnungen: { anzahl: 0, bruttoChf: 0, bezahltChf: 0, offenChf: 0 }, offenJeAuftraggeber: [] },
    zaehlerstandRechnung: null,
  };
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const t of TABELLEN) {
      const m = mapping[t]; const inhalt = quellen[t];
      if (!m || inhalt === undefined) continue;
      const zeilen = csvObjekte(inhalt);
      for (const [i, roh] of zeilen.entries()) {
        bericht.zaehler[t].gelesen++;
        const f = leser(m, roh);
        const wert = (feld: string) => { const v = f(feld); return v && m.werte?.[feld]?.[v] !== undefined ? m.werte[feld][v] : v; };
        // Savepoint je Zeile: ein Fehler verwirft nur diese Zeile, nicht den ganzen Import
        await c.query('savepoint zeile');
        try {
          const ergebnis = await ZEILE[t](c, wert, bericht);
          bericht.zaehler[t][ergebnis]++;
          await c.query('release savepoint zeile');
        } catch (e) {
          await c.query('rollback to savepoint zeile');
          bericht.zaehler[t].fehler++;
          bericht.fehler.push({ tabelle: t, zeile: i + 2, schluessel: f('nummer') ?? f('email') ?? f('kuerzel'), fehler: (e as Error).message });
        }
      }
    }
    await zaehlerSetzen(c, bericht, opts.zaehlerStart);
    await summenBilden(c, bericht);
    await c.query(probelauf ? 'rollback' : 'commit');
    return bericht;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

type Leser = (feld: string) => string | null;

const ZEILE: Record<Tabelle, (c: pg.PoolClient, f: Leser, b: Bericht) => Promise<'neu' | 'vorhanden'>> = {
  async mitarbeitende(c, f) {
    const kuerzel = pflicht(f('kuerzel'), 'kuerzel').toLowerCase();
    if ((await c.query('select 1 from mitarbeitende where kuerzel=$1', [kuerzel])).rowCount) return 'vorhanden';
    await c.query(`insert into mitarbeitende(kuerzel,vorname,nachname,email,rolle) values ($1,$2,$3,$4,coalesce($5,'standard'))`,
      [kuerzel, f('vorname'), pflicht(f('nachname'), 'nachname'), f('email')?.toLowerCase() ?? null, f('rolle') === 'admin' ? 'admin' : null]);
    return 'neu';
  },

  async auftraggeber(c, f, b) {
    const nummer = pflicht(f('nummer'), 'nummer'); const name = pflicht(f('name'), 'name');
    if ((await c.query('select 1 from auftraggeber where nummer=$1', [nummer])).rowCount) return 'vorhanden';
    const adresse = { strasse: f('strasse'), plz: f('plz'), ort: f('ort'), land: f('land') ?? 'CH' };
    const org = (await findeOrganisationPerName(c, name))
      ?? (await createOrganisation(c, { name, ...adresse, email: f('email'), telefon: f('telefon'), kategorie: 'kunde' })).id;
    if (!adresse.strasse || !adresse.plz || !adresse.ort) {
      // QR-Rechnung verlangt die vollstaendige Debitor-Adresse (Spec v1 §4.1): nur CRM-Organisation uebernehmen
      b.hinweise.push(`Auftraggeber ${nummer} (${name}): Adresse unvollstaendig – nur als CRM-Organisation uebernommen, Debitor fehlt`);
      return 'neu';
    }
    const ag = await createAuftraggeber(c, { nummer, name, strasse: adresse.strasse, plz: adresse.plz, ort: adresse.ort, land: adresse.land, email: f('email'), telefon: f('telefon'), ansprechperson: f('ansprechperson') });
    await c.query('update auftraggeber set organisation_id=$2 where id=$1 and not exists (select 1 from auftraggeber where organisation_id=$2)', [ag.id, org]);
    return 'neu';
  },

  async projekte(c, f, b) {
    const nr = f('nummer');
    const teile = nr ? projektnummer(nr) : null;
    const stammnummer = teile?.stammnummer ?? zahlOderFehler(f('stammnummer'), 'stammnummer');
    const jahr = teile?.jahr ?? zahlOderFehler(f('jahr'), 'jahr');
    if (!stammnummer || !jahr) throw new Zeilenfehler(`Projektnummer unlesbar: ${nr ?? '–'}`);
    if ((await c.query('select 1 from projekt where stammnummer=$1 and jahr=$2', [stammnummer, jahr])).rowCount) return 'vorhanden';
    const agNr = pflicht(f('auftraggeberNummer'), 'auftraggeberNummer');
    const ag = await c.query('select id from auftraggeber where nummer=$1', [agNr]);
    if (!ag.rowCount) throw new Zeilenfehler(`Auftraggeber ${agNr} nicht vorhanden`);
    let kontoId: string | null = null;
    if (f('kontoNummer')) {
      const k = await c.query('select id from konto where nummer=$1', [f('kontoNummer')]);
      if (!k.rowCount) b.hinweise.push(`Konto ${f('kontoNummer')} fehlt im Kontenplan (Projekt ${stammnummer}.${String(jahr).slice(-2)} ohne Kontierung)`);
      else kontoId = k.rows[0].id;
    }
    const status = f('status') ?? 'laufend';
    await c.query(
      `insert into projekt(nummer,stammnummer,jahr,name,bereich,auftraggeber_id,ertragskonto_id,budget_chf,budget_tage,status,beschrieb)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [`${stammnummer}.${String(jahr).slice(-2)}`, stammnummer, jahr, pflicht(f('name'), 'name'), f('bereich'), ag.rows[0].id, kontoId,
       zahlOderFehler(f('budgetChf'), 'budgetChf'), zahlOderFehler(f('budgetTage'), 'budgetTage'), status, f('beschrieb')]);
    return 'neu';
  },

  async kontakte(c, f) {
    const nachname = pflicht(f('nachname'), 'nachname');
    const firma = f('organisation');
    let organisationId = firma ? await findeOrganisationPerName(c, firma) : null;
    if (firma && !organisationId) organisationId = (await createOrganisation(c, { name: firma, kategorie: 'interessent' })).id;
    const anrede = f('anrede'); const email = f('email')?.toLowerCase() ?? null;
    const daten = {
      nachname, vorname: f('vorname'), anrede: anrede === 'Frau' || anrede === 'Herr' ? anrede : null, funktion: f('funktion'),
      telefon: f('telefon'), mobile: f('mobile'), organisationId, bemerkung: f('bemerkung'),
    } as const;
    if (email) return (await findOrCreateKontaktByEmail(c, { ...daten, email })).neu ? 'neu' : 'vorhanden';
    const dup = await c.query(
      `select 1 from kontakt where lower(nachname)=lower($1) and lower(coalesce(vorname,''))=lower(coalesce($2,'')) and organisation_id is not distinct from $3`,
      [nachname, daten.vorname, organisationId]);
    if (dup.rowCount) return 'vorhanden';
    await createKontakt(c, daten);
    return 'neu';
  },

  async rechnungen(c, f) {
    const lfdNr = zahlOderFehler(pflicht(f('lfdNr'), 'lfdNr'), 'lfdNr')!;
    if ((await c.query('select 1 from rechnung where lfd_nr=$1', [lfdNr])).rowCount) return 'vorhanden';
    const pnr = pflicht(f('projektNummer'), 'projektNummer');
    const teile = projektnummer(pnr);
    if (!teile) throw new Zeilenfehler(`Projektnummer unlesbar: ${pnr}`);
    const p = await c.query('select id, auftraggeber_id, nummer from projekt where stammnummer=$1 and jahr=$2', [teile.stammnummer, teile.jahr]);
    if (!p.rowCount) throw new Zeilenfehler(`Projekt ${pnr} nicht vorhanden`);
    const brutto = zahlOderFehler(pflicht(f('totalBrutto'), 'totalBrutto'), 'totalBrutto')!;
    const netto = zahlOderFehler(f('totalNetto'), 'totalNetto') ?? brutto;
    const bezahlt = zahlOderFehler(f('bezahlt'), 'bezahlt') ?? 0;
    const dat = pflicht(datumOderFehler(f('datum'), 'datum'), 'datum');
    const status = bezahlt >= brutto - 0.004 ? 'bezahlt' : 'abgerechnet';
    const nummer = f('nummer') ?? `${p.rows[0].nummer} - ${lfdNr}`;
    const r = await c.query(
      `insert into rechnung(projekt_id,auftraggeber_id,datum,betreff,lfd_nr,nummer,status,total_netto,total_mwst,total_brutto,festgeschrieben_am)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$3::date) returning id`,
      [p.rows[0].id, p.rows[0].auftraggeber_id, dat, f('betreff') ?? 'Uebernahme aus FileMaker', lfdNr, nummer, status, netto, rappenRunden(brutto - netto), brutto]);
    if (bezahlt > 0) {
      await c.query(`insert into zahlungseingang(rechnung_id,datum,betrag,bemerkung,erfasst_durch) values ($1,$2,$3,'Uebernahme aus FileMaker','migration')`,
        [r.rows[0].id, datumOderFehler(f('bezahltAm'), 'bezahltAm') ?? dat, Math.min(bezahlt, brutto)]);
    }
    return 'neu';
  },
};

async function zaehlerSetzen(c: pg.PoolClient, b: Bericht, start?: number): Promise<void> {
  const max = Number((await c.query('select coalesce(max(lfd_nr),0) as m from rechnung')).rows[0].m);
  const ziel = Math.max(max, start !== undefined ? start - 1 : 0);
  // Zaehler = zuletzt vergebene Nummer; naechste Festschreibung erhaelt ziel+1 (lueckenlos ab FileMaker-Stand)
  await c.query(`update zaehler set wert=greatest(wert,$1) where name='rechnung_lfd_nr'`, [ziel]);
  b.zaehlerstandRechnung = Number((await c.query(`select wert from zaehler where name='rechnung_lfd_nr'`)).rows[0].wert);
}

async function summenBilden(c: pg.PoolClient, b: Bericht): Promise<void> {
  b.summen.projekteJeJahr = (await c.query(
    `select jahr, count(*)::int as anzahl, coalesce(sum(budget_chf),0)::numeric as budget from projekt group by jahr order by jahr`))
    .rows.map((r: any) => ({ jahr: r.jahr, anzahl: r.anzahl, budgetChf: Number(r.budget) }));
  const re = (await c.query(
    `select count(*)::int as n, coalesce(sum(r.total_brutto),0)::numeric as brutto, coalesce(sum(z.s),0)::numeric as bezahlt
     from rechnung r left join (select rechnung_id, sum(betrag) as s from zahlungseingang group by rechnung_id) z on z.rechnung_id=r.id
     where r.status in ('abgerechnet','bezahlt')`)).rows[0];
  b.summen.rechnungen = { anzahl: re.n, bruttoChf: Number(re.brutto), bezahltChf: Number(re.bezahlt), offenChf: rappenRunden(Number(re.brutto) - Number(re.bezahlt)) };
  b.summen.offenJeAuftraggeber = (await c.query(
    `select a.nummer, a.name, sum(r.total_brutto - coalesce(z.s,0))::numeric as offen
     from rechnung r join auftraggeber a on a.id=r.auftraggeber_id
     left join (select rechnung_id, sum(betrag) as s from zahlungseingang group by rechnung_id) z on z.rechnung_id=r.id
     where r.status='abgerechnet' group by a.nummer, a.name having sum(r.total_brutto - coalesce(z.s,0)) > 0 order by offen desc`))
    .rows.map((r: any) => ({ nummer: r.nummer, name: r.name, offenChf: Number(r.offen) }));
}

export function berichtMarkdown(b: Bericht): string {
  const z: string[] = [`# FileMaker-Import ${b.probelauf ? '(PROBELAUF – nichts gespeichert)' : '(ausgefuehrt)'}`, ''];
  z.push('| Tabelle | gelesen | neu | vorhanden | Fehler |', '|---|---|---|---|---|');
  for (const [t, x] of Object.entries(b.zaehler)) if (x.gelesen) z.push(`| ${t} | ${x.gelesen} | ${x.neu} | ${x.vorhanden} | ${x.fehler} |`);
  z.push('', `Zaehlerstand Rechnungsnummer: **${b.zaehlerstandRechnung}** (naechste Rechnung: ${(b.zaehlerstandRechnung ?? 0) + 1})`, '');
  z.push('## Summen zum Abgleich mit FileMaker', '', '| Jahr | Projekte | Budget CHF |', '|---|---|---|');
  for (const p of b.summen.projekteJeJahr) z.push(`| ${p.jahr} | ${p.anzahl} | ${p.budgetChf.toFixed(2)} |`);
  const r = b.summen.rechnungen;
  z.push('', `Rechnungen: ${r.anzahl} · brutto ${r.bruttoChf.toFixed(2)} · bezahlt ${r.bezahltChf.toFixed(2)} · **offen ${r.offenChf.toFixed(2)}**`, '');
  if (b.summen.offenJeAuftraggeber.length) {
    z.push('| Debitor | offen CHF |', '|---|---|');
    for (const o of b.summen.offenJeAuftraggeber) z.push(`| ${o.nummer ?? ''} ${o.name} | ${o.offenChf.toFixed(2)} |`);
    z.push('');
  }
  if (b.hinweise.length) z.push('## Hinweise', '', ...[...new Set(b.hinweise)].map((h) => `- ${h}`), '');
  if (b.fehler.length) {
    z.push('## Fehler (Zeilen wurden nicht uebernommen)', '', '| Tabelle | Zeile | Schluessel | Fehler |', '|---|---|---|---|');
    for (const f of b.fehler) z.push(`| ${f.tabelle} | ${f.zeile} | ${f.schluessel ?? ''} | ${f.fehler.replace(/\|/g, '/')} |`);
  }
  return z.join('\n');
}

// Lesende PM-Auswertungen: Cockpit, Portfolio, Kanban, Gantt, Ressourcen-Auslastung (Spec v2 §5.3).
import type { Projekt } from '../domain/types';
import type { Auslastung, Cockpit, Gantt, GanttItem, GanttTyp, Kanban, PortfolioEintrag } from '../domain/pmTypes';
import { KANBAN_SPALTEN, pruefeDatum, pruefeZeitraum } from '../domain/pmTypes';
import { berechneCockpit, heuteIso, tageZwischen, type CockpitRoh } from '../domain/cockpit';
import { BELEGENDE_STATUS } from '../domain/einsatz';
import { ValidationError } from '../domain/errors';
import type { Db } from './db';
import { getProjektById, listProjekte, type ProjektFilter } from './projektRepo';
import { listPhasen } from './phaseRepo';
import { listMeilensteine } from './meilensteinRepo';
import { mapAufgabe } from './aufgabeRepo';

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Rohsummen je Projekt (eine Abfrage je Quelle, gruppiert) fuer Cockpit und Portfolio. */
async function ladeRohdaten(db: Db, projekte: Projekt[]): Promise<Map<string, CockpitRoh>> {
  const roh = new Map<string, CockpitRoh>(projekte.map((p) => [p.id, {
    projektId: p.id, budgetChf: p.budgetChf, budgetStunden: p.budgetStunden, aufwandBudgetChf: p.aufwandBudgetChf,
    abgerechnetChf: 0, leistungenChf: 0, unverrechnetChf: 0, stundenIst: 0, stundenVerrechenbar: 0,
    internKostenChf: 0, honorareChf: 0, aufgaben: { total: 0, erledigt: 0 }, meilensteine: [],
  }]));
  if (!projekte.length) return roh;
  const ids = projekte.map((p) => p.id);
  const [rech, zeit, eins, aufg, ms] = await Promise.all([
    db.query(
      `select projekt_id, sum(total_netto) as s from rechnung
       where projekt_id = any($1) and status in ('abgerechnet','bezahlt') group by projekt_id`, [ids]),
    db.query(
      `select z.projekt_id,
         sum(z.stunden) as stunden_ist,
         sum(z.stunden) filter (where z.verrechenbar) as stunden_verrechenbar,
         sum(z.stunden * coalesce(z.ansatz_chf, 0)) filter (where z.verrechenbar) as leistungen,
         sum(z.stunden * coalesce(z.ansatz_chf, 0)) filter (where z.verrechenbar and z.rechnungsposition_id is null) as unverrechnet,
         sum(z.stunden * coalesce(m.stundensatz_intern, 0)) as intern
       from zeiterfassung z join mitarbeitende m on m.id = z.mitarbeitende_id
       where z.projekt_id = any($1) group by z.projekt_id`, [ids]),
    db.query(
      `select projekt_id, sum(coalesce(honorar_chf, 0)) as s from einsatz
       where projekt_id = any($1) and status <> 'abgesagt' group by projekt_id`, [ids]),
    db.query(
      `select projekt_id, count(*) filter (where status <> 'abgebrochen')::int as total,
         count(*) filter (where status = 'erledigt')::int as erledigt
       from aufgabe where projekt_id = any($1) group by projekt_id`, [ids]),
    db.query('select projekt_id, titel, faellig_am, erreicht_am from meilenstein where projekt_id = any($1) order by faellig_am', [ids]),
  ]);
  for (const r of rech.rows) roh.get(r.projekt_id)!.abgerechnetChf = n(r.s);
  for (const r of zeit.rows) {
    Object.assign(roh.get(r.projekt_id)!, {
      stundenIst: n(r.stunden_ist), stundenVerrechenbar: n(r.stunden_verrechenbar), leistungenChf: n(r.leistungen),
      unverrechnetChf: n(r.unverrechnet), internKostenChf: n(r.intern),
    });
  }
  for (const r of eins.rows) roh.get(r.projekt_id)!.honorareChf = n(r.s);
  for (const r of aufg.rows) roh.get(r.projekt_id)!.aufgaben = { total: r.total, erledigt: r.erledigt };
  for (const r of ms.rows) roh.get(r.projekt_id)!.meilensteine.push({ titel: r.titel, faelligAm: r.faellig_am, erreichtAm: r.erreicht_am });
  return roh;
}

/** Projekt-Cockpit; `heute` (YYYY-MM-DD) bestimmt die Meilenstein-Ueberfaelligkeit. */
export async function getCockpit(db: Db, projektId: string, heute: string = heuteIso()): Promise<Cockpit> {
  pruefeDatum('heute', heute, true);
  const p = await getProjektById(db, projektId);
  return berechneCockpit((await ladeRohdaten(db, [p])).get(p.id)!, heute);
}

/** Portfolio: Cockpit-Kennzahlen je Projekt (Filter wie GET /projekt). */
export async function getPortfolio(db: Db, filter: ProjektFilter = {}, heute: string = heuteIso()): Promise<PortfolioEintrag[]> {
  pruefeDatum('heute', heute, true);
  const projekte = await listProjekte(db, filter);
  const roh = await ladeRohdaten(db, projekte);
  return projekte.map((p) => ({
    ...berechneCockpit(roh.get(p.id)!, heute),
    nummer: p.nummer, name: p.name, jahr: p.jahr, status: p.status,
    auftraggeberId: p.auftraggeberId, projektleitungId: p.projektleitungId,
  }));
}

/** Kanban-Board: Spalten offen/in_arbeit/review/erledigt, je nach sortierung (abgebrochene ausgeblendet). */
export async function getKanban(db: Db, projektId: string): Promise<Kanban> {
  await getProjektById(db, projektId);
  const r = await db.query(
    `select * from aufgabe where projekt_id=$1 and status = any($2) order by sortierung, erstellt_am, id`,
    [projektId, KANBAN_SPALTEN]);
  const aufgaben = r.rows.map(mapAufgabe);
  return { projektId, spalten: KANBAN_SPALTEN.map((status) => ({ status, aufgaben: aufgaben.filter((a) => a.status === status) })) };
}

const TYP_RANG: Record<GanttTyp, number> = { phase: 0, aufgabe: 1, meilenstein: 2, einsatz: 3 };

/**
 * Gantt-Zeitachse: Phasen, Aufgaben (Start = startDatum oder faelligAm; alle Status, damit Vorgaengerbezuege
 * aufloesbar bleiben; ungeplante mit start/ende null am Ende), Meilensteine (Status offen/ueberfaellig/erreicht)
 * und nicht abgesagte Einsaetze. Sortiert nach Start, dann Typ. start/ende = Gesamtspanne inkl. Projekttermine.
 */
export async function getGantt(db: Db, projektId: string, heute: string = heuteIso()): Promise<Gantt> {
  pruefeDatum('heute', heute, true);
  const p = await getProjektById(db, projektId);
  const [phasen, ms, aufg, eins] = await Promise.all([
    listPhasen(db, projektId),
    listMeilensteine(db, projektId),
    db.query('select * from aufgabe where projekt_id=$1 order by sortierung, erstellt_am', [projektId]),
    db.query(
      `select e.id, e.datum, e.rolle, e.status, r.anzeigename from einsatz e join referent r on r.id = e.referent_id
       where e.projekt_id=$1 and e.status <> 'abgesagt' order by e.datum`, [projektId]),
  ]);
  const items: GanttItem[] = [
    ...phasen.map((x): GanttItem => ({ typ: 'phase', id: x.id, titel: x.name, start: x.startDatum, ende: x.endDatum, status: x.status })),
    ...aufg.rows.map(mapAufgabe).map((a): GanttItem => ({
      typ: 'aufgabe', id: a.id, titel: a.titel, start: a.startDatum ?? a.faelligAm, ende: a.faelligAm ?? a.startDatum,
      status: a.status, vorgaengerId: a.vorgaengerId, phaseId: a.phaseId,
    })),
    ...ms.map((m): GanttItem => ({
      typ: 'meilenstein', id: m.id, titel: m.titel, start: m.faelligAm, ende: m.faelligAm, phaseId: m.phaseId,
      status: m.erreichtAm ? 'erreicht' : m.faelligAm < heute ? 'ueberfaellig' : 'offen',
    })),
    ...eins.rows.map((e: any): GanttItem => ({
      typ: 'einsatz', id: e.id, titel: `${e.anzeigename} (${e.rolle})`, start: e.datum, ende: e.datum, status: e.status,
    })),
  ];
  items.sort((a, b) => (a.start === b.start ? 0 : a.start === null ? 1 : b.start === null ? -1 : a.start < b.start ? -1 : 1)
    || TYP_RANG[a.typ] - TYP_RANG[b.typ] || a.titel.localeCompare(b.titel, 'de'));
  const starts = [p.startDatum, ...items.map((i) => i.start)].filter((x): x is string => !!x);
  const enden = [p.endDatum, ...items.map((i) => i.ende)].filter((x): x is string => !!x);
  return {
    projektId,
    start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
    ende: enden.length ? enden.reduce((a, b) => (a > b ? a : b)) : null,
    items,
  };
}

export const AUSLASTUNG_MAX_TAGE = 366;

/**
 * Ressourcen-Auslastung: je Referent:in verplante Tage pro Datum (belegende Status, ohne Absagen) im Zeitraum.
 * Enthalten sind alle aktiven Referent:innen sowie inaktive mit Einsaetzen im Zeitraum; `tage` ist duenn besetzt.
 */
export async function getAuslastung(db: Db, q: { von: string; bis: string; referentId?: string }): Promise<Auslastung[]> {
  pruefeDatum('von', q.von, true);
  pruefeDatum('bis', q.bis, true);
  pruefeZeitraum(q.von, q.bis);
  if (tageZwischen(q.von, q.bis) > AUSLASTUNG_MAX_TAGE) throw new ValidationError(`Zeitraum maximal ${AUSLASTUNG_MAX_TAGE} Tage`);
  const r = await db.query(
    `select r.id, r.anzeigename, r.aktiv, e.datum, sum(e.dauer_tage) as tage
     from referent r
     left join einsatz e on e.referent_id = r.id and e.datum between $1 and $2 and e.status = any($3)
     where ($4::uuid is null or r.id = $4)
     group by r.id, r.anzeigename, r.aktiv, e.datum
     order by r.anzeigename, r.id, e.datum`,
    [q.von, q.bis, [...BELEGENDE_STATUS], q.referentId ?? null]);
  type Zeile = Auslastung & { aktiv: boolean };
  const out = new Map<string, Zeile>();
  for (const row of r.rows) {
    const a: Zeile = out.get(row.id) ?? { referentId: row.id, anzeigename: row.anzeigename, aktiv: row.aktiv, tage: [], summeTage: 0 };
    if (row.datum) {
      const t = Number(row.tage);
      a.tage.push({ datum: row.datum, verplantTage: t });
      a.summeTage = Math.round((a.summeTage + t) * 100) / 100;
    }
    out.set(row.id, a);
  }
  return [...out.values()]
    .filter((a) => a.aktiv || a.tage.length > 0)
    .map(({ aktiv: _aktiv, ...a }) => a);
}

import type pg from 'pg';
import type { Projekt } from '../domain/types';
import type { Verkaufschance, Phase, Pipeline } from '../domain/crmTypes';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import {
  PHASEN, OFFENE_PHASEN, istOffen, defaultWahrscheinlichkeit, pruefeWahrscheinlichkeit, phasenwechsel, aggregierePipeline,
  optText, pflichtText, optWert, optBetrag, optDatum,
} from '../domain/crm';
import { createProjekt } from './projektRepo';
import { findAuftraggeberFuerOrganisation } from './organisationRepo';
import { audit } from './auditRepo';
import { type Db, inTransaktion, patchSets, num } from './db';

export const mapVerkaufschance = (r: any): Verkaufschance => ({
  id: r.id, titel: r.titel, organisationId: r.organisation_id, kontaktId: r.kontakt_id, bereich: r.bereich, phase: r.phase,
  wertChf: num(r.wert_chf), wahrscheinlichkeit: r.wahrscheinlichkeit, erwarteterAbschluss: r.erwarteter_abschluss,
  verantwortlichId: r.verantwortlich_id, quelle: r.quelle, verlustgrund: r.verlustgrund, projektId: r.projekt_id,
  abgeschlossenAm: r.abgeschlossen_am,
});

export type VerkaufschanceInput = {
  titel: string; organisationId: string; kontaktId?: string | null; bereich?: string | null; phase?: Phase;
  wertChf?: number | null; wahrscheinlichkeit?: number | null; erwarteterAbschluss?: string | null;
  verantwortlichId?: string | null; quelle?: string | null;
};

/** PATCH-Felder; Phase/Verlustgrund/Projekt/Abschluss werden nur ueber die Fachaktionen gesetzt. */
const COLS: Record<string, string> = {
  titel: 'titel', organisationId: 'organisation_id', kontaktId: 'kontakt_id', bereich: 'bereich', wertChf: 'wert_chf',
  wahrscheinlichkeit: 'wahrscheinlichkeit', erwarteterAbschluss: 'erwarteter_abschluss', verantwortlichId: 'verantwortlich_id',
  quelle: 'quelle',
};

function normalisiere(input: Record<string, unknown>): Record<string, unknown> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const out: Record<string, unknown> = {};
  if (has('titel')) out.titel = pflichtText(input.titel, 'titel', 300);
  if (has('organisationId')) out.organisationId = pflichtText(input.organisationId, 'organisationId', 100);
  for (const f of ['kontaktId', 'verantwortlichId', 'bereich', 'quelle'] as const) {
    if (has(f)) out[f] = optText(input[f], f, 200);
  }
  if (has('wertChf')) out.wertChf = optBetrag(input.wertChf, 'wertChf');
  if (has('wahrscheinlichkeit')) out.wahrscheinlichkeit = input.wahrscheinlichkeit === null ? null : pruefeWahrscheinlichkeit(input.wahrscheinlichkeit);
  if (has('erwarteterAbschluss')) out.erwarteterAbschluss = optDatum(input.erwarteterAbschluss, 'erwarteterAbschluss');
  return out;
}

export async function createVerkaufschance(db: Db, input: VerkaufschanceInput): Promise<Verkaufschance> {
  const i = (input ?? {}) as Record<string, unknown>;
  const n = normalisiere({ ...i, titel: i.titel ?? null, organisationId: i.organisationId ?? null }) as any;
  const phase = optWert(i.phase, 'phase', PHASEN) ?? 'lead';
  if (!istOffen(phase)) throw new ValidationError(`Neue Verkaufschancen starten in einer offenen Phase (${OFFENE_PHASEN.join(', ')})`);
  const r = await db.query(
    `insert into verkaufschance(titel,organisation_id,kontakt_id,bereich,phase,wert_chf,wahrscheinlichkeit,erwarteter_abschluss,verantwortlich_id,quelle)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [n.titel, n.organisationId, n.kontaktId ?? null, n.bereich ?? null, phase, n.wertChf ?? null,
     n.wahrscheinlichkeit ?? defaultWahrscheinlichkeit(phase), n.erwarteterAbschluss ?? null, n.verantwortlichId ?? null, n.quelle ?? null]);
  return mapVerkaufschance(r.rows[0]);
}

export async function getVerkaufschance(db: Db, id: string, opts: { sperren?: boolean } = {}): Promise<Verkaufschance> {
  const r = await db.query(`select * from verkaufschance where id=$1 ${opts.sperren ? 'for update' : ''}`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Verkaufschance ${id} nicht gefunden`);
  return mapVerkaufschance(r.rows[0]);
}

export async function updateVerkaufschance(db: Db, id: string, patch: Partial<Omit<VerkaufschanceInput, 'phase'>>): Promise<Verkaufschance> {
  const p = (patch ?? {}) as Record<string, unknown>;
  for (const f of ['phase', 'verlustgrund', 'projektId', 'abgeschlossenAm']) {
    if (f in p) throw new ValidationError(`${f} ist nicht per PATCH aenderbar (phase: POST /verkaufschance/:id/phase, projekt: POST /verkaufschance/:id/projekt)`);
  }
  const args: unknown[] = [id];
  const sets = patchSets(normalisiere(p), COLS, args);
  if (!sets.length) return getVerkaufschance(db, id);
  sets.push('geaendert_am=now()');
  const r = await db.query(`update verkaufschance set ${sets.join(',')} where id=$1 returning *`, args);
  if (!r.rowCount) throw new NotFoundError(`Verkaufschance ${id} nicht gefunden`);
  return mapVerkaufschance(r.rows[0]);
}

export type VerkaufschanceFilter = {
  /** Eine Phase, kommagetrennte Liste oder 'offen' (alle offenen Phasen). */
  phase?: string; verantwortlichId?: string; organisationId?: string; kontaktId?: string;
};

function phasenAusFilter(phase?: string): Phase[] | null {
  if (!phase?.trim()) return null;
  if (phase.trim() === 'offen') return [...OFFENE_PHASEN];
  return phase.split(',').map((p) => optWert(p.trim(), 'phase', PHASEN)!);
}

export async function listVerkaufschancen(db: Db, filter: VerkaufschanceFilter = {}): Promise<(Verkaufschance & { organisationName: string })[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace(/\?/g, `$${args.length}`)); };
  const phasen = phasenAusFilter(filter.phase);
  if (phasen) add('v.phase = any(?)', phasen);
  if (filter.verantwortlichId) add('v.verantwortlich_id=?', filter.verantwortlichId);
  if (filter.organisationId) add('v.organisation_id=?', filter.organisationId);
  if (filter.kontaktId) add('v.kontakt_id=?', filter.kontaktId);
  const r = await db.query(
    `select v.*, o.name as organisation_name from verkaufschance v join organisation o on o.id = v.organisation_id
     ${cond.length ? 'where ' + cond.join(' and ') : ''}
     order by v.erwarteter_abschluss asc nulls last, v.erstellt_am desc`, args);
  return r.rows.map((x: any) => ({ ...mapVerkaufschance(x), organisationName: x.organisation_name }));
}

/**
 * Phasenwechsel (Regeln in domain/crm.ts#phasenwechsel), transaktional mit Zeilensperre.
 * gewonnen/verloren/Wiedereroeffnung werden revisionssicher protokolliert.
 */
export async function setzePhase(pool: pg.Pool, id: string, input: {
  phase: unknown; verlustgrund?: string | null; wahrscheinlichkeit?: number | null; wiedereroeffnen?: boolean;
  heute: string; benutzer?: string | null;
}): Promise<Verkaufschance> {
  return inTransaktion(pool, async (c) => {
    const alt = await getVerkaufschance(c, id, { sperren: true });
    const neu = phasenwechsel(alt.phase, input.phase, {
      heute: input.heute, verlustgrund: input.verlustgrund, wahrscheinlichkeit: input.wahrscheinlichkeit, wiedereroeffnen: input.wiedereroeffnen,
    });
    const r = await c.query(
      `update verkaufschance set phase=$2, wahrscheinlichkeit=$3, abgeschlossen_am=$4, verlustgrund=$5, geaendert_am=now()
       where id=$1 returning *`, [id, neu.phase, neu.wahrscheinlichkeit, neu.abgeschlossenAm, neu.verlustgrund]);
    const aktion = !istOffen(neu.phase) ? `verkaufschance.${neu.phase}` : !istOffen(alt.phase) ? 'verkaufschance.wiedereroeffnet' : null;
    if (aktion) {
      await audit(c, {
        benutzer: input.benutzer, aktion, entitaet: 'verkaufschance', entitaetId: id,
        details: { vonPhase: alt.phase, nachPhase: neu.phase, ...(neu.verlustgrund ? { verlustgrund: neu.verlustgrund } : {}) },
      });
    }
    return mapVerkaufschance(r.rows[0]);
  });
}

function pruefeGanzzahl(v: unknown, feld: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ValidationError(`${feld} muss eine ganze Zahl ${min}-${max} sein`);
  return v;
}

/**
 * Gewonnene Verkaufschance -> Projekt beim verknuepften Auftraggeber der Organisation (sonst 400).
 * createProjekt laeuft auf dem Pool (eigene Transaktion); scheitert danach die Verknuepfung, wird das Projekt
 * wieder entfernt (Kompensation), damit kein verwaistes Projekt bleibt.
 */
export async function eroeffneProjekt(pool: pg.Pool, id: string, input: {
  stammnummer: number; jahr: number; ertragskontoId?: string | null; name?: string | null; heute: string; benutzer?: string | null;
}): Promise<{ verkaufschance: Verkaufschance; projekt: Projekt }> {
  const vc = await getVerkaufschance(pool, id);
  const pruefeStatus = (v: Verkaufschance) => {
    if (v.projektId) throw new ConflictError('Verkaufschance ist bereits mit einem Projekt verknuepft');
    if (v.phase === 'verloren') throw new ConflictError('Verkaufschance ist verloren; zuerst wiedereroeffnen');
  };
  pruefeStatus(vc);
  const stammnummer = pruefeGanzzahl(input.stammnummer, 'stammnummer', 1, 9999);
  const jahr = pruefeGanzzahl(input.jahr, 'jahr', 2000, 2100);
  const auftraggeber = await findAuftraggeberFuerOrganisation(pool, vc.organisationId);
  if (!auftraggeber) {
    throw new ValidationError('Organisation hat keinen verknuepften Auftraggeber (Debitor); zuerst POST /organisation/:id/auftraggeber');
  }
  const projekt = await createProjekt(pool, {
    stammnummer, jahr, name: optText(input.name, 'name', 200) ?? vc.titel, auftraggeberId: auftraggeber.id,
    ertragskontoId: optText(input.ertragskontoId, 'ertragskontoId') ?? null, bereich: vc.bereich,
  });
  try {
    const verkaufschance = await inTransaktion(pool, async (c) => {
      const alt = await getVerkaufschance(c, id, { sperren: true });
      pruefeStatus(alt);
      const r = await c.query(
        `update verkaufschance set phase='gewonnen', wahrscheinlichkeit=100, projekt_id=$2, verlustgrund=null,
           abgeschlossen_am=coalesce(abgeschlossen_am,$3::date), geaendert_am=now() where id=$1 returning *`,
        [id, projekt.id, input.heute]);
      await audit(c, {
        benutzer: input.benutzer, aktion: alt.phase === 'gewonnen' ? 'verkaufschance.projekt_eroeffnet' : 'verkaufschance.gewonnen',
        entitaet: 'verkaufschance', entitaetId: id, details: { vonPhase: alt.phase, projektId: projekt.id, projektNummer: projekt.nummer },
      });
      return mapVerkaufschance(r.rows[0]);
    });
    return { verkaufschance, projekt };
  } catch (e) {
    await pool.query('delete from projekt where id=$1', [projekt.id]);
    throw e;
  }
}

/** Pipeline je Phase + Forecast je Monat (Aggregation in domain/crm.ts). */
export async function ladePipeline(db: Db, filter: { verantwortlichId?: string } = {}): Promise<Pipeline> {
  const args: unknown[] = [];
  let where = '';
  if (filter.verantwortlichId) { args.push(filter.verantwortlichId); where = 'where verantwortlich_id=$1'; }
  const r = await db.query(`select phase, wert_chf, wahrscheinlichkeit, erwarteter_abschluss from verkaufschance ${where}`, args);
  return aggregierePipeline(r.rows.map((x: any) => ({
    phase: x.phase, wertChf: num(x.wert_chf), wahrscheinlichkeit: x.wahrscheinlichkeit, erwarteterAbschluss: x.erwarteter_abschluss,
  })));
}

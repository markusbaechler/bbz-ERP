import type pg from 'pg';
import type { Projekt } from '../domain/types';
import type { ProjektStatus } from '../domain/pmTypes';
import { pruefeStatusWechsel } from '../domain/projektStatus';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, inTransaktion, patchSets, num } from './db';
import { audit } from './auditRepo';

const map = (r: any): Projekt => ({
  id: r.id, nummer: r.nummer, stammnummer: r.stammnummer, jahr: r.jahr,
  kuerzel: r.kuerzel, name: r.name, bereich: r.bereich,
  auftraggeberId: r.auftraggeber_id, ertragskontoId: r.ertragskonto_id,
  budgetChf: num(r.budget_chf),
  budgetTage: num(r.budget_tage),
  mwstModus: r.mwst_modus, fortsetzungVonId: r.fortsetzung_von_id,
  status: r.status, projektleitungId: r.projektleitung_id, ansprechpersonKontaktId: r.ansprechperson_kontakt_id,
  startDatum: r.start_datum, endDatum: r.end_datum, beschrieb: r.beschrieb,
  budgetStunden: num(r.budget_stunden), aufwandBudgetChf: num(r.aufwand_budget_chf), aufwandkontoId: r.aufwandkonto_id,
});

export type ProjektInput = {
  stammnummer: number; jahr: number; name: string; auftraggeberId: string;
  ertragskontoId?: string | null; kuerzel?: string | null; bereich?: string | null;
  budgetChf?: number | null; budgetTage?: number | null; mwstModus?: 'exkl' | 'inkl'; fortsetzungVonId?: string | null;
  status?: ProjektStatus; projektleitungId?: string | null; ansprechpersonKontaktId?: string | null;
  startDatum?: string | null; endDatum?: string | null; beschrieb?: string | null;
  budgetStunden?: number | null; aufwandBudgetChf?: number | null; aufwandkontoId?: string | null;
};

/** Per PATCH aenderbare Felder (Identitaet stammnummer/jahr/nummer und Status sind ausgenommen). */
export type ProjektPatch = Partial<Omit<ProjektInput, 'stammnummer' | 'jahr' | 'status' | 'fortsetzungVonId'>>;

const PATCH_COLS: Record<string, string> = {
  name: 'name', kuerzel: 'kuerzel', bereich: 'bereich', auftraggeberId: 'auftraggeber_id',
  ertragskontoId: 'ertragskonto_id', aufwandkontoId: 'aufwandkonto_id', mwstModus: 'mwst_modus',
  budgetChf: 'budget_chf', budgetTage: 'budget_tage', budgetStunden: 'budget_stunden', aufwandBudgetChf: 'aufwand_budget_chf',
  projektleitungId: 'projektleitung_id', ansprechpersonKontaktId: 'ansprechperson_kontakt_id',
  startDatum: 'start_datum', endDatum: 'end_datum', beschrieb: 'beschrieb',
};

/** Check-Constraint-Verletzungen als fachliche Validierungsfehler melden. */
function alsValidierung(e: unknown): never {
  const pg = e as { code?: string; constraint?: string };
  if (pg?.code === '23514') {
    throw new ValidationError(pg.constraint === 'projekt_zeitraum_chk'
      ? 'Zeitraum ungueltig: endDatum liegt vor startDatum' : `Ungueltiger Wert (${pg.constraint ?? 'check'})`);
  }
  throw e;
}

export async function createProjekt(db: Db, input: ProjektInput): Promise<Projekt> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.stammnummer}.${String(input.jahr).slice(-2)}`;
  try {
    const r = await db.query(
      `insert into projekt(nummer,stammnummer,jahr,name,auftraggeber_id,ertragskonto_id,kuerzel,bereich,budget_chf,budget_tage,
         mwst_modus,fortsetzung_von_id,status,projektleitung_id,ansprechperson_kontakt_id,start_datum,end_datum,beschrieb,
         budget_stunden,aufwand_budget_chf,aufwandkonto_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'exkl'),$12,coalesce($13,'laufend'),$14,$15,$16,$17,$18,$19,$20,$21)
       returning *`,
      [nummer, input.stammnummer, input.jahr, input.name, input.auftraggeberId,
       input.ertragskontoId ?? null, input.kuerzel ?? null, input.bereich ?? null,
       input.budgetChf ?? null, input.budgetTage ?? null, input.mwstModus ?? null, input.fortsetzungVonId ?? null,
       input.status ?? null, input.projektleitungId ?? null, input.ansprechpersonKontaktId ?? null,
       input.startDatum ?? null, input.endDatum ?? null, input.beschrieb ?? null,
       input.budgetStunden ?? null, input.aufwandBudgetChf ?? null, input.aufwandkontoId ?? null]);
    return map(r.rows[0]);
  } catch (e) { return alsValidierung(e); }
}

export async function getProjektById(db: Db, id: string): Promise<Projekt> {
  const r = await db.query('select * from projekt where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function updateProjekt(db: Db, id: string, patch: ProjektPatch): Promise<Projekt> {
  if ('status' in patch) throw new ValidationError('status nur ueber POST /projekt/:id/status aenderbar');
  if ('name' in patch && !patch.name?.trim()) throw new ValidationError('name ist Pflicht');
  if ('auftraggeberId' in patch && !patch.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const args: unknown[] = [id];
  const sets = patchSets(patch as Record<string, unknown>, PATCH_COLS, args);
  if (!sets.length) return getProjektById(db, id);
  try {
    const r = await db.query(`update projekt set ${sets.join(',')}, geaendert_am=now() where id=$1 returning *`, args);
    if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
    return map(r.rows[0]);
  } catch (e) { return alsValidierung(e); }
}

export type ProjektFilter = {
  jahr?: number; auftraggeberId?: string; status?: ProjektStatus | ProjektStatus[]; projektleitungId?: string;
};

export async function listProjekte(db: Db, filter: ProjektFilter = {}): Promise<Projekt[]> {
  const cond: string[] = []; const args: any[] = [];
  if (filter.jahr !== undefined) { args.push(filter.jahr); cond.push(`jahr=$${args.length}`); }
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); cond.push(`auftraggeber_id=$${args.length}`); }
  if (filter.status !== undefined) {
    const status = Array.isArray(filter.status) ? filter.status : [filter.status];
    args.push(status); cond.push(`status = any($${args.length})`);
  }
  if (filter.projektleitungId) { args.push(filter.projektleitungId); cond.push(`projektleitung_id=$${args.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  const r = await db.query(`select * from projekt ${where} order by nummer`, args);
  return r.rows.map(map);
}

export async function getJahresverlauf(db: Db, stammnummer: number): Promise<Projekt[]> {
  const r = await db.query('select * from projekt where stammnummer=$1 order by jahr asc', [stammnummer]);
  return r.rows.map(map);
}

/**
 * Jahresfortfuehrung (Spec v2 §5.3): neues Projekt mit gleicher Stammnummer im Jahr `jahr`.
 * Uebernimmt Name, Auftraggeber, Kontierung (Ertrag/Aufwand/MWSt-Modus), Bereich, Kuerzel, Leitung und Ansprechperson.
 * Budgets und Termine gelten pro Jahr und werden nicht uebernommen. Der Jahresverlauf ergibt sich ueber die
 * Stammnummer; fortsetzung_von_id bleibt gemaess Spec v1 Sonderfaellen vorbehalten.
 */
export async function fortsetzeProjekt(db: Db, id: string, jahr: number): Promise<Projekt> {
  if (!Number.isInteger(jahr) || jahr < 1900 || jahr > 2999) throw new ValidationError('jahr muss 4-stellig sein');
  const alt = await getProjektById(db, id);
  const dup = await db.query('select nummer from projekt where stammnummer=$1 and jahr=$2', [alt.stammnummer, jahr]);
  if (dup.rowCount) throw new ConflictError(`Projekt ${dup.rows[0].nummer} existiert bereits`);
  try {
    return await createProjekt(db, {
      stammnummer: alt.stammnummer, jahr, name: alt.name, auftraggeberId: alt.auftraggeberId,
      ertragskontoId: alt.ertragskontoId, aufwandkontoId: alt.aufwandkontoId, mwstModus: alt.mwstModus,
      bereich: alt.bereich, kuerzel: alt.kuerzel, projektleitungId: alt.projektleitungId,
      ansprechpersonKontaktId: alt.ansprechpersonKontaktId,
    });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw new ConflictError(`Projekt ${alt.stammnummer}.${String(jahr).slice(-2)} existiert bereits`);
    throw e;
  }
}

/**
 * Statuswechsel (Spec §5.3) transaktional mit Zeilensperre und Audit-Log. Abschluss ist blockiert (409), solange
 * verrechenbare, unverrechnete Zeiteintraege existieren; `force` uebersteuert (Admin-Pruefung beim Aufrufer).
 */
export async function setProjektStatus(pool: pg.Pool, id: string, nach: ProjektStatus,
  opts: { force?: boolean; benutzer?: string | null } = {}): Promise<Projekt> {
  return inTransaktion(pool, async (c) => {
    const r = await c.query('select status from projekt where id=$1 for update', [id]);
    if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
    const von: ProjektStatus = r.rows[0].status;
    const z = await c.query(
      'select count(*)::int as n from zeiterfassung where projekt_id=$1 and verrechenbar and rechnungsposition_id is null', [id]);
    const unverrechneteEintraege: number = z.rows[0].n;
    const { forciert } = pruefeStatusWechsel({ von, nach, unverrechneteEintraege, force: opts.force === true });
    const u = await c.query('update projekt set status=$2, geaendert_am=now() where id=$1 returning *', [id, nach]);
    await audit(c, {
      benutzer: opts.benutzer, aktion: 'status', entitaet: 'projekt', entitaetId: id,
      details: { von, nach, forciert, unverrechneteEintraege },
    });
    return map(u.rows[0]);
  });
}

import type pg from 'pg';
import type { Projekt } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Projekt => ({
  id: r.id, nummer: r.nummer, stammnummer: r.stammnummer, jahr: r.jahr,
  kuerzel: r.kuerzel, name: r.name, bereich: r.bereich,
  auftraggeberId: r.auftraggeber_id, ertragskontoId: r.ertragskonto_id,
  budgetChf: r.budget_chf === null ? null : Number(r.budget_chf),
  budgetTage: r.budget_tage === null ? null : Number(r.budget_tage),
  mwstModus: r.mwst_modus, fortsetzungVonId: r.fortsetzung_von_id,
});

export async function createProjekt(pool: pg.Pool, input: {
  stammnummer: number; jahr: number; name: string; auftraggeberId: string;
  ertragskontoId?: string | null; kuerzel?: string | null; bereich?: string | null;
  budgetChf?: number | null; budgetTage?: number | null; mwstModus?: 'exkl' | 'inkl'; fortsetzungVonId?: string | null;
}): Promise<Projekt> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (!input.auftraggeberId) throw new ValidationError('auftraggeberId ist Pflicht');
  const nummer = `${input.stammnummer}.${String(input.jahr).slice(-2)}`;
  const r = await pool.query(
    `insert into projekt(nummer,stammnummer,jahr,name,auftraggeber_id,ertragskonto_id,kuerzel,bereich,budget_chf,budget_tage,mwst_modus,fortsetzung_von_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'exkl'),$12) returning *`,
    [nummer, input.stammnummer, input.jahr, input.name, input.auftraggeberId,
     input.ertragskontoId ?? null, input.kuerzel ?? null, input.bereich ?? null,
     input.budgetChf ?? null, input.budgetTage ?? null, input.mwstModus ?? null, input.fortsetzungVonId ?? null]);
  return map(r.rows[0]);
}

export async function getProjektById(pool: pg.Pool, id: string): Promise<Projekt> {
  const r = await pool.query('select * from projekt where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Projekt ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listProjekte(pool: pg.Pool, filter: { jahr?: number; auftraggeberId?: string } = {}): Promise<Projekt[]> {
  const cond: string[] = []; const args: any[] = [];
  if (filter.jahr !== undefined) { args.push(filter.jahr); cond.push(`jahr=$${args.length}`); }
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); cond.push(`auftraggeber_id=$${args.length}`); }
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  const r = await pool.query(`select * from projekt ${where} order by nummer`, args);
  return r.rows.map(map);
}

export async function getJahresverlauf(pool: pg.Pool, stammnummer: number): Promise<Projekt[]> {
  const r = await pool.query('select * from projekt where stammnummer=$1 order by jahr asc', [stammnummer]);
  return r.rows.map(map);
}

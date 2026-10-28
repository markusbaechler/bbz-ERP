import type { Meilenstein } from '../domain/pmTypes';
import { pruefeDatum } from '../domain/pmTypes';
import { ValidationError, NotFoundError } from '../domain/errors';
import { type Db, patchSets } from './db';
import { getProjektById } from './projektRepo';
import { pruefePhaseImProjekt } from './phaseRepo';

const map = (r: any): Meilenstein => ({
  id: r.id, projektId: r.projekt_id, phaseId: r.phase_id, titel: r.titel,
  faelligAm: r.faellig_am, erreichtAm: r.erreicht_am, beschreibung: r.beschreibung,
});

export type MeilensteinInput = { titel: string; faelligAm: string; phaseId?: string | null; beschreibung?: string | null };
export type MeilensteinPatch = Partial<MeilensteinInput> & { erreichtAm?: string | null };

function pruefe(input: MeilensteinPatch, neu: boolean): void {
  if ((neu || 'titel' in input) && !input.titel?.trim()) throw new ValidationError('titel ist Pflicht');
  if (neu || 'faelligAm' in input) pruefeDatum('faelligAm', input.faelligAm, true);
  pruefeDatum('erreichtAm', input.erreichtAm);
}

export async function createMeilenstein(db: Db, projektId: string, input: MeilensteinInput): Promise<Meilenstein> {
  pruefe(input, true);
  await getProjektById(db, projektId);
  await pruefePhaseImProjekt(db, input.phaseId, projektId);
  const r = await db.query(
    `insert into meilenstein(projekt_id,phase_id,titel,faellig_am,beschreibung) values ($1,$2,$3,$4,$5) returning *`,
    [projektId, input.phaseId ?? null, input.titel.trim(), input.faelligAm, input.beschreibung ?? null]);
  return map(r.rows[0]);
}

export async function getMeilenstein(db: Db, id: string): Promise<Meilenstein> {
  const r = await db.query('select * from meilenstein where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Meilenstein ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listMeilensteine(db: Db, projektId: string): Promise<Meilenstein[]> {
  const r = await db.query('select * from meilenstein where projekt_id=$1 order by faellig_am, titel', [projektId]);
  return r.rows.map(map);
}

export async function updateMeilenstein(db: Db, id: string, patch: MeilensteinPatch): Promise<Meilenstein> {
  pruefe(patch, false);
  const alt = await getMeilenstein(db, id);
  if ('phaseId' in patch) await pruefePhaseImProjekt(db, patch.phaseId, alt.projektId);
  const args: unknown[] = [id];
  const p = { ...patch, ...(patch.titel !== undefined ? { titel: patch.titel.trim() } : {}) };
  const sets = patchSets(p, { titel: 'titel', faelligAm: 'faellig_am', phaseId: 'phase_id', beschreibung: 'beschreibung', erreichtAm: 'erreicht_am' }, args);
  if (!sets.length) return alt;
  const r = await db.query(`update meilenstein set ${sets.join(',')} where id=$1 returning *`, args);
  return map(r.rows[0]);
}

/** Markiert den Meilenstein als erreicht (Datum Pflicht; der Aufrufer setzt bei Bedarf "heute"). */
export async function setMeilensteinErreicht(db: Db, id: string, datum: string): Promise<Meilenstein> {
  pruefeDatum('datum', datum, true);
  const r = await db.query('update meilenstein set erreicht_am=$2 where id=$1 returning *', [id, datum]);
  if (!r.rowCount) throw new NotFoundError(`Meilenstein ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function deleteMeilenstein(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from meilenstein where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Meilenstein ${id} nicht gefunden`);
}

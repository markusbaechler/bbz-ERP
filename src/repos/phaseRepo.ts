import type { Phase, PhaseStatus } from '../domain/pmTypes';
import { PHASE_STATUS, pruefeDatum, pruefeZeitraum } from '../domain/pmTypes';
import { ValidationError, NotFoundError } from '../domain/errors';
import { type Db, patchSets } from './db';
import { getProjektById } from './projektRepo';

const map = (r: any): Phase => ({
  id: r.id, projektId: r.projekt_id, name: r.name, reihenfolge: r.reihenfolge,
  startDatum: r.start_datum, endDatum: r.end_datum, status: r.status,
});

export type PhaseInput = {
  name: string; reihenfolge?: number; startDatum?: string | null; endDatum?: string | null; status?: PhaseStatus;
};

function pruefe(input: Partial<PhaseInput>): void {
  if ('name' in input && !input.name?.trim()) throw new ValidationError('name ist Pflicht');
  if (input.status !== undefined && !PHASE_STATUS.includes(input.status)) throw new ValidationError(`status muss ${PHASE_STATUS.join('|')} sein`);
  if (input.reihenfolge !== undefined && !Number.isInteger(input.reihenfolge)) throw new ValidationError('reihenfolge muss ganzzahlig sein');
  pruefeDatum('startDatum', input.startDatum);
  pruefeDatum('endDatum', input.endDatum);
}

export async function createPhase(db: Db, projektId: string, input: PhaseInput): Promise<Phase> {
  pruefe({ ...input, name: input.name ?? '' });
  pruefeZeitraum(input.startDatum, input.endDatum, 'Phasenzeitraum');
  await getProjektById(db, projektId);
  const r = await db.query(
    `insert into projekt_phase(projekt_id,name,reihenfolge,start_datum,end_datum,status)
     values ($1,$2,coalesce($3,(select coalesce(max(reihenfolge),0)+1 from projekt_phase where projekt_id=$1)),$4,$5,coalesce($6,'geplant'))
     returning *`,
    [projektId, input.name.trim(), input.reihenfolge ?? null, input.startDatum ?? null, input.endDatum ?? null, input.status ?? null]);
  return map(r.rows[0]);
}

export async function getPhase(db: Db, id: string): Promise<Phase> {
  const r = await db.query('select * from projekt_phase where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Phase ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listPhasen(db: Db, projektId: string): Promise<Phase[]> {
  const r = await db.query(
    'select * from projekt_phase where projekt_id=$1 order by reihenfolge, start_datum nulls last, name', [projektId]);
  return r.rows.map(map);
}

export async function updatePhase(db: Db, id: string, patch: Partial<PhaseInput>): Promise<Phase> {
  pruefe(patch);
  const alt = await getPhase(db, id);
  pruefeZeitraum('startDatum' in patch ? patch.startDatum : alt.startDatum, 'endDatum' in patch ? patch.endDatum : alt.endDatum, 'Phasenzeitraum');
  const args: unknown[] = [id];
  const p = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) };
  const sets = patchSets(p, { name: 'name', reihenfolge: 'reihenfolge', startDatum: 'start_datum', endDatum: 'end_datum', status: 'status' }, args);
  if (!sets.length) return alt;
  const r = await db.query(`update projekt_phase set ${sets.join(',')} where id=$1 returning *`, args);
  return map(r.rows[0]);
}

/** Loescht eine Phase; Meilensteine und Aufgaben behalten sich selbst, verlieren aber den Phasenbezug (FK set null). */
export async function deletePhase(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from projekt_phase where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Phase ${id} nicht gefunden`);
}

/** Phase muss existieren und zum Projekt gehoeren (fuer Meilensteine/Aufgaben). */
export async function pruefePhaseImProjekt(db: Db, phaseId: string | null | undefined, projektId: string | null | undefined): Promise<void> {
  if (!phaseId) return;
  if (!projektId) throw new ValidationError('phaseId setzt ein Projekt voraus');
  const r = await db.query('select projekt_id from projekt_phase where id=$1', [phaseId]);
  if (!r.rowCount || r.rows[0].projekt_id !== projektId) throw new ValidationError('Phase gehoert nicht zum Projekt');
}

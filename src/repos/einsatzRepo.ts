import type { Einsatz, EinsatzStatus } from '../domain/types';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { istUeberbucht, BELEGENDE_STATUS } from '../domain/einsatz';
import { type Db, num } from './db';

const map = (r: any): Einsatz => ({
  id: r.id, referentId: r.referent_id, projektId: r.projekt_id, kurstagId: r.kurstag_id, datum: r.datum,
  dauerTage: Number(r.dauer_tage), rolle: r.rolle, honorarChf: num(r.honorar_chf), status: r.status, bemerkung: r.bemerkung,
});

export type EinsatzInput = {
  referentId: string; projektId: string; datum: string; kurstagId?: string | null; dauerTage?: number;
  rolle?: string; honorarChf?: number | null; status?: EinsatzStatus; bemerkung?: string | null;
  /** Bewusste Ueberbuchung zulassen (z. B. Abendanlass nach Kurstag). */
  ueberbuchungErlauben?: boolean;
};

export async function verplanteTage(db: Db, referentId: string, datum: string, ausserEinsatzId?: string): Promise<number> {
  const r = await db.query(
    `select coalesce(sum(dauer_tage),0)::numeric as s from einsatz
     where referent_id=$1 and datum=$2 and status = any($3) and ($4::uuid is null or id <> $4)`,
    [referentId, datum, BELEGENDE_STATUS, ausserEinsatzId ?? null]);
  return Number(r.rows[0].s);
}

export async function createEinsatz(db: Db, input: EinsatzInput): Promise<Einsatz> {
  const dauer = input.dauerTage ?? 1;
  if (!(dauer > 0 && dauer <= 1)) throw new ValidationError('dauerTage muss in (0, 1] liegen');
  const ref = await db.query('select aktiv, tagessatz_chf, halbtagessatz_chf from referent where id=$1', [input.referentId]);
  if (!ref.rowCount) throw new NotFoundError('Referent nicht gefunden');
  if (!ref.rows[0].aktiv) throw new ValidationError('Referent ist inaktiv');
  if (!input.ueberbuchungErlauben && istUeberbucht(await verplanteTage(db, input.referentId, input.datum), dauer)) {
    throw new ConflictError(`Referent ist am ${input.datum} bereits verplant`);
  }
  // Honorar-Default aus Tages-/Halbtagessatz des Referenten
  const satz = dauer <= 0.5 && ref.rows[0].halbtagessatz_chf !== null ? Number(ref.rows[0].halbtagessatz_chf)
    : ref.rows[0].tagessatz_chf !== null ? Number(ref.rows[0].tagessatz_chf) * dauer : null;
  const r = await db.query(
    `insert into einsatz(referent_id,projekt_id,kurstag_id,datum,dauer_tage,rolle,honorar_chf,status,bemerkung)
     values ($1,$2,$3,$4,$5,coalesce($6,'Referent'),$7,coalesce($8,'angefragt'),$9) returning *`,
    [input.referentId, input.projektId, input.kurstagId ?? null, input.datum, dauer, input.rolle ?? null,
     input.honorarChf ?? satz, input.status ?? null, input.bemerkung ?? null]);
  return map(r.rows[0]);
}

export async function getEinsatz(db: Db, id: string): Promise<Einsatz> {
  const r = await db.query('select * from einsatz where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Einsatz ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function setEinsatzStatus(db: Db, id: string, status: EinsatzStatus): Promise<Einsatz> {
  const e = await getEinsatz(db, id);
  if (status !== 'abgesagt' && e.status === 'abgesagt'
      && istUeberbucht(await verplanteTage(db, e.referentId, e.datum, e.id), e.dauerTage)) {
    throw new ConflictError(`Reaktivierung nicht moeglich: Referent ist am ${e.datum} bereits verplant`);
  }
  const r = await db.query('update einsatz set status=$2 where id=$1 returning *', [id, status]);
  return map(r.rows[0]);
}

export async function listEinsaetze(db: Db, filter: { referentId?: string; projektId?: string; kurstagId?: string; von?: string; bis?: string; status?: EinsatzStatus | EinsatzStatus[] } = {}): Promise<Einsatz[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.referentId) add('referent_id=?', filter.referentId);
  if (filter.projektId) add('projekt_id=?', filter.projektId);
  if (filter.kurstagId) add('kurstag_id=?', filter.kurstagId);
  if (filter.von) add('datum>=?', filter.von);
  if (filter.bis) add('datum<=?', filter.bis);
  if (filter.status !== undefined) add('status = any(?)', Array.isArray(filter.status) ? filter.status : [filter.status]);
  const r = await db.query(`select * from einsatz ${cond.length ? 'where ' + cond.join(' and ') : ''} order by datum, referent_id`, args);
  return r.rows.map(map);
}

import type pg from 'pg';
import type { Konto } from '../domain/types';
import { NotFoundError } from '../domain/errors';

const map = (r: any): Konto => ({ id: r.id, nummer: r.nummer, bezeichnung: r.bezeichnung, typ: r.typ, aktiv: r.aktiv });

export async function createKonto(pool: pg.Pool, input: { nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand' }): Promise<Konto> {
  const r = await pool.query(
    'insert into konto(nummer,bezeichnung,typ) values ($1,$2,$3) returning *',
    [input.nummer, input.bezeichnung, input.typ]);
  return map(r.rows[0]);
}

export async function listKonten(pool: pg.Pool): Promise<Konto[]> {
  const r = await pool.query('select * from konto order by nummer');
  return r.rows.map(map);
}

export async function getKontoById(pool: pg.Pool, id: string): Promise<Konto> {
  const r = await pool.query('select * from konto where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Konto ${id} nicht gefunden`);
  return map(r.rows[0]);
}

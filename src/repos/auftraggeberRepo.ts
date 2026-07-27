import type pg from 'pg';
import type { Auftraggeber } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const map = (r: any): Auftraggeber => ({
  id: r.id, nummer: r.nummer, name: r.name, strasse: r.strasse, plz: r.plz, ort: r.ort,
  land: r.land, ansprechperson: r.ansprechperson, email: r.email, telefon: r.telefon, aktiv: r.aktiv,
});

export async function createAuftraggeber(pool: pg.Pool, input: {
  nummer?: string | null; name: string; strasse: string; plz: string; ort: string;
  land?: string; ansprechperson?: string | null; email?: string | null; telefon?: string | null;
}): Promise<Auftraggeber> {
  for (const f of ['name', 'strasse', 'plz', 'ort'] as const) {
    if (!input[f] || !String(input[f]).trim()) throw new ValidationError(`Feld ${f} ist Pflicht`);
  }
  const r = await pool.query(
    `insert into auftraggeber(nummer,name,strasse,plz,ort,land,ansprechperson,email,telefon)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [input.nummer ?? null, input.name, input.strasse, input.plz, input.ort, input.land ?? 'CH',
     input.ansprechperson ?? null, input.email ?? null, input.telefon ?? null]);
  return map(r.rows[0]);
}

export async function getAuftraggeberById(pool: pg.Pool, id: string): Promise<Auftraggeber> {
  const r = await pool.query('select * from auftraggeber where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Auftraggeber ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listAuftraggeber(pool: pg.Pool): Promise<Auftraggeber[]> {
  const r = await pool.query('select * from auftraggeber order by name');
  return r.rows.map(map);
}

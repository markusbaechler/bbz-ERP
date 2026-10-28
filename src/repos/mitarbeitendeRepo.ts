import type pg from 'pg';
import type { Mitarbeitende, Rolle } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

const map = (r: any): Mitarbeitende => ({
  id: r.id, kuerzel: r.kuerzel, vorname: r.vorname, nachname: r.nachname, email: r.email,
  rolle: r.rolle, entraOid: r.entra_oid, stundensatzIntern: num(r.stundensatz_intern),
  stundensatzVerrechnung: num(r.stundensatz_verrechnung), aktiv: r.aktiv,
});

export type MitarbeitendeInput = {
  kuerzel: string; nachname: string; vorname?: string | null; email?: string | null; rolle?: Rolle;
  entraOid?: string | null; stundensatzIntern?: number | null; stundensatzVerrechnung?: number | null;
};

export async function createMitarbeitende(pool: pg.Pool, input: MitarbeitendeInput): Promise<Mitarbeitende> {
  const kuerzel = input.kuerzel?.trim().toLowerCase();
  if (!kuerzel || !/^[a-z]{2,4}$/.test(kuerzel)) throw new ValidationError('kuerzel: 2-4 Buchstaben');
  if (!input.nachname?.trim()) throw new ValidationError('nachname ist Pflicht');
  const r = await pool.query(
    `insert into mitarbeitende(kuerzel,vorname,nachname,email,rolle,entra_oid,stundensatz_intern,stundensatz_verrechnung)
     values ($1,$2,$3,$4,coalesce($5,'standard'),$6,$7,$8) returning *`,
    [kuerzel, input.vorname ?? null, input.nachname.trim(), input.email ?? null, input.rolle ?? null,
     input.entraOid ?? null, input.stundensatzIntern ?? null, input.stundensatzVerrechnung ?? null]);
  return map(r.rows[0]);
}

export async function updateMitarbeitende(pool: pg.Pool, id: string, patch: Partial<MitarbeitendeInput> & { aktiv?: boolean }): Promise<Mitarbeitende> {
  const cols: Record<string, string> = {
    vorname: 'vorname', nachname: 'nachname', email: 'email', rolle: 'rolle', entraOid: 'entra_oid',
    stundensatzIntern: 'stundensatz_intern', stundensatzVerrechnung: 'stundensatz_verrechnung', aktiv: 'aktiv',
  };
  const sets: string[] = []; const args: any[] = [id];
  for (const [k, col] of Object.entries(cols)) {
    if (k in patch) { args.push((patch as any)[k]); sets.push(`${col}=$${args.length}`); }
  }
  if (!sets.length) return getMitarbeitende(pool, id);
  const r = await pool.query(`update mitarbeitende set ${sets.join(',')} where id=$1 returning *`, args);
  if (!r.rowCount) throw new NotFoundError(`Mitarbeitende ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function getMitarbeitende(pool: pg.Pool, id: string): Promise<Mitarbeitende> {
  const r = await pool.query('select * from mitarbeitende where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Mitarbeitende ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function findMitarbeitendeByKuerzel(pool: pg.Pool, kuerzel: string): Promise<Mitarbeitende | null> {
  const r = await pool.query('select * from mitarbeitende where kuerzel=$1', [kuerzel.toLowerCase()]);
  return r.rowCount ? map(r.rows[0]) : null;
}

export async function findMitarbeitendeByEntraOid(pool: pg.Pool, oid: string): Promise<Mitarbeitende | null> {
  const r = await pool.query('select * from mitarbeitende where entra_oid=$1 and aktiv', [oid]);
  return r.rowCount ? map(r.rows[0]) : null;
}

export async function findMitarbeitendeByEmail(pool: pg.Pool, email: string): Promise<Mitarbeitende | null> {
  const r = await pool.query('select * from mitarbeitende where lower(email)=lower($1) and aktiv', [email]);
  return r.rowCount ? map(r.rows[0]) : null;
}

export async function listMitarbeitende(pool: pg.Pool, opts: { nurAktive?: boolean } = {}): Promise<Mitarbeitende[]> {
  const r = await pool.query(`select * from mitarbeitende ${opts.nurAktive ? 'where aktiv' : ''} order by kuerzel`);
  return r.rows.map(map);
}

import type pg from 'pg';
import type { Konto } from '../domain/types';
import { NotFoundError } from '../domain/errors';

const map = (r: any): Konto => ({
  id: r.id, nummer: r.nummer, bezeichnung: r.bezeichnung, typ: r.typ, aktiv: r.aktiv,
  mwstCode: r.mwst_code ?? null,
});

export type KontoUpsert = {
  nummer: string; bezeichnung: string; typ: 'Ertrag' | 'Aufwand';
  /** Roher MWST-Code des Kundenkontenplans. Fehlt er, bleibt die Spalte leer. */
  mwstCode?: string | null;
  /** false fuer ein stillgelegtes Konto ("Inaktiv" der Quelle). Vorgabe: aktiv. */
  aktiv?: boolean;
};

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

export async function findKontoByNummer(pool: pg.Pool, nummer: string): Promise<Konto | null> {
  const r = await pool.query('select * from konto where nummer=$1', [nummer]);
  return r.rowCount ? map(r.rows[0]) : null;
}

// Einziger Schreibpfad fuer Konten — der Kontenplan-Import (src/migration/konten.ts)
// laeuft ausschliesslich hierueber, es gibt keinen zweiten Writer.
export async function upsertKonto(pool: pg.Pool, input: KontoUpsert): Promise<{ konto: Konto; neu: boolean }> {
  const r = await pool.query(
    `insert into konto(nummer,bezeichnung,typ,mwst_code,aktiv) values ($1,$2,$3,$4,$5)
     on conflict (nummer) do update set bezeichnung=excluded.bezeichnung, typ=excluded.typ,
       mwst_code=excluded.mwst_code, aktiv=excluded.aktiv
     returning *, (xmax = 0) as neu`,
    [input.nummer, input.bezeichnung, input.typ, input.mwstCode ?? null, input.aktiv ?? true]);
  return { konto: map(r.rows[0]), neu: r.rows[0].neu };
}

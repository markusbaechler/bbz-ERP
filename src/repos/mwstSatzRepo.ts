import type pg from 'pg';
import type { MwstSatz } from '../domain/types';
import { NotFoundError } from '../domain/errors';

const map = (r: any): MwstSatz => ({
  id: r.id,
  satz: Number(r.satz),
  bezeichnung: r.bezeichnung,
  gueltigAb: r.gueltig_ab,          // 'YYYY-MM-DD' (DATE-Parser in pool.ts)
  gueltigBis: r.gueltig_bis ?? null,
});

export async function createMwstSatz(pool: pg.Pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string | null }): Promise<MwstSatz> {
  const r = await pool.query(
    'insert into mwst_satz(satz,bezeichnung,gueltig_ab,gueltig_bis) values ($1,$2,$3,$4) returning *',
    [input.satz, input.bezeichnung, input.gueltigAb, input.gueltigBis ?? null]);
  return map(r.rows[0]);
}

// order by gueltig_ab desc: die Satzhistorie soll ueberschneidungsfreie Fenster haben,
// aber weder Schema noch Constraint erzwingt das. Ohne Sortierung waere das Ergebnis
// bei einer kuenftigen Ueberlappung von der Planwahl abhaengig — mit ihr gewinnt
// definiert der zuletzt in Kraft gesetzte Satz.
export async function findGueltigenSatz(pool: pg.Pool, satz: number, datum: string): Promise<MwstSatz> {
  const r = await pool.query(
    `select * from mwst_satz where satz=$1 and gueltig_ab<=$2 and (gueltig_bis is null or gueltig_bis>=$2)
     order by gueltig_ab desc limit 1`,
    [satz, datum]);
  if (!r.rowCount) throw new NotFoundError(`Kein MWSt-Satz ${satz} gültig am ${datum}`);
  return map(r.rows[0]);
}

export async function upsertMwstSatz(pool: pg.Pool, input: { satz: number; bezeichnung: string; gueltigAb: string; gueltigBis?: string | null }): Promise<{ mwstSatz: MwstSatz; neu: boolean }> {
  const r = await pool.query(
    `insert into mwst_satz(satz,bezeichnung,gueltig_ab,gueltig_bis) values ($1,$2,$3,$4)
     on conflict (satz, gueltig_ab) do update set bezeichnung=excluded.bezeichnung, gueltig_bis=excluded.gueltig_bis
     returning *, (xmax = 0) as neu`,
    [input.satz, input.bezeichnung, input.gueltigAb, input.gueltigBis ?? null]);
  return { mwstSatz: map(r.rows[0]), neu: r.rows[0].neu };
}

import type pg from 'pg';
import type { Db } from './db';

export type OutboxTyp =
  | 'moodle.einschreiben'      // payload: { anmeldungId }
  | 'moodle.ausschreiben'      // payload: { anmeldungId }
  | 'webhook'                  // payload: { ereignis, daten }
  | 'mail';                    // payload: { vorlage, an, daten }

export type OutboxEintrag = {
  id: number; typ: OutboxTyp; aggregatId: string | null; payload: any; status: string; versuche: number;
  maxVersuche: number; naechsterVersuchAm: string; letzterFehler: string | null;
};

const map = (r: any): OutboxEintrag => ({
  id: Number(r.id), typ: r.typ, aggregatId: r.aggregat_id, payload: r.payload, status: r.status, versuche: r.versuche,
  maxVersuche: r.max_versuche, naechsterVersuchAm: new Date(r.naechster_versuch_am).toISOString(), letzterFehler: r.letzter_fehler,
});

/**
 * Legt einen Folgeauftrag an. In derselben Transaktion wie die fachliche Aenderung aufrufen (PoolClient),
 * damit Aenderung und Auftrag gemeinsam committen oder gemeinsam verworfen werden.
 */
export async function enqueue(db: Db, typ: OutboxTyp, aggregatId: string | null, payload: Record<string, unknown> = {}): Promise<number> {
  const r = await db.query('insert into outbox(typ,aggregat_id,payload) values ($1,$2,$3) returning id', [typ, aggregatId, JSON.stringify(payload)]);
  return Number(r.rows[0].id);
}

/** Fachliches Ereignis fuer Webhook-Abonnenten (Homepage etc.), z. B. "anmeldung.bestaetigt". */
export async function publiziere(db: Db, ereignis: string, daten: Record<string, unknown>): Promise<number> {
  return enqueue(db, 'webhook', null, { ereignis, daten });
}

/** Holt faellige Auftraege und markiert sie atomar als in_arbeit (mehrere Worker-Instanzen sicher). */
export async function holeFaellige(pool: pg.Pool, limit = 20): Promise<OutboxEintrag[]> {
  const r = await pool.query(
    `update outbox set status='in_arbeit', versuche=versuche+1
     where id in (select id from outbox where status in ('offen','fehler') and naechster_versuch_am <= now()
                  order by id limit $1 for update skip locked)
     returning *`, [limit]);
  return r.rows.map(map).sort((a, b) => a.id - b.id);
}

/** Exponentielles Backoff: 1, 2, 4, 8 ... Minuten, gedeckelt bei 6 Stunden. */
export function backoffMinuten(versuche: number): number {
  return Math.min(2 ** Math.max(versuche - 1, 0), 360);
}

export async function markiereErledigt(pool: pg.Pool, id: number): Promise<void> {
  await pool.query(`update outbox set status='erledigt', erledigt_am=now(), letzter_fehler=null where id=$1`, [id]);
}

export async function markiereFehler(pool: pg.Pool, e: OutboxEintrag, fehler: string): Promise<void> {
  const tot = e.versuche >= e.maxVersuche;
  await pool.query(
    `update outbox set status=$2, letzter_fehler=$3, naechster_versuch_am=now() + ($4 || ' minutes')::interval where id=$1`,
    [e.id, tot ? 'tot' : 'fehler', fehler.slice(0, 2000), String(backoffMinuten(e.versuche))]);
}

export async function listOutbox(pool: pg.Pool, filter: { status?: string; typ?: string; limit?: number } = {}): Promise<OutboxEintrag[]> {
  const cond: string[] = []; const args: unknown[] = [];
  if (filter.status) { args.push(filter.status); cond.push(`status=$${args.length}`); }
  if (filter.typ) { args.push(filter.typ); cond.push(`typ=$${args.length}`); }
  args.push(filter.limit ?? 100);
  const r = await pool.query(`select * from outbox ${cond.length ? 'where ' + cond.join(' and ') : ''} order by id desc limit $${args.length}`, args);
  return r.rows.map(map);
}

/** Tote/fehlerhafte Auftraege manuell erneut anstossen (Admin). */
export async function wiederholen(pool: pg.Pool, id: number): Promise<void> {
  await pool.query(`update outbox set status='offen', naechster_versuch_am=now(), max_versuche=greatest(max_versuche, versuche+3) where id=$1`, [id]);
}

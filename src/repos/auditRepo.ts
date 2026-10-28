import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

/** Schreibt einen Eintrag in die Revisionsspur. Kann innerhalb einer Transaktion (PoolClient) aufgerufen werden. */
export async function audit(db: Queryable, e: { benutzer?: string | null; aktion: string; entitaet: string; entitaetId?: string | null; details?: Record<string, unknown> }): Promise<void> {
  await db.query(
    'insert into audit_log(benutzer,aktion,entitaet,entitaet_id,details) values ($1,$2,$3,$4,$5)',
    [e.benutzer ?? null, e.aktion, e.entitaet, e.entitaetId ?? null, JSON.stringify(e.details ?? {})]);
}

export async function listAudit(db: Queryable, entitaet: string, entitaetId: string): Promise<{ zeitpunkt: string; benutzer: string | null; aktion: string; details: any }[]> {
  const r = await db.query(
    'select zeitpunkt, benutzer, aktion, details from audit_log where entitaet=$1 and entitaet_id=$2 order by id', [entitaet, entitaetId]);
  return r.rows.map((x: any) => ({ zeitpunkt: x.zeitpunkt.toISOString(), benutzer: x.benutzer, aktion: x.aktion, details: x.details }));
}

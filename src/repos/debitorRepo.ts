import type pg from 'pg';
import type { Zahlungseingang, OffenerPosten } from '../domain/types';
import { rappenRunden } from '../domain/mwst';
import { ValidationError, NotFoundError } from '../domain/errors';

export function offenerBetrag(brutto: number, bezahlt: number): number {
  return rappenRunden(brutto - bezahlt);
}

const mapZ = (r: any): Zahlungseingang => ({
  id: r.id, rechnungId: r.rechnung_id, datum: r.datum, betrag: Number(r.betrag),
  bemerkung: r.bemerkung, erfasstDurch: r.erfasst_durch,
});

export async function summeBezahlt(pool: pg.Pool, rechnungId: string): Promise<number> {
  const r = await pool.query('select coalesce(sum(betrag),0)::numeric as s from zahlungseingang where rechnung_id=$1', [rechnungId]);
  return Number(r.rows[0].s);
}

export async function erfasseZahlung(pool: pg.Pool, rechnungId: string, input: { datum: string; betrag: number; bemerkung?: string | null; erfasstDurch?: string | null }): Promise<{ zahlung: Zahlungseingang; rechnungStatus: string; offen: number }> {
  if (input.betrag <= 0) throw new ValidationError('Betrag muss > 0 sein');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rr = await client.query('select * from rechnung where id=$1 for update', [rechnungId]);
    if (!rr.rowCount) throw new NotFoundError(`Rechnung ${rechnungId} nicht gefunden`);
    const rech = rr.rows[0];
    if (rech.status !== 'abgerechnet' && rech.status !== 'bezahlt') {
      throw new ValidationError(`Zahlung nur auf festgeschriebene Rechnung (Status ${rech.status})`);
    }
    const ins = await client.query(
      `insert into zahlungseingang(rechnung_id,datum,betrag,bemerkung,erfasst_durch) values ($1,$2,$3,$4,$5) returning *`,
      [rechnungId, input.datum, input.betrag, input.bemerkung ?? null, input.erfasstDurch ?? null]);
    const sumR = await client.query('select coalesce(sum(betrag),0)::numeric as s from zahlungseingang where rechnung_id=$1', [rechnungId]);
    const bezahlt = Number(sumR.rows[0].s);
    const brutto = Number(rech.total_brutto);
    const offen = offenerBetrag(brutto, bezahlt);
    const neuerStatus = offen <= 0 ? 'bezahlt' : 'abgerechnet';
    await client.query('update rechnung set status=$2 where id=$1', [rechnungId, neuerStatus]);
    await client.query('commit');
    return { zahlung: mapZ(ins.rows[0]), rechnungStatus: neuerStatus, offen };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

const OFFEN_SQL = `
  select r.id, r.nummer, r.auftraggeber_id, r.datum, r.total_brutto,
         coalesce(z.bezahlt,0)::numeric as bezahlt,
         (r.total_brutto - coalesce(z.bezahlt,0))::numeric as offen
  from rechnung r
  left join (select rechnung_id, sum(betrag) as bezahlt from zahlungseingang group by rechnung_id) z
    on z.rechnung_id = r.id
  where r.status = 'abgerechnet'`;

const mapOP = (r: any): OffenerPosten => ({
  rechnungId: r.id, nummer: r.nummer, auftraggeberId: r.auftraggeber_id, datum: r.datum,
  totalBrutto: Number(r.total_brutto), bezahlt: Number(r.bezahlt), offen: Number(r.offen),
});

export async function offenePosten(pool: pg.Pool, filter: { auftraggeberId?: string } = {}): Promise<OffenerPosten[]> {
  const args: any[] = [];
  let sql = OFFEN_SQL;
  if (filter.auftraggeberId) { args.push(filter.auftraggeberId); sql += ` and r.auftraggeber_id=$${args.length}`; }
  sql += ' order by r.datum asc';
  const r = await pool.query(sql, args);
  return r.rows.map(mapOP).filter((p) => p.offen > 0);
}

export async function kontokorrentSaldo(pool: pg.Pool, auftraggeberId: string): Promise<number> {
  const posten = await offenePosten(pool, { auftraggeberId });
  return rappenRunden(posten.reduce((s, p) => s + p.offen, 0));
}

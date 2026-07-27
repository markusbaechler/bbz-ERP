import type pg from 'pg';
import { ValidationError, NotFoundError } from '../domain/errors';

export async function getZaehler(pool: pg.Pool, name: string): Promise<number> {
  const r = await pool.query('select wert from zaehler where name=$1', [name]);
  if (!r.rowCount) throw new NotFoundError(`Zaehler ${name} nicht gefunden`);
  return Number(r.rows[0].wert);
}

// Der Zaehler darf nur steigen: ein Rueckwaertssetzen wuerde bereits vergebene
// Rechnungsnummern erneut ausgeben (Spec §6.1, Befund B2).
export async function setzeRechnungZaehler(pool: pg.Pool, wert: number): Promise<number> {
  if (!Number.isInteger(wert) || wert < 0) throw new ValidationError('Zaehlerwert muss eine nicht-negative Ganzzahl sein');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cur = await client.query(`select wert from zaehler where name='rechnung_lfd_nr' for update`);
    if (!cur.rowCount) throw new NotFoundError('Zaehler rechnung_lfd_nr nicht gefunden');
    const alt = Number(cur.rows[0].wert);
    if (wert < alt) throw new ValidationError(`Zaehler steht bereits auf ${alt}; ${wert} wuerde Nummern doppelt vergeben`);
    const upd = await client.query(`update zaehler set wert=$1 where name='rechnung_lfd_nr' returning wert`, [wert]);
    await client.query('commit');
    return Number(upd.rows[0].wert);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

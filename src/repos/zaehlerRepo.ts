import type pg from 'pg';
import { ValidationError, NotFoundError } from '../domain/errors';

export async function getZaehler(pool: pg.Pool, name: string): Promise<number> {
  const r = await pool.query('select wert from zaehler where name=$1', [name]);
  if (!r.rowCount) throw new NotFoundError(`Zaehler ${name} nicht gefunden`);
  return Number(r.rows[0].wert);
}

/** Zaehlerstand samt Nachweis, wer ihn wann gesetzt hat (Migration 008). */
export type ZaehlerStand = { wert: number; gesetztAm: string | null; gesetztDurch: string | null };

export async function rechnungZaehlerStand(pool: pg.Pool): Promise<ZaehlerStand> {
  const r = await pool.query(`select wert, gesetzt_am, gesetzt_durch from zaehler where name='rechnung_lfd_nr'`);
  if (!r.rowCount) throw new NotFoundError('Zaehler rechnung_lfd_nr nicht gefunden');
  const row = r.rows[0];
  return {
    wert: Number(row.wert),
    gesetztAm: row.gesetzt_am === null ? null : new Date(row.gesetzt_am).toISOString(),
    gesetztDurch: row.gesetzt_durch ?? null,
  };
}

// Der Zaehler darf nur steigen: ein Rueckwaertssetzen wuerde bereits vergebene
// Rechnungsnummern erneut ausgeben (Spec §6.1, Befund B2).
// `akteur` haelt fest, wer gesetzt hat (CLI-Aufruf bzw. anfragende Identitaet der
// Route). Der Zeitpunkt wird immer geschrieben, der Akteur nur wenn bekannt — bei
// einem abgewiesenen Versuch bleibt beides unveraendert, weil die Transaktion
// zurueckrollt, bevor irgendetwas geschrieben ist.
export async function setzeRechnungZaehler(pool: pg.Pool, wert: number, akteur?: string | null): Promise<number> {
  if (!Number.isInteger(wert) || wert < 0) throw new ValidationError('Zaehlerwert muss eine nicht-negative Ganzzahl sein');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cur = await client.query(`select wert from zaehler where name='rechnung_lfd_nr' for update`);
    if (!cur.rowCount) throw new NotFoundError('Zaehler rechnung_lfd_nr nicht gefunden');
    const alt = Number(cur.rows[0].wert);
    if (wert < alt) throw new ValidationError(`Zaehler steht bereits auf ${alt}; ${wert} wuerde Nummern doppelt vergeben`);
    const upd = await client.query(
      `update zaehler set wert=$1, gesetzt_am=now(), gesetzt_durch=$2 where name='rechnung_lfd_nr' returning wert`,
      [wert, akteur?.trim() ? akteur.trim() : null]);
    await client.query('commit');
    return Number(upd.rows[0].wert);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

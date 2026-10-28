import type { Aktivitaet, AktivitaetTyp } from '../domain/crmTypes';
import { ValidationError, NotFoundError } from '../domain/errors';
import { optText, pflichtText, optWert, optZeitpunkt, optDatum } from '../domain/crm';
import type { Db } from './db';

export const AKTIVITAET_TYPEN: readonly AktivitaetTyp[] = ['telefon', 'meeting', 'email', 'besuch', 'event', 'notiz', 'offerte', 'brief'];

export const mapAktivitaet = (r: any): Aktivitaet => ({
  id: r.id, typ: r.typ, datum: new Date(r.datum).toISOString(), betreff: r.betreff, notizen: r.notizen,
  kontaktId: r.kontakt_id, organisationId: r.organisation_id, projektId: r.projekt_id,
  verkaufschanceId: r.verkaufschance_id, mitarbeitendeId: r.mitarbeitende_id,
});

export type AktivitaetInput = {
  typ: AktivitaetTyp; betreff: string; datum?: string | null; notizen?: string | null;
  kontaktId?: string | null; organisationId?: string | null; projektId?: string | null;
  verkaufschanceId?: string | null; mitarbeitendeId?: string | null;
};

/** Organisation wird aus Kontakt (bzw. Verkaufschance) abgeleitet, falls leer. Record-Lead = mitarbeitendeId. */
export async function createAktivitaet(db: Db, input: AktivitaetInput): Promise<Aktivitaet> {
  const i = input ?? ({} as AktivitaetInput);
  const typ = optWert(i.typ, 'typ', AKTIVITAET_TYPEN);
  if (!typ) throw new ValidationError(`typ ist Pflicht (${AKTIVITAET_TYPEN.join(', ')})`);
  const betreff = pflichtText(i.betreff, 'betreff', 300);
  const datum = optZeitpunkt(i.datum, 'datum') ?? null;
  const notizen = optText(i.notizen, 'notizen', 20000) ?? null;
  const kontaktId = optText(i.kontaktId, 'kontaktId') ?? null;
  const verkaufschanceId = optText(i.verkaufschanceId, 'verkaufschanceId') ?? null;
  let organisationId = optText(i.organisationId, 'organisationId') ?? null;
  if (!organisationId && kontaktId) {
    const k = await db.query('select organisation_id from kontakt where id=$1', [kontaktId]);
    if (!k.rowCount) throw new NotFoundError(`Kontakt ${kontaktId} nicht gefunden`);
    organisationId = k.rows[0].organisation_id;
  }
  if (!organisationId && !kontaktId && verkaufschanceId) {
    const v = await db.query('select organisation_id from verkaufschance where id=$1', [verkaufschanceId]);
    if (!v.rowCount) throw new NotFoundError(`Verkaufschance ${verkaufschanceId} nicht gefunden`);
    organisationId = v.rows[0].organisation_id;
  }
  if (!organisationId && !kontaktId) throw new ValidationError('kontaktId oder organisationId ist Pflicht');
  const r = await db.query(
    `insert into aktivitaet(typ,datum,betreff,notizen,kontakt_id,organisation_id,projekt_id,verkaufschance_id,mitarbeitende_id)
     values ($1,coalesce($2::timestamptz,now()),$3,$4,$5,$6,$7,$8,$9) returning *`,
    [typ, datum, betreff, notizen, kontaktId, organisationId, optText(i.projektId, 'projektId') ?? null,
     verkaufschanceId, optText(i.mitarbeitendeId, 'mitarbeitendeId') ?? null]);
  return mapAktivitaet(r.rows[0]);
}

export async function getAktivitaet(db: Db, id: string): Promise<Aktivitaet> {
  const r = await db.query('select * from aktivitaet where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Aktivitaet ${id} nicht gefunden`);
  return mapAktivitaet(r.rows[0]);
}

export async function deleteAktivitaet(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from aktivitaet where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Aktivitaet ${id} nicht gefunden`);
}

export type AktivitaetFilter = {
  kontaktId?: string; organisationId?: string; projektId?: string; verkaufschanceId?: string; mitarbeitendeId?: string;
  /** Kalendertage (Europe/Zurich), beide inklusiv. */
  von?: string; bis?: string; limit?: number;
};

/** SQL-Ausdruck: Beginn des Kalendertags $n in Europe/Zurich als timestamptz. */
export const tagesbeginn = (param: string) => `((${param})::date::timestamp at time zone 'Europe/Zurich')`;

/** Filter `organisationId` umfasst auch Aktivitaeten an Kontakten der Organisation. Neueste zuerst. */
export async function listAktivitaeten(db: Db, filter: AktivitaetFilter = {}): Promise<Aktivitaet[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace(/\?/g, `$${args.length}`)); };
  if (filter.kontaktId) add('a.kontakt_id=?', filter.kontaktId);
  if (filter.organisationId) add('(a.organisation_id=? or a.kontakt_id in (select k.id from kontakt k where k.organisation_id=?))', filter.organisationId);
  if (filter.projektId) add('a.projekt_id=?', filter.projektId);
  if (filter.verkaufschanceId) add('a.verkaufschance_id=?', filter.verkaufschanceId);
  if (filter.mitarbeitendeId) add('a.mitarbeitende_id=?', filter.mitarbeitendeId);
  if (filter.von !== undefined) add(`a.datum >= ${tagesbeginn('?')}`, optDatum(filter.von, 'von'));
  if (filter.bis !== undefined) add(`a.datum < ${tagesbeginn('?::date + 1')}`, optDatum(filter.bis, 'bis'));
  args.push(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
  const r = await db.query(
    `select a.* from aktivitaet a ${cond.length ? 'where ' + cond.join(' and ') : ''}
     order by a.datum desc, a.erstellt_am desc limit $${args.length}`, args);
  return r.rows.map(mapAktivitaet);
}

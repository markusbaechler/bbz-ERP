import type { Referent } from '../domain/types';
import { ValidationError, NotFoundError } from '../domain/errors';
import { type Db, patchSets, num } from './db';

const map = (r: any): Referent => ({
  id: r.id, typ: r.typ, mitarbeitendeId: r.mitarbeitende_id, kontaktId: r.kontakt_id, anzeigename: r.anzeigename,
  fachgebiete: r.fachgebiete ?? [], tagessatzChf: num(r.tagessatz_chf), halbtagessatzChf: num(r.halbtagessatz_chf),
  aktiv: r.aktiv, bemerkung: r.bemerkung,
});

export type ReferentInput = {
  typ: 'intern' | 'extern'; mitarbeitendeId?: string | null; kontaktId?: string | null; anzeigename?: string | null;
  fachgebiete?: string[]; tagessatzChf?: number | null; halbtagessatzChf?: number | null; bemerkung?: string | null;
};

export async function createReferent(db: Db, input: ReferentInput): Promise<Referent> {
  if (input.typ !== 'intern' && input.typ !== 'extern') throw new ValidationError('typ muss intern oder extern sein');
  let name = input.anzeigename?.trim() || null;
  if (input.typ === 'intern') {
    if (!input.mitarbeitendeId) throw new ValidationError('Interne Referent:innen brauchen mitarbeitendeId');
    const m = await db.query('select vorname, nachname from mitarbeitende where id=$1', [input.mitarbeitendeId]);
    if (!m.rowCount) throw new NotFoundError('Mitarbeitende nicht gefunden');
    name ??= [m.rows[0].vorname, m.rows[0].nachname].filter(Boolean).join(' ');
  } else {
    if (!input.kontaktId) throw new ValidationError('Externe Referent:innen brauchen kontaktId (CRM-Kontakt)');
    const k = await db.query('select vorname, nachname from kontakt where id=$1', [input.kontaktId]);
    if (!k.rowCount) throw new NotFoundError('Kontakt nicht gefunden');
    name ??= [k.rows[0].vorname, k.rows[0].nachname].filter(Boolean).join(' ');
  }
  const r = await db.query(
    `insert into referent(typ,mitarbeitende_id,kontakt_id,anzeigename,fachgebiete,tagessatz_chf,halbtagessatz_chf,bemerkung)
     values ($1,$2,$3,$4,coalesce($5,'{}'::text[]),$6,$7,$8) returning *`,
    [input.typ, input.typ === 'intern' ? input.mitarbeitendeId : null, input.typ === 'extern' ? input.kontaktId : null,
     name, input.fachgebiete ?? null, input.tagessatzChf ?? null, input.halbtagessatzChf ?? null, input.bemerkung ?? null]);
  return map(r.rows[0]);
}

export async function getReferent(db: Db, id: string): Promise<Referent> {
  const r = await db.query('select * from referent where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Referent ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function updateReferent(db: Db, id: string, patch: Partial<Omit<ReferentInput, 'typ' | 'mitarbeitendeId' | 'kontaktId'>> & { aktiv?: boolean }): Promise<Referent> {
  const args: unknown[] = [id];
  const sets = patchSets(patch as Record<string, unknown>, {
    anzeigename: 'anzeigename', fachgebiete: 'fachgebiete', tagessatzChf: 'tagessatz_chf',
    halbtagessatzChf: 'halbtagessatz_chf', bemerkung: 'bemerkung', aktiv: 'aktiv',
  }, args);
  if (!sets.length) return getReferent(db, id);
  const r = await db.query(`update referent set ${sets.join(',')} where id=$1 returning *`, args);
  if (!r.rowCount) throw new NotFoundError(`Referent ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listReferenten(db: Db, filter: { nurAktive?: boolean; fachgebiet?: string } = {}): Promise<Referent[]> {
  const cond: string[] = []; const args: unknown[] = [];
  if (filter.nurAktive) cond.push('aktiv');
  if (filter.fachgebiet) { args.push(filter.fachgebiet); cond.push(`$${args.length} = any(fachgebiete)`); }
  const r = await db.query(`select * from referent ${cond.length ? 'where ' + cond.join(' and ') : ''} order by anzeigename`, args);
  return r.rows.map(map);
}

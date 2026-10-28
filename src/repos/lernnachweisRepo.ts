import type { Lernnachweis } from '../domain/bildungTypes';
import { pruefeDatum } from '../domain/kursplanung';
import { ValidationError } from '../domain/errors';
import { type Db } from './db';
import { getKontakt } from './kontaktRepo';

export const mapLernnachweis = (r: any): Lernnachweis => ({
  id: r.id, kontaktId: r.kontakt_id, anmeldungId: r.anmeldung_id, datum: r.datum, titel: r.titel,
  lernstunden: Number(r.lernstunden), kategorie: r.kategorie, quelle: r.quelle,
});

const QUELLEN: Lernnachweis['quelle'][] = ['kurs', 'extern', 'moodle'];

export type LernnachweisInput = {
  kontaktId: string; datum: string; titel: string; lernstunden: number; kategorie?: string; quelle?: Lernnachweis['quelle'];
};

function pruefe(input: LernnachweisInput): void {
  if (!input?.kontaktId) throw new ValidationError('kontaktId ist Pflicht');
  pruefeDatum(input.datum, 'datum');
  if (!input.titel?.trim()) throw new ValidationError('titel ist Pflicht');
  if (!(typeof input.lernstunden === 'number' && input.lernstunden >= 0)) throw new ValidationError('lernstunden muss >= 0 sein');
  if (input.quelle !== undefined && !QUELLEN.includes(input.quelle)) throw new ValidationError(`quelle muss ${QUELLEN.join('/')} sein`);
}

/** Erfasst einen Lernnachweis (Default: externer Nachweis, z. B. Fachtagung einer anderen Institution). */
export async function createLernnachweis(db: Db, input: LernnachweisInput): Promise<Lernnachweis> {
  pruefe(input);
  await getKontakt(db, input.kontaktId);
  const r = await db.query(
    `insert into lernnachweis(kontakt_id,datum,titel,lernstunden,kategorie,quelle)
     values ($1,$2,$3,$4,coalesce($5,'weiterbildung'),coalesce($6,'extern')) returning *`,
    [input.kontaktId, input.datum, input.titel.trim(), input.lernstunden, input.kategorie ?? null, input.quelle ?? null]);
  return mapLernnachweis(r.rows[0]);
}

/** Lernnachweis aus einem Kursabschluss: genau einer je Anmeldung (bestehender wird zurueckgegeben). */
export async function lernnachweisFuerAnmeldung(db: Db, input: LernnachweisInput & { anmeldungId: string }): Promise<Lernnachweis> {
  pruefe(input);
  const r = await db.query(
    `insert into lernnachweis(kontakt_id,anmeldung_id,datum,titel,lernstunden,kategorie,quelle)
     values ($1,$2,$3,$4,$5,coalesce($6,'weiterbildung'),coalesce($7,'kurs'))
     on conflict (anmeldung_id) do nothing returning *`,
    [input.kontaktId, input.anmeldungId, input.datum, input.titel, input.lernstunden, input.kategorie ?? null, input.quelle ?? null]);
  if (r.rowCount) return mapLernnachweis(r.rows[0]);
  const vorhanden = await db.query('select * from lernnachweis where anmeldung_id=$1', [input.anmeldungId]);
  return mapLernnachweis(vorhanden.rows[0]);
}

export async function listLernnachweise(db: Db, kontaktId: string, filter: { von?: string; bis?: string } = {}): Promise<Lernnachweis[]> {
  const args: unknown[] = [kontaktId]; const cond = ['kontakt_id=$1'];
  if (filter.von) { args.push(pruefeDatum(filter.von, 'von')); cond.push(`datum>=$${args.length}`); }
  if (filter.bis) { args.push(pruefeDatum(filter.bis, 'bis')); cond.push(`datum<=$${args.length}`); }
  const r = await db.query(`select * from lernnachweis where ${cond.join(' and ')} order by datum, erstellt_am`, args);
  return r.rows.map(mapLernnachweis);
}

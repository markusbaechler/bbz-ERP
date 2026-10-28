import type { Lernnachweis, Zertifizierung, ZertifizierungStatus } from '../domain/bildungTypes';
import { pruefeDatum, heuteIso, addMonate } from '../domain/kursplanung';
import { rezertifizierungsStatus, standardGueltigBis, type RezertifizierungsStatus } from '../domain/rezertifizierung';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
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

// ---------------------------------------------------------------------------------------------
// Zertifizierung (SAQ) und Rezertifizierung
// ---------------------------------------------------------------------------------------------

export const mapZertifizierung = (r: any): Zertifizierung => ({
  id: r.id, kontaktId: r.kontakt_id, typ: r.typ, zertifikatNr: r.zertifikat_nr, ausgestelltAm: r.ausgestellt_am,
  gueltigBis: r.gueltig_bis, status: r.status,
});

const Z_STATUS: ZertifizierungStatus[] = ['aktiv', 'abgelaufen', 'entzogen'];

export type ZertifizierungInput = {
  kontaktId: string; typ: string; ausgestelltAm: string; gueltigBis?: string; zertifikatNr?: string | null;
  status?: ZertifizierungStatus;
};

/** Zertifikat erfassen; ohne `gueltigBis` gilt die Standardgueltigkeit (36 Monate). */
export async function createZertifizierung(db: Db, input: ZertifizierungInput): Promise<Zertifizierung> {
  if (!input?.kontaktId) throw new ValidationError('kontaktId ist Pflicht');
  if (!input.typ?.trim()) throw new ValidationError('typ ist Pflicht');
  pruefeDatum(input.ausgestelltAm, 'ausgestelltAm');
  const gueltigBis = input.gueltigBis === undefined ? standardGueltigBis(input.ausgestelltAm) : pruefeDatum(input.gueltigBis, 'gueltigBis');
  if (gueltigBis <= input.ausgestelltAm) throw new ValidationError('gueltigBis muss nach ausgestelltAm liegen');
  if (input.status !== undefined && !Z_STATUS.includes(input.status)) throw new ValidationError(`status muss ${Z_STATUS.join('/')} sein`);
  await getKontakt(db, input.kontaktId);
  const r = await db.query(
    `insert into zertifizierung(kontakt_id,typ,zertifikat_nr,ausgestellt_am,gueltig_bis,status)
     values ($1,$2,$3,$4,$5,coalesce($6,'aktiv')) returning *`,
    [input.kontaktId, input.typ.trim(), input.zertifikatNr ?? null, input.ausgestelltAm, gueltigBis, input.status ?? null],
  ).catch((e: any) => {
    if (e?.code === '23505') throw new ConflictError('Diese Zertifizierung ist fuer den Kontakt bereits erfasst');
    throw e;
  });
  return mapZertifizierung(r.rows[0]);
}

export async function getZertifizierung(db: Db, id: string): Promise<Zertifizierung> {
  const r = await db.query('select * from zertifizierung where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Zertifizierung ${id} nicht gefunden`);
  return mapZertifizierung(r.rows[0]);
}

export async function listZertifizierungen(db: Db, filter: { kontaktId?: string; typ?: string; status?: string } = {}): Promise<Zertifizierung[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.kontaktId) add('kontakt_id=?', filter.kontaktId);
  if (filter.typ) add('typ=?', filter.typ);
  if (filter.status) add('status=?', filter.status);
  const r = await db.query(`select * from zertifizierung ${cond.length ? 'where ' + cond.join(' and ') : ''} order by gueltig_bis, typ`, args);
  return r.rows.map(mapZertifizierung);
}

export type Rezertifizierung = RezertifizierungsStatus & { zertifizierung: Zertifizierung; lernnachweise: Lernnachweis[] };

/** Stand der Rezertifizierung: Lernstunden im Gueltigkeitszeitraum vs. Soll, inkl. der angerechneten Nachweise. */
export async function getRezertifizierung(db: Db, id: string, opt: { heute?: string } = {}): Promise<Rezertifizierung> {
  const z = await getZertifizierung(db, id);
  const lernnachweise = await listLernnachweise(db, z.kontaktId, { von: z.ausgestelltAm, bis: z.gueltigBis });
  const heute = opt.heute === undefined ? undefined : pruefeDatum(opt.heute, 'heute');
  return { ...rezertifizierungsStatus(z, lernnachweise, { heute }), zertifizierung: z, lernnachweise };
}

export type FaelligeRezertifizierung = RezertifizierungsStatus & {
  zertifizierung: Zertifizierung;
  kontakt: { id: string; vorname: string | null; nachname: string; email: string | null; organisationId: string | null };
};

/**
 * Aktive Zertifikate, die innert n Monaten ablaufen und denen noch Lernstunden fehlen (Vertriebschance P3d),
 * nach Ablaufdatum sortiert.
 */
export async function listFaelligeRezertifizierungen(db: Db, opt: { innertMonaten?: number; heute?: string } = {}): Promise<FaelligeRezertifizierung[]> {
  const monate = opt.innertMonaten ?? 6;
  if (!(Number.isInteger(monate) && monate >= 0 && monate <= 120)) throw new ValidationError('innertMonaten muss eine ganze Zahl 0..120 sein');
  const heute = opt.heute === undefined ? heuteIso() : pruefeDatum(opt.heute, 'heute');
  const r = await db.query(
    `select z.*, k.vorname, k.nachname, k.email, k.organisation_id
     from zertifizierung z join kontakt k on k.id=z.kontakt_id
     where z.status='aktiv' and z.gueltig_bis between $1 and $2
     order by z.gueltig_bis, k.nachname, z.typ`, [heute, addMonate(heute, monate)]);
  if (!r.rowCount) return [];
  const ln = await db.query('select * from lernnachweis where kontakt_id = any($1)', [[...new Set(r.rows.map((x: any) => x.kontakt_id))]]);
  const nachweise = ln.rows.map(mapLernnachweis);
  return r.rows
    .map((x: any): FaelligeRezertifizierung => {
      const z = mapZertifizierung(x);
      return {
        ...rezertifizierungsStatus(z, nachweise.filter((n) => n.kontaktId === z.kontaktId), { heute }),
        zertifizierung: z,
        kontakt: { id: x.kontakt_id, vorname: x.vorname, nachname: x.nachname, email: x.email, organisationId: x.organisation_id },
      };
    })
    .filter((f) => !f.erfuellt);
}

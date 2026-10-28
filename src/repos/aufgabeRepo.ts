// Generisches Aufgaben-Repo: Projektaufgaben (Kanban/Gantt) UND CRM-Wiedervorlagen ohne Projekt
// (Bezug auf Kontakt, Organisation oder Verkaufschance).
import type pg from 'pg';
import type { Aufgabe, AufgabePrioritaet, AufgabeStatus } from '../domain/pmTypes';
import { AUFGABE_STATUS, AUFGABE_PRIORITAET, GESTARTETE_STATUS, pruefeDatum, pruefeZeitraum } from '../domain/pmTypes';
import { erzeugtZyklus, kanbanEinordnen } from '../domain/aufgabenGraph';
import { heuteIso } from '../domain/cockpit';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, inTransaktion, patchSets, num } from './db';
import { pruefePhaseImProjekt } from './phaseRepo';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export const mapAufgabe = (r: any): Aufgabe => ({
  id: r.id, titel: r.titel, beschreibung: r.beschreibung, status: r.status, prioritaet: r.prioritaet,
  startDatum: r.start_datum, faelligAm: r.faellig_am, zustaendigId: r.zustaendig_id,
  projektId: r.projekt_id, phaseId: r.phase_id, kontaktId: r.kontakt_id, organisationId: r.organisation_id,
  verkaufschanceId: r.verkaufschance_id, vorgaengerId: r.vorgaenger_id, schaetzungStunden: num(r.schaetzung_stunden),
  sortierung: r.sortierung, erledigtAm: iso(r.erledigt_am), erstelltDurch: r.erstellt_durch,
  erstelltAm: iso(r.erstellt_am) as string, geaendertAm: iso(r.geaendert_am) as string,
});

export type AufgabeInput = {
  titel: string; beschreibung?: string | null; status?: AufgabeStatus; prioritaet?: AufgabePrioritaet;
  startDatum?: string | null; faelligAm?: string | null; zustaendigId?: string | null;
  projektId?: string | null; phaseId?: string | null; kontaktId?: string | null; organisationId?: string | null;
  verkaufschanceId?: string | null; vorgaengerId?: string | null; schaetzungStunden?: number | null; sortierung?: number;
};

const COLS: Record<string, string> = {
  titel: 'titel', beschreibung: 'beschreibung', status: 'status', prioritaet: 'prioritaet',
  startDatum: 'start_datum', faelligAm: 'faellig_am', zustaendigId: 'zustaendig_id', projektId: 'projekt_id',
  phaseId: 'phase_id', kontaktId: 'kontakt_id', organisationId: 'organisation_id', verkaufschanceId: 'verkaufschance_id',
  vorgaengerId: 'vorgaenger_id', schaetzungStunden: 'schaetzung_stunden', sortierung: 'sortierung',
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function pruefeFelder(input: Partial<AufgabeInput>, neu: boolean): void {
  if ((neu || has(input, 'titel')) && !input.titel?.trim()) throw new ValidationError('titel ist Pflicht');
  if ((neu ? input.status !== undefined : has(input, 'status')) && !AUFGABE_STATUS.includes(input.status as AufgabeStatus)) {
    throw new ValidationError(`status muss ${AUFGABE_STATUS.join('|')} sein`);
  }
  if ((neu ? input.prioritaet !== undefined : has(input, 'prioritaet')) && !AUFGABE_PRIORITAET.includes(input.prioritaet as AufgabePrioritaet)) {
    throw new ValidationError(`prioritaet muss ${AUFGABE_PRIORITAET.join('|')} sein`);
  }
  pruefeDatum('startDatum', input.startDatum);
  pruefeDatum('faelligAm', input.faelligAm);
  if (input.schaetzungStunden !== undefined && input.schaetzungStunden !== null
      && !(typeof input.schaetzungStunden === 'number' && input.schaetzungStunden >= 0)) {
    throw new ValidationError('schaetzungStunden muss >= 0 sein');
  }
  if (input.sortierung !== undefined && !Number.isInteger(input.sortierung)) throw new ValidationError('sortierung muss ganzzahlig sein');
}

type Zustand = Pick<Aufgabe, 'status' | 'projektId' | 'phaseId' | 'vorgaengerId' | 'startDatum' | 'faelligAm'>;

/**
 * Fachregeln (Spec §5.3): Phase und Vorgaenger im selben Projekt, Vorgaengerkette zyklenfrei,
 * Start (in_arbeit/review/erledigt) nur wenn der Vorgaenger erledigt ist (409).
 */
async function pruefeRegeln(db: Db, id: string | null, s: Zustand, alt: Aufgabe | null): Promise<void> {
  pruefeZeitraum(s.startDatum, s.faelligAm, 'Aufgabenzeitraum (start/faellig)');
  await pruefePhaseImProjekt(db, s.phaseId, s.projektId);

  if (alt && id && alt.projektId !== s.projektId) {
    const n = await db.query('select count(*)::int as n from aufgabe where vorgaenger_id=$1', [id]);
    if (n.rows[0].n > 0) throw new ValidationError('Projektwechsel nicht moeglich: Aufgabe hat Nachfolger (Abhaengigkeit zuerst loesen)');
  }

  let vorgaengerStatus: AufgabeStatus | null = null;
  if (s.vorgaengerId) {
    if (!s.projektId) throw new ValidationError('vorgaengerId setzt ein Projekt voraus');
    const v = await db.query('select projekt_id, status from aufgabe where id=$1', [s.vorgaengerId]);
    if (!v.rowCount || v.rows[0].projekt_id !== s.projektId) throw new ValidationError('Vorgaenger muss im selben Projekt liegen');
    vorgaengerStatus = v.rows[0].status;
    if (id) {
      const kanten = await db.query('select id, vorgaenger_id from aufgabe where projekt_id=$1', [s.projektId]);
      const map = new Map<string, string | null>(kanten.rows.map((k: any) => [k.id, k.vorgaenger_id]));
      if (erzeugtZyklus(id, s.vorgaengerId, map)) throw new ValidationError('Vorgaenger wuerde einen Zyklus erzeugen');
    }
  }

  const relevant = !alt || alt.status !== s.status || alt.vorgaengerId !== s.vorgaengerId;
  if (relevant && GESTARTETE_STATUS.includes(s.status) && s.vorgaengerId && vorgaengerStatus !== 'erledigt') {
    throw new ConflictError(`Aufgabe kann nicht auf "${s.status}" gesetzt werden: Vorgaenger ist noch nicht erledigt`);
  }
}

/** Naechste Sortierung am Ende einer Kanban-Spalte (Projekt + Status). */
const SORT_ENDE = `(select coalesce(max(sortierung),-1)+1 from aufgabe where projekt_id is not distinct from $1::uuid and status=$2)`;

export async function createAufgabe(db: Db, input: AufgabeInput, opts: { erstelltDurch?: string | null } = {}): Promise<Aufgabe> {
  pruefeFelder(input, true);
  const status = input.status ?? 'offen';
  await pruefeRegeln(db, null, {
    status, projektId: input.projektId ?? null, phaseId: input.phaseId ?? null, vorgaengerId: input.vorgaengerId ?? null,
    startDatum: input.startDatum ?? null, faelligAm: input.faelligAm ?? null,
  }, null);
  const r = await db.query(
    `insert into aufgabe(projekt_id,status,titel,beschreibung,prioritaet,start_datum,faellig_am,zustaendig_id,phase_id,kontakt_id,
       organisation_id,verkaufschance_id,vorgaenger_id,schaetzung_stunden,sortierung,erledigt_am,erstellt_durch)
     values ($1,$2,$3,$4,coalesce($5,'normal'),$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15,${SORT_ENDE}),
       case when $2='erledigt' then now() end,$16)
     returning *`,
    [input.projektId ?? null, status, input.titel.trim(), input.beschreibung ?? null, input.prioritaet ?? null,
     input.startDatum ?? null, input.faelligAm ?? null, input.zustaendigId ?? null, input.phaseId ?? null,
     input.kontaktId ?? null, input.organisationId ?? null, input.verkaufschanceId ?? null, input.vorgaengerId ?? null,
     input.schaetzungStunden ?? null, input.sortierung ?? null, opts.erstelltDurch ?? null]);
  return mapAufgabe(r.rows[0]);
}

export async function getAufgabe(db: Db, id: string, sperren = false): Promise<Aufgabe> {
  const r = await db.query(`select * from aufgabe where id=$1 ${sperren ? 'for update' : ''}`, [id]);
  if (!r.rowCount) throw new NotFoundError(`Aufgabe ${id} nicht gefunden`);
  return mapAufgabe(r.rows[0]);
}

export async function updateAufgabe(db: Db, id: string, patch: Partial<AufgabeInput>): Promise<Aufgabe> {
  pruefeFelder(patch, false);
  const alt = await getAufgabe(db, id);
  const s: Zustand = { ...alt };
  for (const k of ['status', 'projektId', 'phaseId', 'vorgaengerId', 'startDatum', 'faelligAm'] as const) {
    if (has(patch, k)) (s as any)[k] = (patch as any)[k] ?? null;
  }
  await pruefeRegeln(db, id, s, alt);

  const p: Record<string, unknown> = { ...patch };
  if (has(patch, 'titel')) p.titel = patch.titel!.trim();
  const args: unknown[] = [id];
  const sets = patchSets(p, COLS, args);
  const spalteNeu = s.status !== alt.status || s.projektId !== alt.projektId;
  if (s.status === 'erledigt' && alt.status !== 'erledigt') sets.push('erledigt_am=now()');
  if (s.status !== 'erledigt' && alt.erledigtAm) sets.push('erledigt_am=null');
  if (spalteNeu && !has(patch, 'sortierung')) {
    args.push(s.projektId, s.status);
    sets.push(`sortierung=(select coalesce(max(sortierung),-1)+1 from aufgabe where projekt_id is not distinct from $${args.length - 1}::uuid and status=$${args.length})`);
  }
  if (!sets.length) return alt;
  const r = await db.query(`update aufgabe set ${sets.join(',')}, geaendert_am=now() where id=$1 returning *`, args);
  return mapAufgabe(r.rows[0]);
}

export async function deleteAufgabe(db: Db, id: string): Promise<void> {
  const r = await db.query('delete from aufgabe where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Aufgabe ${id} nicht gefunden`);
}

export type AufgabeFilter = {
  projektId?: string; zustaendigId?: string; status?: AufgabeStatus | AufgabeStatus[]; kontaktId?: string;
  organisationId?: string; verkaufschanceId?: string; phaseId?: string;
  /** nur Aufgaben ohne Projekt (CRM-Wiedervorlagen) */
  ohneProjekt?: boolean;
  /** faellig_am < heute und nicht erledigt/abgebrochen */
  ueberfaellig?: boolean;
  faelligBis?: string;
  /** Referenzdatum fuer "ueberfaellig" (Default: heute, Europe/Zurich) */
  heute?: string;
};

export async function listAufgaben(db: Db, filter: AufgabeFilter = {}): Promise<Aufgabe[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace('?', `$${args.length}`)); };
  if (filter.projektId) add('projekt_id=?', filter.projektId);
  if (filter.zustaendigId) add('zustaendig_id=?', filter.zustaendigId);
  if (filter.kontaktId) add('kontakt_id=?', filter.kontaktId);
  if (filter.organisationId) add('organisation_id=?', filter.organisationId);
  if (filter.verkaufschanceId) add('verkaufschance_id=?', filter.verkaufschanceId);
  if (filter.phaseId) add('phase_id=?', filter.phaseId);
  if (filter.status !== undefined) add('status = any(?)', Array.isArray(filter.status) ? filter.status : [filter.status]);
  if (filter.ohneProjekt) cond.push('projekt_id is null');
  if (filter.faelligBis) { pruefeDatum('faelligBis', filter.faelligBis); add('faellig_am <= ?', filter.faelligBis); }
  if (filter.ueberfaellig) {
    const heute = filter.heute ?? heuteIso();
    pruefeDatum('heute', heute);
    add(`faellig_am < ? and status not in ('erledigt','abgebrochen')`, heute);
  }
  const r = await db.query(
    `select * from aufgabe ${cond.length ? 'where ' + cond.join(' and ') : ''}
     order by faellig_am nulls last, array_position(array['kritisch','hoch','normal','tief']::text[], prioritaet), sortierung, erstellt_am`,
    args);
  return r.rows.map(mapAufgabe);
}

/** Setzt die Reihenfolge dicht (0..n-1) gemaess der uebergebenen ID-Liste. */
async function renummeriere(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.query(
    `update aufgabe a set sortierung = v.ord - 1
     from unnest($1::uuid[]) with ordinality as v(id, ord)
     where a.id = v.id and a.sortierung <> v.ord - 1`, [ids]);
}

async function spaltenIds(db: Db, projektId: string | null, status: AufgabeStatus, ausser: string): Promise<string[]> {
  const r = await db.query(
    `select id from aufgabe where projekt_id is not distinct from $1::uuid and status=$2 and id<>$3
     order by sortierung, erstellt_am, id for update`, [projektId, status, ausser]);
  return r.rows.map((x: any) => x.id);
}

/**
 * Kanban-Drag&Drop (Spec §5.3): setzt Status und Position (0-basiert) in der Zielspalte des Projekts.
 * Zielspalte wird dicht neu nummeriert; bei Spaltenwechsel wird die Luecke in der Quellspalte geschlossen.
 * Vorgaengerregel wie bei updateAufgabe. Alles in einer Transaktion mit Zeilensperren.
 */
export async function verschiebeAufgabe(pool: pg.Pool, id: string, ziel: { status: AufgabeStatus; sortierung: number }): Promise<Aufgabe> {
  if (!AUFGABE_STATUS.includes(ziel?.status)) throw new ValidationError(`status muss ${AUFGABE_STATUS.join('|')} sein`);
  const roh = ziel.sortierung as unknown;
  const index = Number(roh);
  if (roh === null || roh === undefined || roh === '' || typeof roh === 'boolean' || !Number.isFinite(index)) {
    throw new ValidationError('sortierung muss eine Zahl sein');
  }
  return inTransaktion(pool, async (c) => {
    const alt = await getAufgabe(c, id, true);
    await pruefeRegeln(c, id, { ...alt, status: ziel.status }, alt);
    const reihenfolge = kanbanEinordnen(await spaltenIds(c, alt.projektId, ziel.status, id), id, index);
    if (ziel.status !== alt.status) {
      await c.query(
        `update aufgabe set status=$2, erledigt_am=${ziel.status === 'erledigt' ? 'now()' : 'null'} where id=$1`, [id, ziel.status]);
    }
    await c.query('update aufgabe set geaendert_am=now() where id=$1', [id]);
    await renummeriere(c, reihenfolge);
    if (ziel.status !== alt.status) await renummeriere(c, await spaltenIds(c, alt.projektId, alt.status, id));
    return getAufgabe(c, id);
  });
}

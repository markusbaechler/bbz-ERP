import type { Kontakt, Interesse } from '../domain/types';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { type Db, patchSets } from './db';

const INTERESSEN: Interesse[] = ['nachwuchs', 'tailormade', 'weiterbildung', 'zertifizierung', 'beratung'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const mapKontakt = (r: any): Kontakt => ({
  id: r.id, organisationId: r.organisation_id, anrede: r.anrede, titel: r.titel, vorname: r.vorname,
  nachname: r.nachname, funktion: r.funktion, abteilung: r.abteilung, email: r.email, email2: r.email2,
  telefon: r.telefon, mobile: r.mobile, sprache: r.sprache, geburtsdatum: r.geburtsdatum, rolle: r.rolle,
  zielgruppe: r.zielgruppe, betreuerId: r.betreuer_id, interessen: r.interessen ?? [], prioritaet: r.prioritaet,
  newsletter: r.newsletter, einwilligungAm: r.einwilligung_am ? new Date(r.einwilligung_am).toISOString() : null,
  einwilligungQuelle: r.einwilligung_quelle, moodleUserId: r.moodle_user_id, bemerkung: r.bemerkung, archiviert: r.archiviert,
});

export type KontaktInput = {
  nachname: string; vorname?: string | null; organisationId?: string | null; anrede?: Kontakt['anrede'];
  titel?: string | null; funktion?: string | null; abteilung?: string | null; email?: string | null; email2?: string | null;
  telefon?: string | null; mobile?: string | null; sprache?: string; geburtsdatum?: string | null; rolle?: string | null;
  zielgruppe?: string | null; betreuerId?: string | null; interessen?: Interesse[]; prioritaet?: Kontakt['prioritaet'];
  newsletter?: boolean; einwilligungQuelle?: string | null; bemerkung?: string | null;
};

const COLS: Record<string, string> = {
  organisationId: 'organisation_id', anrede: 'anrede', titel: 'titel', vorname: 'vorname', nachname: 'nachname',
  funktion: 'funktion', abteilung: 'abteilung', email: 'email', email2: 'email2', telefon: 'telefon', mobile: 'mobile',
  sprache: 'sprache', geburtsdatum: 'geburtsdatum', rolle: 'rolle', zielgruppe: 'zielgruppe', betreuerId: 'betreuer_id',
  interessen: 'interessen', prioritaet: 'prioritaet', newsletter: 'newsletter', einwilligungQuelle: 'einwilligung_quelle',
  bemerkung: 'bemerkung', archiviert: 'archiviert',
};

function normalisiere(input: Partial<KontaktInput>): Partial<KontaktInput> {
  const out: Partial<KontaktInput> = { ...input };
  if ('nachname' in input && !input.nachname?.trim()) throw new ValidationError('nachname ist Pflicht');
  if (input.email !== undefined && input.email !== null) {
    const e = input.email.trim().toLowerCase();
    if (e && !EMAIL_RE.test(e)) throw new ValidationError(`Ungueltige E-Mail: ${input.email}`);
    out.email = e || null;
  }
  if (input.interessen) {
    const bad = input.interessen.filter((i) => !INTERESSEN.includes(i));
    if (bad.length) throw new ValidationError(`Unbekannte Interessen: ${bad.join(', ')}`);
  }
  return out;
}

function alsKonflikt(e: any): never {
  if (e?.code === '23505' && String(e.constraint ?? '').includes('kontakt_email')) {
    throw new ConflictError('Es existiert bereits ein aktiver Kontakt mit dieser E-Mail');
  }
  throw e;
}

export async function createKontakt(db: Db, input: KontaktInput): Promise<Kontakt> {
  const n = normalisiere(input) as KontaktInput;
  if (!n.nachname?.trim()) throw new ValidationError('nachname ist Pflicht');
  // Einwilligung (nDSG) wird nur mit Newsletter-Opt-in zeitgestempelt.
  const r = await db.query(
    `insert into kontakt(organisation_id,anrede,titel,vorname,nachname,funktion,abteilung,email,email2,telefon,mobile,
       sprache,geburtsdatum,rolle,zielgruppe,betreuer_id,interessen,prioritaet,newsletter,einwilligung_am,einwilligung_quelle,bemerkung)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,'de'),$13,$14,$15,$16,coalesce($17,'{}'::text[]),$18,coalesce($19,false),
       case when coalesce($19,false) then now() end,$20,$21) returning *`,
    [n.organisationId ?? null, n.anrede ?? null, n.titel ?? null, n.vorname ?? null, n.nachname.trim(), n.funktion ?? null,
     n.abteilung ?? null, n.email ?? null, n.email2 ?? null, n.telefon ?? null, n.mobile ?? null, n.sprache ?? null,
     n.geburtsdatum ?? null, n.rolle ?? null, n.zielgruppe ?? null, n.betreuerId ?? null, n.interessen ?? null,
     n.prioritaet ?? null, n.newsletter ?? null, n.einwilligungQuelle ?? null, n.bemerkung ?? null],
  ).catch(alsKonflikt);
  return mapKontakt(r.rows[0]);
}

export async function getKontakt(db: Db, id: string): Promise<Kontakt> {
  const r = await db.query('select * from kontakt where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Kontakt ${id} nicht gefunden`);
  return mapKontakt(r.rows[0]);
}

export async function updateKontakt(db: Db, id: string, patch: Partial<KontaktInput> & { archiviert?: boolean }): Promise<Kontakt> {
  const n = normalisiere(patch);
  const args: unknown[] = [id];
  const sets = patchSets(n as Record<string, unknown>, COLS, args);
  // Newsletter-Opt-in setzt den Einwilligungszeitpunkt, Opt-out loescht ihn (nDSG-Nachweis).
  if ('newsletter' in n) sets.push(n.newsletter ? 'einwilligung_am=coalesce(einwilligung_am, now())' : 'einwilligung_am=null');
  if (!sets.length) return getKontakt(db, id);
  sets.push('geaendert_am=now()');
  const r = await db.query(`update kontakt set ${sets.join(',')} where id=$1 returning *`, args).catch(alsKonflikt);
  if (!r.rowCount) throw new NotFoundError(`Kontakt ${id} nicht gefunden`);
  return mapKontakt(r.rows[0]);
}

export async function findKontaktByEmail(db: Db, email: string): Promise<Kontakt | null> {
  const r = await db.query('select * from kontakt where lower(email)=lower($1) and not archiviert', [email.trim()]);
  return r.rowCount ? mapKontakt(r.rows[0]) : null;
}

/**
 * Dublettenschutz fuer Eingaenge (Homepage-Anmeldung, Anfrage, Import): gleiche E-Mail = gleicher Kontakt.
 * Bestehende Kontakte werden nur ergaenzt (leere Felder), nie ueberschrieben.
 */
export async function findOrCreateKontaktByEmail(db: Db, input: KontaktInput & { email: string }): Promise<{ kontakt: Kontakt; neu: boolean }> {
  const vorhanden = await findKontaktByEmail(db, input.email);
  if (!vorhanden) return { kontakt: await createKontakt(db, input), neu: true };
  const ergaenzung: Partial<KontaktInput> = {};
  for (const k of ['vorname', 'anrede', 'funktion', 'telefon', 'mobile', 'organisationId'] as const) {
    if (vorhanden[k] === null && input[k]) (ergaenzung as any)[k] = input[k];
  }
  const kontakt = Object.keys(ergaenzung).length ? await updateKontakt(db, vorhanden.id, ergaenzung) : vorhanden;
  return { kontakt, neu: false };
}

export async function listKontakte(db: Db, filter: { organisationId?: string; suche?: string; inklArchiviert?: boolean; limit?: number } = {}): Promise<Kontakt[]> {
  const cond: string[] = []; const args: unknown[] = [];
  if (!filter.inklArchiviert) cond.push('not archiviert');
  if (filter.organisationId) { args.push(filter.organisationId); cond.push(`organisation_id=$${args.length}`); }
  if (filter.suche?.trim()) {
    args.push(`%${filter.suche.trim().toLowerCase()}%`);
    cond.push(`(lower(nachname) like $${args.length} or lower(coalesce(vorname,'')) like $${args.length} or lower(coalesce(email,'')) like $${args.length})`);
  }
  args.push(Math.min(filter.limit ?? 500, 2000));
  const where = cond.length ? `where ${cond.join(' and ')}` : '';
  const r = await db.query(`select * from kontakt ${where} order by lower(nachname), lower(vorname) limit $${args.length}`, args);
  return r.rows.map(mapKontakt);
}

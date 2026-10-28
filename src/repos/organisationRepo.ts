import type pg from 'pg';
import type { Auftraggeber } from '../domain/types';
import type { Organisation, OrganisationKategorie, Klassifizierung, OrganisationListeEintrag } from '../domain/crmTypes';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { KLASSIFIZIERUNGEN, optText, pflichtText, optEmail, optWert, optBool } from '../domain/crm';
import { createAuftraggeber, getAuftraggeberById } from './auftraggeberRepo';
import { type Db, patchSets } from './db';

export const KATEGORIEN: readonly OrganisationKategorie[] = ['kunde', 'interessent', 'partner', 'lieferant', 'uebrige'];

export const mapOrganisation = (r: any): Organisation => ({
  id: r.id, name: r.name, kategorie: r.kategorie, klassifizierung: r.klassifizierung, vip: r.vip, branche: r.branche,
  strasse: r.strasse, plz: r.plz, ort: r.ort, land: r.land, telefon: r.telefon, email: r.email, website: r.website,
  betreuerId: r.betreuer_id, bemerkung: r.bemerkung, archiviert: r.archiviert,
});

export type OrganisationInput = {
  name: string; kategorie?: OrganisationKategorie; klassifizierung?: Klassifizierung | null; vip?: boolean;
  branche?: string | null; strasse?: string | null; plz?: string | null; ort?: string | null; land?: string;
  telefon?: string | null; email?: string | null; website?: string | null; betreuerId?: string | null; bemerkung?: string | null;
};

const COLS: Record<string, string> = {
  name: 'name', kategorie: 'kategorie', klassifizierung: 'klassifizierung', vip: 'vip', branche: 'branche', strasse: 'strasse',
  plz: 'plz', ort: 'ort', land: 'land', telefon: 'telefon', email: 'email', website: 'website', betreuerId: 'betreuer_id',
  bemerkung: 'bemerkung', archiviert: 'archiviert',
};

/** Prueft/normalisiert nur die uebergebenen Felder (PATCH-tauglich); unbekannte Felder werden ignoriert. */
function normalisiere(input: Record<string, unknown>): Record<string, unknown> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const out: Record<string, unknown> = {};
  if (has('name')) out.name = pflichtText(input.name, 'name', 200);
  if (has('kategorie')) {
    const k = optWert(input.kategorie, 'kategorie', KATEGORIEN);
    if (!k) throw new ValidationError('kategorie darf nicht leer sein');
    out.kategorie = k;
  }
  if (has('klassifizierung')) out.klassifizierung = optWert(input.klassifizierung, 'klassifizierung', KLASSIFIZIERUNGEN);
  for (const f of ['vip', 'archiviert'] as const) {
    if (has(f)) out[f] = optBool(input[f], f);
  }
  for (const f of ['branche', 'strasse', 'plz', 'ort', 'telefon', 'website', 'betreuerId', 'bemerkung'] as const) {
    if (has(f)) out[f] = optText(input[f], f, f === 'bemerkung' ? 5000 : 200);
  }
  if (has('land')) {
    const l = optText(input.land, 'land', 2);
    if (!l) throw new ValidationError('land darf nicht leer sein');
    out.land = l.toUpperCase();
  }
  if (has('email')) out.email = optEmail(input.email);
  return out;
}

export async function createOrganisation(db: Db, input: OrganisationInput): Promise<Organisation> {
  const n = normalisiere({ ...input, name: input?.name ?? null }) as any;
  const r = await db.query(
    `insert into organisation(name,kategorie,klassifizierung,vip,branche,strasse,plz,ort,land,telefon,email,website,betreuer_id,bemerkung)
     values ($1,coalesce($2,'kunde'),$3,coalesce($4,false),$5,$6,$7,$8,coalesce($9,'CH'),$10,$11,$12,$13,$14) returning *`,
    [n.name, n.kategorie ?? null, n.klassifizierung ?? null, n.vip ?? null, n.branche ?? null, n.strasse ?? null, n.plz ?? null,
     n.ort ?? null, n.land ?? null, n.telefon ?? null, n.email ?? null, n.website ?? null, n.betreuerId ?? null, n.bemerkung ?? null]);
  return mapOrganisation(r.rows[0]);
}

export async function getOrganisation(db: Db, id: string): Promise<Organisation> {
  const r = await db.query('select * from organisation where id=$1', [id]);
  if (!r.rowCount) throw new NotFoundError(`Organisation ${id} nicht gefunden`);
  return mapOrganisation(r.rows[0]);
}

export async function updateOrganisation(db: Db, id: string, patch: Partial<OrganisationInput> & { archiviert?: boolean }): Promise<Organisation> {
  const n = normalisiere((patch ?? {}) as Record<string, unknown>);
  const args: unknown[] = [id];
  const sets = patchSets(n, COLS, args);
  if (!sets.length) return getOrganisation(db, id);
  sets.push('geaendert_am=now()');
  const r = await db.query(`update organisation set ${sets.join(',')} where id=$1 returning *`, args);
  if (!r.rowCount) throw new NotFoundError(`Organisation ${id} nicht gefunden`);
  return mapOrganisation(r.rows[0]);
}

export type OrganisationFilter = {
  suche?: string; kategorie?: string; klassifizierung?: string; betreuerId?: string; inklArchiviert?: boolean; limit?: number;
};

/** Liste inkl. Anzahl aktiver Kontakte und letzter Aktivitaet (direkt an der Organisation oder an ihren Kontakten). */
export async function listOrganisationen(db: Db, filter: OrganisationFilter = {}): Promise<OrganisationListeEintrag[]> {
  const cond: string[] = []; const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace(/\?/g, `$${args.length}`)); };
  if (!filter.inklArchiviert) cond.push('not o.archiviert');
  if (filter.kategorie) add('o.kategorie=?', optWert(filter.kategorie, 'kategorie', KATEGORIEN));
  if (filter.klassifizierung === 'ohne') cond.push('o.klassifizierung is null');
  else if (filter.klassifizierung) add('o.klassifizierung=?', optWert(filter.klassifizierung, 'klassifizierung', KLASSIFIZIERUNGEN));
  if (filter.betreuerId) add('o.betreuer_id=?', filter.betreuerId);
  if (filter.suche?.trim()) {
    add(`(lower(o.name) like ? or lower(coalesce(o.ort,'')) like ? or lower(coalesce(o.branche,'')) like ?)`, `%${filter.suche.trim().toLowerCase()}%`);
  }
  args.push(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
  const r = await db.query(
    `select o.*,
       (select count(*) from kontakt k where k.organisation_id=o.id and not k.archiviert)::int as kontakte_anzahl,
       (select max(a.datum) from aktivitaet a
         where a.organisation_id=o.id or a.kontakt_id in (select k.id from kontakt k where k.organisation_id=o.id)) as letzte_aktivitaet
     from organisation o ${cond.length ? 'where ' + cond.join(' and ') : ''}
     order by lower(o.name) limit $${args.length}`, args);
  return r.rows.map((x: any) => ({
    ...mapOrganisation(x), kontakteAnzahl: x.kontakte_anzahl,
    letzteAktivitaet: x.letzte_aktivitaet ? new Date(x.letzte_aktivitaet).toISOString() : null,
  }));
}

export async function findAuftraggeberFuerOrganisation(pool: pg.Pool, organisationId: string): Promise<Auftraggeber | null> {
  const r = await pool.query('select id from auftraggeber where organisation_id=$1', [organisationId]);
  return r.rowCount ? getAuftraggeberById(pool, r.rows[0].id) : null;
}

/**
 * Macht eine CRM-Organisation zum Debitor: verknuepft einen bestehenden Auftraggeber (`auftraggeberId`)
 * oder erzeugt einen aus der Organisationsadresse (vollstaendige Adresse Pflicht, QR-Regel v1).
 * Bereits verknuepft -> 409. Schlaegt die Verknuepfung fehl, wird ein eben erzeugter Auftraggeber wieder entfernt.
 */
export async function verknuepfeAuftraggeber(pool: pg.Pool, organisationId: string, opts: { nummer?: string | null; auftraggeberId?: string | null }): Promise<Auftraggeber> {
  const org = await getOrganisation(pool, organisationId);
  if (await findAuftraggeberFuerOrganisation(pool, org.id)) {
    throw new ConflictError(`Organisation ${org.name} ist bereits mit einem Auftraggeber verknuepft`);
  }
  if (opts.auftraggeberId) {
    await getAuftraggeberById(pool, opts.auftraggeberId);
    const r = await pool.query('update auftraggeber set organisation_id=$2 where id=$1 and organisation_id is null returning id', [opts.auftraggeberId, org.id])
      .catch(alsKonflikt);
    if (!r.rowCount) throw new ConflictError('Auftraggeber ist bereits mit einer anderen Organisation verknuepft');
    return getAuftraggeberById(pool, opts.auftraggeberId);
  }
  const fehlend = (['strasse', 'plz', 'ort'] as const).filter((f) => !org[f]?.trim());
  if (fehlend.length) {
    throw new ValidationError(`Organisation braucht fuer den Debitor (QR-Rechnung) eine vollstaendige Adresse; es fehlt: ${fehlend.join(', ')}`);
  }
  const nummer = optText(opts.nummer, 'nummer', 50) ?? null;
  const a = await createAuftraggeber(pool, {
    nummer, name: org.name, strasse: org.strasse!, plz: org.plz!, ort: org.ort!, land: org.land, email: org.email, telefon: org.telefon,
  });
  try {
    await pool.query('update auftraggeber set organisation_id=$2 where id=$1', [a.id, org.id]).catch(alsKonflikt);
  } catch (e) {
    await pool.query('delete from auftraggeber where id=$1', [a.id]);
    throw e;
  }
  return getAuftraggeberById(pool, a.id);
}

function alsKonflikt(e: any): never {
  if (e?.code === '23505' && String(e.constraint ?? '').includes('organisation_id')) {
    throw new ConflictError('Organisation ist bereits mit einem Auftraggeber verknuepft');
  }
  throw e;
}

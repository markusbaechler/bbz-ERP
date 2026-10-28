import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { ValidationError, NotFoundError } from '../domain/errors';

export const SCOPES = ['public:read', 'public:anmeldung', 'public:anfrage', 'public:formular', 'moodle:events'] as const;
export type Scope = typeof SCOPES[number];

export type ApiClient = { id: string; name: string; keyPrefix: string; scopes: Scope[]; erlaubteOrigins: string[]; aktiv: boolean; zuletztGenutztAm: string | null };

const map = (r: any): ApiClient => ({
  id: r.id, name: r.name, keyPrefix: r.key_prefix, scopes: r.scopes, erlaubteOrigins: r.erlaubte_origins, aktiv: r.aktiv,
  zuletztGenutztAm: r.zuletzt_genutzt_am ? new Date(r.zuletzt_genutzt_am).toISOString() : null,
});

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Schluesselformat: bbz_<8 hex>_<43 Zeichen base64url>. Gespeichert werden nur Praefix und SHA-256. */
function neuerSchluessel(): { schluessel: string; prefix: string } {
  const prefix = `bbz_${randomBytes(4).toString('hex')}`;
  return { schluessel: `${prefix}_${randomBytes(32).toString('base64url')}`, prefix };
}

function pruefeEingaben(scopes: string[], origins: string[]) {
  const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (bad.length) throw new ValidationError(`Unbekannte Scopes: ${bad.join(', ')}`);
  for (const o of origins) if (!/^https?:\/\/[^/\s]+$/.test(o)) throw new ValidationError(`Origin ohne Pfad angeben (z. B. https://www.bankenberatungszentrum.ch): ${o}`);
}

/** Legt einen Client an; der Klartext-Schluessel wird nur hier einmal zurueckgegeben. */
export async function createApiClient(pool: pg.Pool, input: { name: string; scopes: string[]; erlaubteOrigins?: string[] }): Promise<{ client: ApiClient; schluessel: string }> {
  if (!input.name?.trim()) throw new ValidationError('name ist Pflicht');
  pruefeEingaben(input.scopes ?? [], input.erlaubteOrigins ?? []);
  const { schluessel, prefix } = neuerSchluessel();
  const r = await pool.query(
    'insert into api_client(name,key_prefix,key_hash,scopes,erlaubte_origins) values ($1,$2,$3,$4,$5) returning *',
    [input.name.trim(), prefix, hash(schluessel), input.scopes, input.erlaubteOrigins ?? []]);
  return { client: map(r.rows[0]), schluessel };
}

export async function rotiereApiClient(pool: pg.Pool, id: string): Promise<{ client: ApiClient; schluessel: string }> {
  const { schluessel, prefix } = neuerSchluessel();
  const r = await pool.query('update api_client set key_prefix=$2, key_hash=$3 where id=$1 returning *', [id, prefix, hash(schluessel)]);
  if (!r.rowCount) throw new NotFoundError(`API-Client ${id} nicht gefunden`);
  return { client: map(r.rows[0]), schluessel };
}

export async function updateApiClient(pool: pg.Pool, id: string, patch: { aktiv?: boolean; scopes?: string[]; erlaubteOrigins?: string[]; name?: string }): Promise<ApiClient> {
  pruefeEingaben(patch.scopes ?? [], patch.erlaubteOrigins ?? []);
  const r = await pool.query(
    `update api_client set aktiv=coalesce($2,aktiv), scopes=coalesce($3,scopes), erlaubte_origins=coalesce($4,erlaubte_origins), name=coalesce($5,name)
     where id=$1 returning *`, [id, patch.aktiv ?? null, patch.scopes ?? null, patch.erlaubteOrigins ?? null, patch.name ?? null]);
  if (!r.rowCount) throw new NotFoundError(`API-Client ${id} nicht gefunden`);
  return map(r.rows[0]);
}

export async function listApiClients(pool: pg.Pool): Promise<ApiClient[]> {
  return (await pool.query('select * from api_client order by name')).rows.map(map);
}

/** Prueft einen Schluessel (zeitkonstanter Vergleich). Liefert nur aktive Clients. */
export async function verifiziereSchluessel(pool: pg.Pool, schluessel: string | undefined): Promise<ApiClient | null> {
  if (!schluessel) return null;
  const m = /^(bbz_[0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/.exec(schluessel.trim());
  if (!m) return null;
  const r = await pool.query('select * from api_client where key_prefix=$1 and aktiv', [m[1]]);
  if (!r.rowCount) return null;
  const soll = Buffer.from(r.rows[0].key_hash, 'hex'); const ist = Buffer.from(hash(schluessel.trim()), 'hex');
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) return null;
  await pool.query('update api_client set zuletzt_genutzt_am=now() where id=$1', [r.rows[0].id]);
  return map(r.rows[0]);
}

/** Alle erlaubten Origins (fuer CORS-Preflight, der keinen Schluessel mitsendet). */
export async function alleErlaubtenOrigins(pool: pg.Pool): Promise<Set<string>> {
  const r = await pool.query('select distinct unnest(erlaubte_origins) as o from api_client where aktiv');
  return new Set(r.rows.map((x: any) => x.o));
}

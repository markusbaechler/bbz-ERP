import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { verifiziereSchluessel, alleErlaubtenOrigins, type ApiClient, type Scope } from '../repos/apiClientRepo';

/*
 * Schutz der oeffentlichen Homepage-API (/public/v1): API-Schluessel (x-api-key), Scope, Origin-Bindung (CORS),
 * Rate-Limit je Client und Idempotenz fuer POSTs (Header idempotency-key).
 */

declare module 'fastify' {
  interface FastifyRequest { apiClient: ApiClient | null }
}

const ERLAUBTE_HEADER = 'content-type, x-api-key, idempotency-key';

/** Einfaches Festfenster-Limit pro Client und Minute (ein Prozess; fuer mehrere Instanzen spaeter Redis o. ae.). */
export class RateLimiter {
  private fenster = new Map<string, { start: number; n: number }>();
  constructor(private readonly proMinute: number, private readonly jetzt: () => number = Date.now) {}
  erlaubt(schluessel: string): { ok: boolean; retryAfterSek: number } {
    const t = this.jetzt(); const f = this.fenster.get(schluessel);
    if (!f || t - f.start >= 60_000) { this.fenster.set(schluessel, { start: t, n: 1 }); return { ok: true, retryAfterSek: 0 }; }
    f.n++;
    return f.n <= this.proMinute ? { ok: true, retryAfterSek: 0 } : { ok: false, retryAfterSek: Math.ceil((f.start + 60_000 - t) / 1000) };
  }
}

export function registrierePublicSchutz(app: FastifyInstance, pool: pg.Pool, opts: { lesenProMinute?: number; schreibenProMinute?: number } = {}): void {
  app.decorateRequest('apiClient', null);
  const lesen = new RateLimiter(opts.lesenProMinute ?? 600);
  const schreiben = new RateLimiter(opts.schreibenProMinute ?? 60);
  let originCache: { werte: Set<string>; bis: number } | null = null;
  const origins = async () => {
    if (!originCache || originCache.bis < Date.now()) originCache = { werte: await alleErlaubtenOrigins(pool), bis: Date.now() + 60_000 };
    return originCache.werte;
  };

  // CORS-Preflight fuer die Homepage
  app.options('/public/*', async (req, reply) => {
    const o = req.headers.origin;
    if (!o || !(await origins()).has(o)) return reply.code(403).send();
    return reply.code(204).header('access-control-allow-origin', o).header('vary', 'Origin')
      .header('access-control-allow-methods', 'GET, POST').header('access-control-allow-headers', ERLAUBTE_HEADER)
      .header('access-control-max-age', '600').send();
  });

  app.decorate('requireScope', (scope: Scope) => async (req: FastifyRequest, reply: FastifyReply) => {
    const client = await verifiziereSchluessel(pool, req.headers['x-api-key'] as string | undefined);
    if (!client) return reply.code(401).send({ error: 'Gueltiger API-Schluessel erforderlich (x-api-key)' });
    if (!client.scopes.includes(scope)) return reply.code(403).send({ error: `Scope ${scope} fehlt` });
    const o = req.headers.origin;
    if (o) {
      if (client.erlaubteOrigins.length && !client.erlaubteOrigins.includes(o)) return reply.code(403).send({ error: 'Origin nicht erlaubt' });
      reply.header('access-control-allow-origin', o).header('vary', 'Origin');
    }
    const limit = (req.method === 'GET' ? lesen : schreiben).erlaubt(client.id);
    if (!limit.ok) return reply.code(429).header('retry-after', String(limit.retryAfterSek)).send({ error: 'Zu viele Anfragen' });
    req.apiClient = client;
  });
}

declare module 'fastify' {
  interface FastifyInstance { requireScope: (scope: Scope) => (req: FastifyRequest, reply: FastifyReply) => Promise<void> }
}

/**
 * Fuehrt fn hoechstens einmal je Idempotenz-Schluessel aus; Wiederholungen erhalten die gespeicherte Antwort.
 * Ein Advisory-Lock serialisiert gleichzeitige Requests mit demselben Schluessel.
 */
export async function mitIdempotenz(pool: pg.Pool, clientId: string, schluessel: string | undefined,
  fn: () => Promise<{ status: number; body: unknown }>): Promise<{ status: number; body: unknown; wiederholt: boolean }> {
  if (!schluessel) return { ...(await fn()), wiederholt: false };
  if (schluessel.length > 200) return { status: 400, body: { error: 'idempotency-key zu lang' }, wiederholt: false };
  const voll = `${clientId}:${schluessel}`;
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [voll]);
    const vorhanden = await c.query('select status_code, antwort from idempotenz where schluessel=$1', [voll]);
    if (vorhanden.rowCount) { await c.query('commit'); return { status: vorhanden.rows[0].status_code, body: vorhanden.rows[0].antwort, wiederholt: true }; }
    const res = await fn();
    if (res.status < 500) await c.query('insert into idempotenz(schluessel,client_id,status_code,antwort) values ($1,$2,$3,$4)', [voll, clientId, res.status, JSON.stringify(res.body)]);
    await c.query('commit');
    return { ...res, wiederholt: false };
  } catch (e) {
    await c.query('rollback'); throw e;
  } finally { c.release(); }
}

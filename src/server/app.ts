import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { registriereAuth, authKonfigAusEnv, type AuthKonfig } from './authHook';
import { registrierePublicSchutz } from './publicSchutz';
import { registriereStatisch } from './statisch';
import { registerIntegrationRoutes } from './routes/integration';
import { registerPublicRoutes } from './routes/public';
import type { WorkerDeps } from '../integrations/worker';
import { moodleAusEnv } from '../integrations/moodle/client';
import { mailAusEnv } from '../integrations/mail';
import { requireAdmin } from './auth';
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
import { registerRechnungRoutes } from './routes/rechnung';
import { registerDebitorRoutes } from './routes/debitor';
import { registerPersonalRoutes } from './routes/personal';
import { registerCrmRoutes } from './routes/crm';
import { registerPmRoutes } from './routes/pm';
import { registerBildungRoutes } from './routes/bildung';
import { registerSaqRoutes } from './routes/saq';
import { registerMahnwesenRoutes } from './routes/mahnwesen';
import { registerSaqVerrechnungRoutes } from './routes/saqVerrechnung';
import { registerStammdatenRoutes } from './routes/stammdaten';

export type AppOptionen = {
  auth?: AuthKonfig; integration?: Partial<WorkerDeps>; publicLimits?: { lesenProMinute?: number; schreibenProMinute?: number; lesenProIp?: number; schreibenProIp?: number };
  /** Wird fuer jede registrierte Route aufgerufen (Dokumentation: npm run api:routen). */
  beiRoute?: (methode: string, url: string) => void;
};

export function buildApp(pool: pg.Pool, opts: AppOptionen = {}): FastifyInstance {
  // TRUST_PROXY: hinter Azure/Reverse-Proxy die echte Client-IP fuer das Rate-Limit verwenden ("true" oder Anzahl Hops)
  const tp = process.env.TRUST_PROXY;
  const app = Fastify({ logger: false, trustProxy: tp === 'true' ? true : tp && /^\d+$/.test(tp) ? Number(tp) : false });
  // Unerwartete Fehler nie mit Interna (SQL, SQLSTATE, Stack) beantworten (Security-Review Befund 2)
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) console.error(err);
    return reply.code(500).send({ error: 'Interner Fehler' });
  });
  if (opts.beiRoute) app.addHook('onRoute', (r) => { for (const m of [r.method].flat()) opts.beiRoute!(m, r.url); });
  registriereAuth(app, pool, opts.auth ?? authKonfigAusEnv());
  registrierePublicSchutz(app, pool, opts.publicLimits);
  // Integrationsabhaengigkeiten erst bei Bedarf aus der Umgebung lesen (Tests injizieren Fakes)
  let deps: WorkerDeps | undefined;
  const integration = (): WorkerDeps => (deps ??= {
    moodle: opts.integration?.moodle !== undefined ? opts.integration.moodle : moodleAusEnv(),
    mail: opts.integration?.mail ?? mailAusEnv(), fetch: opts.integration?.fetch,
    moodleTiming: opts.integration?.moodleTiming, ereignisMails: opts.integration?.ereignisMails,
    pruefeWebhookZiel: opts.integration?.pruefeWebhookZiel,
  });
  app.get('/health', async () => ({ ok: true }));
  registriereStatisch(app);
  app.get('/admin/ping', { preHandler: requireAdmin }, async () => ({ ok: true }));
  registerAuftraggeberRoutes(app, pool);
  registerProjektRoutes(app, pool);
  registerRechnungRoutes(app, pool);
  registerDebitorRoutes(app, pool);
  registerPersonalRoutes(app, pool);
  registerCrmRoutes(app, pool);
  registerPmRoutes(app, pool);
  registerIntegrationRoutes(app, pool, integration);
  registerPublicRoutes(app, pool);
  registerBildungRoutes(app, pool);
  registerSaqRoutes(app, pool);
  registerMahnwesenRoutes(app, pool);
  registerSaqVerrechnungRoutes(app, pool);
  registerStammdatenRoutes(app, pool);
  return app;
}

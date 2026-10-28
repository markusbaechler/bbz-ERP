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

export type AppOptionen = { auth?: AuthKonfig; integration?: Partial<WorkerDeps>; publicLimits?: { lesenProMinute?: number; schreibenProMinute?: number } };

export function buildApp(pool: pg.Pool, opts: AppOptionen = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registriereAuth(app, pool, opts.auth ?? authKonfigAusEnv());
  registrierePublicSchutz(app, pool, opts.publicLimits);
  // Integrationsabhaengigkeiten erst bei Bedarf aus der Umgebung lesen (Tests injizieren Fakes)
  let deps: WorkerDeps | undefined;
  const integration = (): WorkerDeps => (deps ??= {
    moodle: opts.integration?.moodle !== undefined ? opts.integration.moodle : moodleAusEnv(),
    mail: opts.integration?.mail ?? mailAusEnv(), fetch: opts.integration?.fetch,
    moodleTiming: opts.integration?.moodleTiming, ereignisMails: opts.integration?.ereignisMails,
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
  return app;
}

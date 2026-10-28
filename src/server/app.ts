import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { registriereAuth, authKonfigAusEnv, type AuthKonfig } from './authHook';
import { requireAdmin } from './auth';
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
import { registerRechnungRoutes } from './routes/rechnung';
import { registerDebitorRoutes } from './routes/debitor';
import { registerPersonalRoutes } from './routes/personal';

export function buildApp(pool: pg.Pool, opts: { auth?: AuthKonfig } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registriereAuth(app, pool, opts.auth ?? authKonfigAusEnv());
  app.get('/health', async () => ({ ok: true }));
  app.get('/admin/ping', { preHandler: requireAdmin }, async () => ({ ok: true }));
  registerAuftraggeberRoutes(app, pool);
  registerProjektRoutes(app, pool);
  registerRechnungRoutes(app, pool);
  registerDebitorRoutes(app, pool);
  registerPersonalRoutes(app, pool);
  return app;
}

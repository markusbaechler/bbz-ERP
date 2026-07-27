import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from './auth';
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
import { registerRechnungRoutes } from './routes/rechnung';

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('rolle', 'standard');
  app.addHook('onRequest', async (req) => {
    // Platzhalter fuer Entra-ID/MSAL: Rolle vorerst aus Header. Echte Token-Verifikation folgt (Spec §3).
    const h = req.headers['x-user-role'];
    req.rolle = h === 'admin' ? 'admin' : 'standard';
  });
  app.get('/admin/ping', { preHandler: requireAdmin }, async () => ({ ok: true }));
  registerAuftraggeberRoutes(app, pool);
  registerProjektRoutes(app, pool);
  registerRechnungRoutes(app, pool);
  return app;
}

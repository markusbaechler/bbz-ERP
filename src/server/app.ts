import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from './auth';
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
import { registerRechnungRoutes } from './routes/rechnung';
import { registerDebitorRoutes } from './routes/debitor';
import { registerPersonalRoutes } from './routes/personal';
import { registerSaqRoutes } from './routes/saq';

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('rolle', 'standard');
  app.decorateRequest('benutzer', null);
  app.addHook('onRequest', async (req) => {
    // Platzhalter fuer Entra-ID/MSAL: Rolle vorerst aus Header. Echte Token-Verifikation folgt (Spec §3).
    const h = req.headers['x-user-role'];
    req.rolle = h === 'admin' ? 'admin' : 'standard';
    const u = req.headers['x-user'];
    req.benutzer = typeof u === 'string' && u.trim() ? u.trim() : null;
  });
  app.get('/admin/ping', { preHandler: requireAdmin }, async () => ({ ok: true }));
  registerAuftraggeberRoutes(app, pool);
  registerProjektRoutes(app, pool);
  registerRechnungRoutes(app, pool);
  registerDebitorRoutes(app, pool);
  registerPersonalRoutes(app, pool);
  registerSaqRoutes(app, pool);
  return app;
}

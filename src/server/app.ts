import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { requireAdmin } from './auth';
import { registerAuftraggeberRoutes } from './routes/auftraggeber';
import { registerProjektRoutes } from './routes/projekt';
import { registerRechnungRoutes } from './routes/rechnung';
import { registerDebitorRoutes } from './routes/debitor';
import { registerZaehlerRoutes } from './routes/zaehler';

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
  registerDebitorRoutes(app, pool);
  registerZaehlerRoutes(app, pool);
  // Nach den API-Routen registriert, damit diese Vorrang vor gleichnamigen
  // Dateien in public/ behalten.
  app.register(fastifyStatic, {
    root: join(dirname(fileURLToPath(import.meta.url)), '../../public'),
    prefix: '/',
  });
  return app;
}

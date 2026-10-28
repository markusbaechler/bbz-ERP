import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { createProjekt, listProjekte, getProjektById } from '../../repos/projektRepo';
import { PROJEKT_STATUS, type ProjektStatus } from '../../domain/pmTypes';
import { queryListe, queryZahl } from './pm';

// PM-Erweiterungen (PATCH, Status, Fortsetzen, Cockpit, Portfolio ...) liegen in routes/pm.ts.
// Hinweis: /projekt/portfolio (statisch) hat in Fastify Vorrang vor /projekt/:id.
export function registerProjektRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/projekt', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const p = await createProjekt(pool, req.body as any);
      return reply.code(201).send(p);
    } catch (e) { return sendError(reply, e); }
  });
  app.get('/projekt', async (req, reply) => {
    try {
      const q = req.query as any;
      return await listProjekte(pool, {
        jahr: queryZahl(q.jahr, 'jahr'), auftraggeberId: q.auftraggeberId || undefined,
        status: queryListe<ProjektStatus>(q.status, 'status', PROJEKT_STATUS), projektleitungId: q.projektleitungId || undefined,
      });
    } catch (e) { return sendError(reply, e); }
  });
  app.get('/projekt/:id', async (req, reply) => {
    try {
      return await getProjektById(pool, (req.params as any).id);
    } catch (e) { return sendError(reply, e); }
  });
}

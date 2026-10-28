import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../auth';
import { sendError } from '../http';
import { createApiClient, listApiClients, updateApiClient, rotiereApiClient } from '../../repos/apiClientRepo';
import { listOutbox, wiederholen, publiziere } from '../../repos/outboxRepo';
import { standardHandler, verarbeiteOutbox, type WorkerDeps } from '../../integrations/worker';
import { MoodleFehler } from '../../integrations/moodle/client';
import { abschlussSync } from '../../integrations/moodle/sync';
import { importiereBuchungen, importiereKursdatenBericht, liesBuchungenCsv, type MoodleBuchung } from '../../integrations/moodle/buchungen';
import { pruefeSignatur, pruefeWebhookUrlSyntax } from '../../integrations/webhooks';
import { markiereAbgeschlossen } from '../../repos/anmeldungRepo';
import { findeDurchfuehrungPerMoodleSession, anmeldungenZuMoodleAbschluss } from '../../repos/zuordnungRepo';
import { ValidationError } from '../../domain/errors';

/** Web-Service-Funktionen, die der Moodle-Token freigeben muss (Spec v2 §6.2). */
export const MOODLE_FUNKTIONEN = [
  'core_webservice_get_site_info', 'core_user_get_users_by_field', 'core_user_create_users', 'enrol_manual_enrol_users',
  'enrol_manual_unenrol_users', 'core_completion_get_course_completion_status', 'core_enrol_get_enrolled_users',
];

const EREIGNISSE = ['*', 'kurs.aktualisiert', 'anmeldung.eingegangen', 'anmeldung.bestaetigt', 'anmeldung.storniert',
  'anmeldung.warteliste', 'anmeldung.nachgerueckt', 'saq.angemeldet', 'test.ping'];

export function registerIntegrationRoutes(app: FastifyInstance, pool: pg.Pool, deps: () => WorkerDeps): void {
  // --- API-Clients (Homepage, Zapier, Moodle-Events)
  app.get('/admin/api-clients', { preHandler: requireAdmin }, async () => listApiClients(pool));
  app.post('/admin/api-clients', { preHandler: requireAdmin }, async (req, reply) => {
    try { return reply.code(201).send(await createApiClient(pool, req.body as any)); } catch (e) { return sendError(reply, e); }
  });
  app.patch('/admin/api-clients/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await updateApiClient(pool, (req.params as any).id, req.body as any); } catch (e) { return sendError(reply, e); }
  });
  app.post('/admin/api-clients/:id/rotieren', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await rotiereApiClient(pool, (req.params as any).id); } catch (e) { return sendError(reply, e); }
  });

  // --- Webhook-Abos
  app.get('/admin/webhooks', { preHandler: requireAdmin }, async () =>
    (await pool.query('select id, name, url, ereignisse, aktiv, erstellt_am from webhook_abo order by name')).rows
      .map((r: any) => ({ id: r.id, name: r.name, url: r.url, ereignisse: r.ereignisse, aktiv: r.aktiv })));
  app.post('/admin/webhooks', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const b = req.body as { name?: string; url?: string; ereignisse?: string[] };
      if (!b?.name?.trim()) throw new ValidationError('name ist Pflicht');
      try { pruefeWebhookUrlSyntax(b.url ?? ''); } catch (e) { throw new ValidationError((e as Error).message); }
      const unbekannt = (b.ereignisse ?? []).filter((x) => !EREIGNISSE.includes(x));
      if (!b.ereignisse?.length || unbekannt.length) throw new ValidationError(`ereignisse aus: ${EREIGNISSE.join(', ')}`);
      const secret = randomBytes(24).toString('base64url');
      const r = await pool.query('insert into webhook_abo(name,url,secret,ereignisse) values ($1,$2,$3,$4) returning id',
        [b.name.trim(), b.url, secret, b.ereignisse]);
      // Das Secret wird nur bei der Anlage angezeigt (Empfaenger braucht es zur Signaturpruefung).
      return reply.code(201).send({ id: r.rows[0].id, secret });
    } catch (e) { return sendError(reply, e); }
  });
  app.patch('/admin/webhooks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body as { aktiv?: boolean };
    const r = await pool.query('update webhook_abo set aktiv=coalesce($2,aktiv) where id=$1 returning id', [(req.params as any).id, b?.aktiv ?? null]);
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: 'Webhook nicht gefunden' });
  });
  app.delete('/admin/webhooks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await pool.query('delete from webhook_abo where id=$1', [(req.params as any).id]);
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'Webhook nicht gefunden' });
  });
  app.post('/admin/webhooks/test', { preHandler: requireAdmin }, async () => ({ outboxId: await publiziere(pool, 'test.ping', { gesendetVon: 'bbz-erp' }) }));

  // --- Outbox-Monitor
  app.get('/admin/outbox', { preHandler: requireAdmin }, async (req) => {
    const q = req.query as any;
    return listOutbox(pool, { status: q.status, typ: q.typ, limit: q.limit ? Math.min(Number(q.limit), 500) : 100 });
  });
  app.get('/admin/outbox/statistik', { preHandler: requireAdmin }, async () =>
    (await pool.query(`select typ, status, count(*)::int as anzahl from outbox group by typ, status order by typ, status`)).rows);
  app.post('/admin/outbox/:id/wiederholen', { preHandler: requireAdmin }, async (req) => { await wiederholen(pool, Number((req.params as any).id)); return { ok: true }; });
  /** Manueller Anstoss (Betrieb ohne separaten Worker-Prozess, Tests). */
  app.post('/admin/outbox/verarbeiten', { preHandler: requireAdmin }, async () => verarbeiteOutbox(pool, standardHandler(pool, deps()), 100));

  // --- Integrationslaeufe
  app.get('/admin/integration/laeufe', { preHandler: requireAdmin }, async (req) => {
    const typ = (req.query as any).typ;
    const r = await pool.query(`select * from integration_lauf ${typ ? 'where typ=$1' : ''} order by id desc limit 50`, typ ? [typ] : []);
    return r.rows.map((x: any) => ({ id: Number(x.id), typ: x.typ, gestartetAm: x.gestartet_am, beendetAm: x.beendet_am, status: x.status, ergebnis: x.ergebnis }));
  });

  // --- Moodle: Kursabschluesse holen (Cron/Button)
  app.post('/integration/moodle/abschluss-sync', { preHandler: requireAdmin }, async (req, reply) => {
    const m = deps().moodle;
    if (!m) return reply.code(409).send({ error: 'Moodle ist nicht konfiguriert' });
    return abschlussSync(pool, m, async (p, id, zeit) => { await markiereAbgeschlossen(p, id, zeit, 'moodle', req.benutzer); },
      { durchfuehrungId: (req.body as any)?.durchfuehrungId });
  });

  // --- Moodle: Face-to-Face-Buchungen einer Session uebernehmen (CSV-Export oder JSON)
  app.post('/integration/moodle/buchungen', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const b = (req.body ?? {}) as { durchfuehrungId?: string; moodleSessionId?: number; csv?: string; buchungen?: MoodleBuchung[] };
      const durchfuehrungId = b.durchfuehrungId ?? (b.moodleSessionId ? await findeDurchfuehrungPerMoodleSession(pool, Number(b.moodleSessionId)) : null);
      if (!durchfuehrungId) throw new ValidationError('durchfuehrungId oder bekannte moodleSessionId angeben');
      const buchungen = b.csv ? liesBuchungenCsv(b.csv) : b.buchungen ?? [];
      if (!buchungen.length) throw new ValidationError('Keine Buchungen (csv oder buchungen[])');
      return await importiereBuchungen(pool, durchfuehrungId, buchungen, req.benutzer);
    } catch (e) { return sendError(reply, e); }
  });
  // Moodle-Bericht "Anmeldungen Kursdaten V2" (CSV, alle Termine) – Zuordnung ueber die Seminarnummer
  app.post('/integration/moodle/kursdaten', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const csv = (req.body as any)?.csv;
      if (typeof csv !== 'string' || !csv.trim()) throw new ValidationError('csv fehlt');
      return await importiereKursdatenBericht(pool, csv, req.benutzer);
    } catch (e) { return sendError(reply, e); }
  });

  // --- Moodle-Ereignisse (Push, optional): signiert wie ausgehende Webhooks, Secret MOODLE_EVENT_SECRET.
  // Eigener Plugin-Kontext: JSON wird als Rohtext gelesen, damit die HMAC-Signatur ueber die Originalbytes laeuft.
  app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as any).rohKoerper = body;
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (e) { done(e as Error, undefined); }
    });
    sub.post('/integration/moodle/events', async (req, reply) => {
      const secret = process.env.MOODLE_EVENT_SECRET;
      if (!secret) return reply.code(404).send({ error: 'Moodle-Ereignisse nicht aktiviert' });
      if (!pruefeSignatur(secret, req.headers['x-bbz-signature'] as string, req.headers['x-bbz-timestamp'] as string, (req as any).rohKoerper ?? '')) {
        return reply.code(401).send({ error: 'Signatur ungueltig' });
      }
      const e = req.body as { eventname?: string; courseid?: number; relateduserid?: number; userid?: number; timecreated?: number };
      if (e.eventname !== '\\core\\event\\course_completed') return { verarbeitet: 0, hinweis: 'Ereignis ignoriert' };
      const ids = await anmeldungenZuMoodleAbschluss(pool, Number(e.courseid), Number(e.relateduserid ?? e.userid));
      for (const id of ids) await markiereAbgeschlossen(pool, id, e.timecreated ? new Date(e.timecreated * 1000) : new Date(), 'moodle');
      return { verarbeitet: ids.length };
    });
  });

  // --- Moodle-Status: Erreichbarkeit, Version, freigegebene Funktionen
  app.get('/integration/moodle/status', { preHandler: requireAdmin }, async (req, reply) => {
    const m = deps().moodle;
    if (!m) return { konfiguriert: false, hinweis: 'MOODLE_URL und MOODLE_TOKEN setzen (Web-Service-Token von cometas)' };
    try {
      const info = await m.siteInfo();
      const vorhanden = new Set(info.functions.map((f) => f.name));
      return {
        konfiguriert: true, erreichbar: true, site: info.sitename, release: info.release, version: info.version,
        fehlendeFunktionen: MOODLE_FUNKTIONEN.filter((f) => !vorhanden.has(f)),
        faceToFaceFunktionen: info.functions.map((f) => f.name).filter((n) => /facetoface|f2f/i.test(n)),
      };
    } catch (e) {
      return reply.code(502).send({ konfiguriert: true, erreichbar: false, fehler: e instanceof MoodleFehler ? e.message : String(e) });
    }
  });
}


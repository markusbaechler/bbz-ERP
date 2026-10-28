import { buildApp } from './app';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { moodleAusEnv } from '../integrations/moodle/client';
import { mailAusEnv } from '../integrations/mail';
import { standardHandler, starteWorker } from '../integrations/worker';

/*
 * Server-Start. Optionen (Umgebung):
 *  MIGRATE_ON_START=true   Migrationen beim Start anwenden (einfacher Betrieb mit einer Instanz)
 *  WORKER_IM_SERVER=true   Outbox-Worker im selben Prozess (sonst separat: npm run worker)
 */
const pool = getPool();
if (process.env.MIGRATE_ON_START === 'true') await runMigrations(pool);
const app = buildApp(pool);
const stopWorker = process.env.WORKER_IM_SERVER === 'true'
  ? starteWorker(pool, standardHandler(pool, { moodle: moodleAusEnv(), mail: mailAusEnv() }), Number(process.env.WORKER_INTERVALL_MS ?? 15000))
  : () => {};
const adresse = await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
console.log(`bbz-erp hoert auf ${adresse}${process.env.WORKER_IM_SERVER === 'true' ? ' (mit Worker)' : ''}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { stopWorker(); await app.close(); await closePool(); process.exit(0); });
}

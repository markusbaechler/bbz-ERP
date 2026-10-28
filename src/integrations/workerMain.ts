// Worker-Prozess: `npm run worker` – arbeitet die Outbox ab (Moodle, Webhooks, Mail).
import { getPool } from '../db/pool';
import { moodleAusEnv } from './moodle/client';
import { mailAusEnv } from './mail';
import { standardHandler, starteWorker } from './worker';

const pool = getPool();
const stop = starteWorker(pool, standardHandler(pool, { moodle: moodleAusEnv(), mail: mailAusEnv() }), Number(process.env.WORKER_INTERVALL_MS ?? 15000));
console.log('bbz-erp worker gestartet');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stop(); void pool.end().then(() => process.exit(0)); });

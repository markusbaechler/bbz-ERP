// Cron-Job: `npm run moodle:abschluss` – holt Kursabschluesse aus Moodle (z. B. naechtlich).
import { getPool, closePool } from '../../db/pool';
import { moodleAusEnv } from './client';
import { abschlussSync } from './sync';
import { markiereAbgeschlossen } from '../../repos/anmeldungRepo';

const moodle = moodleAusEnv();
if (!moodle) { console.error('MOODLE_URL/MOODLE_TOKEN fehlen'); process.exit(1); }
const pool = getPool();
try {
  const r = await abschlussSync(pool, moodle, async (p, id, zeit) => { await markiereAbgeschlossen(p, id, zeit, 'moodle', 'cron'); });
  console.log(`Moodle-Abschluss: ${r.geprueft} geprueft, ${r.abgeschlossen} abgeschlossen, ${r.ohneKriterien} ohne Abschlusskriterien, ${r.fehler.length} Fehler`);
  if (r.fehler.length) process.exitCode = 2;
} finally {
  await closePool();
}

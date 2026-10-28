import type pg from 'pg';
import { holeFaellige, markiereErledigt, markiereFehler, type OutboxEintrag } from '../repos/outboxRepo';
import type { MoodleClient } from './moodle/client';
import type { MailAdapter } from './mail';
import { moodleEinschreiben, moodleAusschreiben, type MoodleTiming } from './moodle/sync';
import { verteileEreignis, stelleZu } from './webhooks';
import { rendereMail } from './mailVorlagen';

export type Handler = (e: OutboxEintrag) => Promise<unknown>;

export type WorkerDeps = { moodle: MoodleClient | null; mail: MailAdapter; fetch?: typeof fetch; moodleTiming?: MoodleTiming;
  /** Fachereignis -> automatische Mail (z. B. anmeldung.bestaetigt -> anmeldebestaetigung) */
  ereignisMails?: Record<string, string>;
  /** SSRF-Schutz fuer Webhook-Ziele (Default: DNS-Pruefung; Tests injizieren einen Stub) */
  pruefeWebhookZiel?: (url: string) => Promise<void> };

/** Ereignisse, die zusaetzlich zu Webhooks eine Mail an die betroffene Person ausloesen. */
export const EREIGNIS_MAILS: Record<string, string> = {
  'anmeldung.bestaetigt': 'anmeldebestaetigung',
  'anmeldung.warteliste': 'warteliste',
  'anmeldung.nachgerueckt': 'nachgerueckt',
};

export function standardHandler(pool: pg.Pool, deps: WorkerDeps): Record<string, Handler> {
  const ereignisMails = deps.ereignisMails ?? EREIGNIS_MAILS;
  return {
    'moodle.einschreiben': (e) => moodleEinschreiben(pool, deps.moodle, e.payload.anmeldungId ?? e.aggregatId, deps.moodleTiming),
    'moodle.ausschreiben': (e) => moodleAusschreiben(pool, deps.moodle, e.payload.anmeldungId ?? e.aggregatId),
    webhook: async (e) => {
      const n = await verteileEreignis(pool, e);
      const vorlage = ereignisMails[e.payload.ereignis];
      const anmeldungId = e.payload.daten?.anmeldungId;
      // In Moodle gebuchte Anmeldungen erhalten die Bestaetigung von Moodle selbst (keine Doppel-Mail).
      const ausMoodle = anmeldungId && (await pool.query(`select 1 from anmeldung where id=$1 and quelle='moodle'`, [anmeldungId])).rowCount;
      if (vorlage && anmeldungId && !ausMoodle) {
        await pool.query(`insert into outbox(typ, aggregat_id, payload) values ('mail', $1, $2)`,
          [anmeldungId, JSON.stringify({ vorlage, an: null, daten: { anmeldungId } })]);
      }
      return n;
    },
    'webhook.zustellung': (e) => stelleZu(pool, e, { fetch: deps.fetch, pruefeZiel: deps.pruefeWebhookZiel }),
    mail: async (e) => deps.mail.sende(await rendereMail(pool, e.payload.vorlage, e.payload.daten ?? {}, e.payload.an ?? null)),
  };
}

export async function verarbeiteOutbox(pool: pg.Pool, handlers: Record<string, Handler>, limit = 20): Promise<{ erledigt: number; fehler: number }> {
  let erledigt = 0; let fehler = 0;
  for (const e of await holeFaellige(pool, limit)) {
    const h = handlers[e.typ];
    try {
      if (!h) throw new Error(`Kein Handler fuer Outbox-Typ "${e.typ}"`);
      await h(e);
      await markiereErledigt(pool, e.id); erledigt++;
    } catch (err) {
      await markiereFehler(pool, e, (err as Error).message); fehler++;
    }
  }
  return { erledigt, fehler };
}

/** Endlosschleife fuer den Worker-Prozess; gibt eine Stop-Funktion zurueck. */
export function starteWorker(pool: pg.Pool, handlers: Record<string, Handler>, intervallMs = 15000, log: (s: string) => void = console.log): () => void {
  let aktiv = true; let timer: NodeJS.Timeout | undefined;
  const runde = async () => {
    if (!aktiv) return;
    try {
      let r;
      do { r = await verarbeiteOutbox(pool, handlers); if (r.erledigt || r.fehler) log(`outbox: ${r.erledigt} erledigt, ${r.fehler} Fehler`); }
      while (aktiv && r.erledigt + r.fehler > 0);
    } catch (e) { log(`outbox-worker: ${(e as Error).message}`); }
    if (aktiv) timer = setTimeout(runde, intervallMs);
  };
  void runde();
  return () => { aktiv = false; if (timer) clearTimeout(timer); };
}

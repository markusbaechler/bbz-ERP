import { createHmac, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { enqueue, type OutboxEintrag } from '../repos/outboxRepo';

/*
 * Ausgehende Webhooks (Spec v2 §6.1). Signatur nach dem Muster von Stripe/GitHub:
 *   x-bbz-signature: sha256=<hex(HMAC_SHA256(secret, "<timestamp>.<body>"))>
 *   x-bbz-timestamp: Unix-Sekunden (Replay-Schutz beim Empfaenger, Toleranz 5 Min.)
 */

export function signiere(secret: string, timestamp: number, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function pruefeSignatur(secret: string, signatur: string | undefined, timestamp: string | number | undefined, body: string,
  opts: { toleranzSek?: number; jetzt?: number } = {}): boolean {
  if (!signatur || timestamp === undefined) return false;
  const ts = Number(timestamp);
  const jetzt = opts.jetzt ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(jetzt - ts) > (opts.toleranzSek ?? 300)) return false;
  const soll = Buffer.from(signiere(secret, ts, body));
  const ist = Buffer.from(signatur);
  return soll.length === ist.length && timingSafeEqual(soll, ist);
}

/** Outbox "webhook": verteilt ein Ereignis auf alle aktiven Abos (je Abo eigener Auftrag -> eigene Wiederholung). */
export async function verteileEreignis(pool: pg.Pool, e: OutboxEintrag): Promise<number> {
  const { ereignis, daten } = e.payload ?? {};
  if (!ereignis) throw new Error('webhook ohne ereignis');
  const abos = await pool.query(
    `select id from webhook_abo where aktiv and ($1 = any(ereignisse) or '*' = any(ereignisse))`, [ereignis]);
  for (const a of abos.rows) await enqueue(pool, 'webhook.zustellung', null, { aboId: a.id, ereignis, daten, ereignisId: e.id });
  return abos.rowCount ?? 0;
}

/** Outbox "webhook.zustellung": POST an die Abo-URL; jede Nicht-2xx-Antwort fuehrt zur Wiederholung. */
export async function stelleZu(pool: pg.Pool, e: OutboxEintrag, opts: { fetch?: typeof fetch; jetzt?: number } = {}): Promise<void> {
  const r = await pool.query('select * from webhook_abo where id=$1', [e.payload.aboId]);
  if (!r.rowCount || !r.rows[0].aktiv) return;              // Abo geloescht/deaktiviert -> nichts mehr zu tun
  const abo = r.rows[0];
  const ts = opts.jetzt ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: e.payload.ereignisId, ereignis: e.payload.ereignis, zeitpunkt: new Date(ts * 1000).toISOString(), daten: e.payload.daten ?? {} });
  const res = await (opts.fetch ?? fetch)(abo.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': 'bbz-erp-webhooks/1',
      'x-bbz-ereignis': e.payload.ereignis, 'x-bbz-zustellung': String(e.id),
      'x-bbz-timestamp': String(ts), 'x-bbz-signature': signiere(abo.secret, ts, body),
    },
    body, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Webhook ${abo.name}: HTTP ${res.status}`);
}

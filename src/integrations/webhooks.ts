import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

/** Private, Loopback-, Link-Local- und CGNAT-Adressen (IPv4/IPv6) – keine Webhook-Ziele (SSRF, Security-Review Befund 7). */
export function istPrivateAdresse(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const n = ip.toLowerCase();
  return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80');
}

/** Syntaktische Pruefung beim Anlegen: nur https, kein localhost, keine private IP-Literale. */
export function pruefeWebhookUrlSyntax(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('url ist keine gueltige URL'); }
  if (u.protocol !== 'https:') throw new Error('url muss mit https:// beginnen');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && istPrivateAdresse(host))) throw new Error('url darf nicht auf interne Adressen zeigen');
}

/** Vor jeder Zustellung: DNS aufloesen, keine internen Ziele. */
export async function pruefeWebhookZiel(url: string): Promise<void> {
  pruefeWebhookUrlSyntax(url);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const adressen = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (adressen.some((a) => istPrivateAdresse(a.address))) throw new Error('Webhook-Ziel loest auf eine interne Adresse auf');
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
export async function stelleZu(pool: pg.Pool, e: OutboxEintrag, opts: { fetch?: typeof fetch; jetzt?: number; pruefeZiel?: (url: string) => Promise<void> } = {}): Promise<void> {
  const r = await pool.query('select * from webhook_abo where id=$1', [e.payload.aboId]);
  if (!r.rowCount || !r.rows[0].aktiv) return;              // Abo geloescht/deaktiviert -> nichts mehr zu tun
  const abo = r.rows[0];
  await (opts.pruefeZiel ?? pruefeWebhookZiel)(abo.url);
  const ts = opts.jetzt ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: e.payload.ereignisId, ereignis: e.payload.ereignis, zeitpunkt: new Date(ts * 1000).toISOString(), daten: e.payload.daten ?? {} });
  const res = await (opts.fetch ?? fetch)(abo.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': 'bbz-erp-webhooks/1',
      'x-bbz-ereignis': e.payload.ereignis, 'x-bbz-zustellung': String(e.id),
      'x-bbz-timestamp': String(ts), 'x-bbz-signature': signiere(abo.secret, ts, body),
    },
    body, signal: AbortSignal.timeout(10000), redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) throw new Error(`Webhook ${abo.name}: Weiterleitungen werden nicht befolgt (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`Webhook ${abo.name}: HTTP ${res.status}`);
}

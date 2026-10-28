/*
 * Mail-Versand (Spec v2 §6.3): Microsoft Graph sendMail (M365, Client Credentials) oder Protokoll-Adapter
 * (Entwicklung/Tests). Versand ausschliesslich ueber die Outbox (Typ "mail") -> Wiederholung bei Fehlern.
 */
export type Anhang = { name: string; typ: string; inhalt: Buffer };
export type Mail = { an: string; betreff: string; text: string; html?: string; cc?: string[]; anhaenge?: Anhang[] };

export interface MailAdapter { sende(m: Mail): Promise<void> }

export class ProtokollMailAdapter implements MailAdapter {
  readonly gesendet: Mail[] = [];
  async sende(m: Mail): Promise<void> { this.gesendet.push(m); }
}

export type GraphKonfig = { tenantId: string; clientId: string; clientSecret: string; absender: string; fetch?: typeof fetch };

export class GraphMailAdapter implements MailAdapter {
  private token: { wert: string; bis: number } | null = null;
  private readonly f: typeof fetch;
  constructor(private readonly k: GraphKonfig) { this.f = k.fetch ?? fetch; }

  private async zugriffstoken(): Promise<string> {
    if (this.token && this.token.bis > Date.now() + 60_000) return this.token.wert;
    const res = await this.f(`https://login.microsoftonline.com/${this.k.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.k.clientId, client_secret: this.k.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error(`Graph-Token: HTTP ${res.status}`);
    const j = await res.json() as { access_token: string; expires_in: number };
    this.token = { wert: j.access_token, bis: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async sende(m: Mail): Promise<void> {
    const res = await this.f(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.k.absender)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.zugriffstoken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: m.betreff,
          body: m.html ? { contentType: 'HTML', content: m.html } : { contentType: 'Text', content: m.text },
          toRecipients: [{ emailAddress: { address: m.an } }],
          ccRecipients: (m.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
          ...(m.anhaenge?.length ? { attachments: m.anhaenge.map((a) => ({
            '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.typ, contentBytes: a.inhalt.toString('base64'),
          })) } : {}),
        },
        saveToSentItems: true,
      }),
    });
    if (res.status !== 202 && !res.ok) throw new Error(`Graph sendMail: HTTP ${res.status}`);
  }
}

export function mailAusEnv(env: NodeJS.ProcessEnv = process.env): MailAdapter {
  if (env.MAIL_ADAPTER === 'graph') {
    for (const k of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'MAIL_ABSENDER']) if (!env[k]) throw new Error(`MAIL_ADAPTER=graph verlangt ${k}`);
    return new GraphMailAdapter({ tenantId: env.GRAPH_TENANT_ID!, clientId: env.GRAPH_CLIENT_ID!, clientSecret: env.GRAPH_CLIENT_SECRET!, absender: env.MAIL_ABSENDER! });
  }
  return new ProtokollMailAdapter();
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { findMitarbeitendeByEntraOid, findMitarbeitendeByEmail, updateMitarbeitende } from '../repos/mitarbeitendeRepo';

/*
 * Authentifizierung (Spec v2 §4):
 *  - modus "dev"   (Default lokal/Tests): Rolle aus Header x-user-role, Kuerzel aus x-user.
 *  - modus "entra": Bearer-JWT von Entra ID (Azure AD), geprueft gegen JWKS des Tenants (Signatur, Issuer,
 *                   Audience, Ablauf). Person = mitarbeitende ueber oid (Fallback E-Mail, oid wird nachgetragen).
 *                   Admin, wenn mitarbeitende.rolle = admin ODER die App-Rolle (Claim "roles") gesetzt ist.
 * Oeffentliche Pfade (Homepage-API, Widget, PWA-Dateien, Health, signierte Moodle-Events) pruefen eigene Credentials.
 */

export type AuthKonfig =
  | { modus: 'dev' }
  | { modus: 'entra'; tenantId: string; audience: string; adminRolle?: string; jwks?: JWTVerifyGetKey; issuer?: string };

export function authKonfigAusEnv(env: NodeJS.ProcessEnv = process.env): AuthKonfig {
  if ((env.AUTH_MODE ?? 'dev') !== 'entra') {
    // Dev-Auth vertraut Headern -> in Produktion nur mit ausdruecklicher Freigabe (z. B. Demo-Instanz)
    if (env.NODE_ENV === 'production' && env.ERLAUBE_DEV_AUTH !== 'true') {
      throw new Error('AUTH_MODE=dev ist in Produktion gesperrt: AUTH_MODE=entra setzen (oder ERLAUBE_DEV_AUTH=true fuer eine Demo)');
    }
    return { modus: 'dev' };
  }
  if (!env.ENTRA_TENANT_ID || !env.ENTRA_AUDIENCE) throw new Error('AUTH_MODE=entra verlangt ENTRA_TENANT_ID und ENTRA_AUDIENCE');
  return { modus: 'entra', tenantId: env.ENTRA_TENANT_ID, audience: env.ENTRA_AUDIENCE, adminRolle: env.ENTRA_ADMIN_ROLE ?? 'bbz.admin' };
}

const OEFFENTLICH = [/^\/public\//, /^\/widget\//, /^\/app(\/|$)/, /^\/health$/, /^\/integration\/moodle\/events$/, /^\/$/];
export const istOeffentlich = (url: string) => OEFFENTLICH.some((r) => r.test(url.split('?')[0]));

declare module 'fastify' {
  interface FastifyRequest { mitarbeitendeId: string | null }
}

export function registriereAuth(app: FastifyInstance, pool: pg.Pool, konfig: AuthKonfig): void {
  app.decorateRequest('rolle', 'standard');
  app.decorateRequest('benutzer', null);
  app.decorateRequest('mitarbeitendeId', null);

  if (konfig.modus === 'dev') {
    app.addHook('onRequest', async (req) => {
      const h = req.headers['x-user-role'];
      req.rolle = h === 'admin' ? 'admin' : 'standard';
      const u = req.headers['x-user'];
      req.benutzer = typeof u === 'string' && u.trim() ? u.trim() : null;
    });
    return;
  }

  const issuer = konfig.issuer ?? `https://login.microsoftonline.com/${konfig.tenantId}/v2.0`;
  const jwks = konfig.jwks ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${konfig.tenantId}/discovery/v2.0/keys`));

  app.addHook('onRequest', async (req, reply) => {
    if (istOeffentlich(req.url)) return;
    const token = bearer(req);
    if (!token) return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'Anmeldung erforderlich' });
    let claims: JWTPayload & Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(token, jwks, { issuer, audience: konfig.audience }));
    } catch {
      return reply.code(401).header('www-authenticate', 'Bearer error="invalid_token"').send({ error: 'Token ungueltig oder abgelaufen' });
    }
    const oid = typeof claims.oid === 'string' ? claims.oid : null;
    const email = [claims.preferred_username, claims.email, claims.upn].find((x): x is string => typeof x === 'string') ?? null;
    let ma = oid ? await findMitarbeitendeByEntraOid(pool, oid) : null;
    if (!ma && email) {
      ma = await findMitarbeitendeByEmail(pool, email);
      // Ein bereits an eine andere Entra-Identitaet gebundenes Konto darf nicht ueber die E-Mail uebernommen werden
      // (wiederverwendeter UPN, Gastkonto) – Security-Review Befund 5.
      if (ma && ma.entraOid && ma.entraOid !== oid) return reply.code(403).send({ error: 'Konto ist an eine andere Entra-Identitaet gebunden' });
      if (ma && oid && !ma.entraOid) ma = await updateMitarbeitende(pool, ma.id, { entraOid: oid });
    }
    if (!ma || !ma.aktiv) return reply.code(403).send({ error: 'Kein freigeschaltetes bbz-Konto (Mitarbeitende)' });
    const rollen = Array.isArray(claims.roles) ? claims.roles : [];
    req.rolle = ma.rolle === 'admin' || rollen.includes(konfig.adminRolle ?? 'bbz.admin') ? 'admin' : 'standard';
    req.benutzer = ma.kuerzel;
    req.mitarbeitendeId = ma.id;
  });
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  return h.replace(/^Bearer\s+/i, '').trim() || null;
}

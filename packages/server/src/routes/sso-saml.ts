/**
 * SAML 2.0 SP routes (#148) — `/sso/saml/:id/{login,acs,metadata}`.
 *
 * SP-initiated: GET /login redirects to the IdP; POST /acs validates the signed
 * assertion, JIT-provisions the user (UserStore) with a group-mapped role, and
 * issues a session JWT; GET /metadata serves SP metadata. Per-connection config
 * comes from sso_connections.
 */
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AnyDb } from '../db/dialect-db.js';
import { SsoConnectionStore } from '../db/sso-connection-store.js';
import { UserStore } from '../db/user-store.js';
import { signJwt } from '../cloud/auth/jwt.js';
import { samlLoginUrl, validateSamlResponse, samlMetadata, extractSamlUser, resolveSamlRole } from '../lib/sso/saml.js';

export interface SamlRoutesConfig {
  baseUrl: string;
  sessionSecret: string;
}

export function samlRoutes(db: AnyDb, cfg: SamlRoutesConfig) {
  const app = new Hono();
  const conns = new SsoConnectionStore(db);
  const users = new UserStore(db);

  async function loadSaml(id: string) {
    const conn = await conns.getById(id);
    if (!conn || conn.type !== 'saml' || !conn.enabled) return null;
    return conn;
  }

  // SP-initiated login → redirect to the IdP.
  app.get('/:id/login', async (c) => {
    const conn = await loadSaml(c.req.param('id'));
    if (!conn) return c.json({ error: 'SAML connection not found or disabled' }, 404);
    const url = await samlLoginUrl(conn, cfg.baseUrl, c.req.query('RelayState') ?? '');
    return c.redirect(url);
  });

  // SP metadata for the IdP.
  app.get('/:id/metadata', async (c) => {
    const conn = await loadSaml(c.req.param('id'));
    if (!conn) return c.json({ error: 'SAML connection not found or disabled' }, 404);
    return c.body(samlMetadata(conn, cfg.baseUrl), 200, { 'Content-Type': 'application/xml' });
  });

  // Assertion Consumer Service — validate, JIT-provision, issue a session.
  app.post('/:id/acs', async (c) => {
    const conn = await loadSaml(c.req.param('id'));
    if (!conn) return c.json({ error: 'SAML connection not found or disabled' }, 404);

    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const samlResponse = form['SAMLResponse'];
    if (typeof samlResponse !== 'string' || !samlResponse) {
      return c.json({ error: 'Missing SAMLResponse' }, 400);
    }

    let profile;
    try {
      profile = await validateSamlResponse(conn, cfg.baseUrl, samlResponse);
    } catch {
      return c.json({ error: 'Invalid SAML assertion' }, 401);
    }
    if (!profile) return c.json({ error: 'Invalid SAML assertion' }, 401);

    const { email, displayName, groups } = extractSamlUser(profile);
    if (!email) return c.json({ error: 'SAML assertion missing email' }, 400);
    const role = resolveSamlRole(conn, groups);

    // JIT provision into the connection's org (tenant).
    const tenantId = conn.orgId;
    const existing = await users.getByEmail(tenantId, email);
    const user = existing
      ? ((await users.update(existing.id, { ...(displayName ? { displayName } : {}), role })) ?? existing)
      : await users.create({ tenantId, email, displayName, role });

    const token = signJwt({ sub: user.id, email, name: displayName ?? null, orgs: [{ org_id: conn.orgId, role }] }, cfg.sessionSecret);
    setCookie(c, 'agentlens_session', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 7 * 86400 });

    const relayState = typeof form['RelayState'] === 'string' ? (form['RelayState'] as string) : '';
    return c.redirect(relayState || '/dashboard');
  });

  return app;
}

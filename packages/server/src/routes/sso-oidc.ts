/**
 * OIDC enterprise SSO routes (#148) — `/sso/oidc/:id/{login,callback}`.
 *
 * PKCE auth-code flow per-connection (sso_connections type='oidc'). login starts
 * the flow; callback exchanges the code, maps the IdP groups/role, JIT-provisions
 * the user (UserStore), and issues a session JWT. Azure AD is just an OIDC
 * connection (issuerUrl = the tenant v2.0 endpoint).
 */
import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import type { AnyDb } from '../db/dialect-db.js';
import { SsoConnectionStore } from '../db/sso-connection-store.js';
import { UserStore } from '../db/user-store.js';
import { signJwt } from '../cloud/auth/jwt.js';
import { buildOidcClient, resolveOidcRole } from '../lib/sso/oidc.js';

export interface OidcRoutesConfig {
  baseUrl: string;
  sessionSecret: string;
}

export function oidcRoutes(db: AnyDb, cfg: OidcRoutesConfig) {
  const app = new Hono();
  const conns = new SsoConnectionStore(db);
  const users = new UserStore(db);

  async function loadOidc(id: string) {
    const conn = await conns.getById(id);
    if (!conn || conn.type !== 'oidc' || !conn.enabled) return null;
    return conn;
  }

  app.get('/:id/login', async (c) => {
    const conn = await loadOidc(c.req.param('id'));
    if (!conn) return c.json({ error: 'OIDC connection not found or disabled' }, 404);
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    let url: string;
    try {
      url = await buildOidcClient(conn, cfg.baseUrl).getAuthorizationUrl(state, codeVerifier);
    } catch {
      return c.json({ error: 'Identity provider unreachable' }, 502);
    }
    setCookie(c, `oidc_state_${conn.id}`, state, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 600 });
    setCookie(c, `oidc_verifier_${conn.id}`, codeVerifier, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 600 });
    return c.redirect(url);
  });

  app.get('/:id/callback', async (c) => {
    const conn = await loadOidc(c.req.param('id'));
    if (!conn) return c.json({ error: 'OIDC connection not found or disabled' }, 404);

    const code = c.req.query('code');
    const state = c.req.query('state');
    const savedState = getCookie(c, `oidc_state_${conn.id}`);
    const verifier = getCookie(c, `oidc_verifier_${conn.id}`);
    deleteCookie(c, `oidc_state_${conn.id}`, { path: '/' });
    deleteCookie(c, `oidc_verifier_${conn.id}`, { path: '/' });

    if (!state || !savedState || state !== savedState) return c.json({ error: 'Invalid state' }, 400);
    if (!code || !verifier) return c.json({ error: 'Missing code or PKCE verifier' }, 400);

    let claims;
    try {
      claims = (await buildOidcClient(conn, cfg.baseUrl).exchangeCode(code, verifier)).claims;
    } catch {
      return c.json({ error: 'OIDC code exchange failed' }, 401);
    }

    const email = claims.email ?? claims.sub;
    if (!email) return c.json({ error: 'OIDC claims missing email' }, 400);
    const role = resolveOidcRole(conn, claims);
    const displayName = claims.name;
    const tenantId = conn.orgId;

    const existing = await users.getByEmail(tenantId, email);
    const user = existing
      ? ((await users.update(existing.id, { ...(displayName ? { displayName } : {}), role })) ?? existing)
      : await users.create({ tenantId, email, displayName, role });

    const token = signJwt({ sub: user.id, email, name: displayName ?? null, orgs: [{ org_id: conn.orgId, role }] }, cfg.sessionSecret);
    setCookie(c, 'agentlens_session', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 7 * 86400 });
    return c.redirect('/dashboard');
  });

  return app;
}

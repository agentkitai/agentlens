/**
 * OIDC enterprise SSO (#148) — connection gating, callback validation, and the
 * IdP-group/role-claim → role resolution. The discovery/token network is
 * delegated to OidcClient (covered by @agentkitai/auth).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SsoConnectionStore, type SsoConnection } from '../../db/sso-connection-store.js';
import { oidcRoutes } from '../sso-oidc.js';
import { resolveOidcRole } from '../../lib/sso/oidc.js';
import type { OidcClaims } from '@agentkitai/auth';

let db: SqliteDb;
let store: SsoConnectionStore;
let app: Hono;
let conn: SsoConnection;

beforeEach(async () => {
  db = createTestDb();
  runMigrations(db);
  store = new SsoConnectionStore(db);
  conn = await store.create({
    orgId: 'org-1',
    type: 'oidc',
    name: 'Azure AD',
    enabled: true,
    config: { issuerUrl: 'https://login.microsoftonline.com/tid/v2.0', clientId: 'cid', clientSecret: 'sec' },
    groupRoleMappings: { 'gid-admins': 'admin' },
  });
  app = new Hono();
  app.route('/sso/oidc', oidcRoutes(db, { baseUrl: 'https://app.example.com', sessionSecret: 'sec' }));
});

describe('OIDC enterprise SSO (#148)', () => {
  it('resolveOidcRole: group mapping wins, else role claim, else viewer', () => {
    expect(resolveOidcRole(conn, { sub: 's', groups: ['gid-admins'] } as OidcClaims)).toBe('admin');
    expect(resolveOidcRole(conn, { sub: 's', role: 'member' } as OidcClaims)).toBe('member');
    expect(resolveOidcRole(conn, { sub: 's' } as OidcClaims)).toBe('viewer');
    // group mapping wins over the role claim
    expect(resolveOidcRole(conn, { sub: 's', role: 'viewer', groups: ['gid-admins'] } as OidcClaims)).toBe('admin');
  });

  it('returns 404 for unknown / disabled / wrong-type connections', async () => {
    expect((await app.request('/sso/oidc/nope/login')).status).toBe(404);
    const saml = await store.create({ orgId: 'o', type: 'saml', name: 'S', enabled: true });
    expect((await app.request(`/sso/oidc/${saml.id}/login`)).status).toBe(404); // wrong type
    await store.update(conn.id, { enabled: false });
    expect((await app.request(`/sso/oidc/${conn.id}/login`)).status).toBe(404);
  });

  it('callback rejects an invalid state (400) and a missing code (400)', async () => {
    // no state cookie → invalid state
    const badState = await app.request(`/sso/oidc/${conn.id}/callback?code=abc&state=x`);
    expect(badState.status).toBe(400);
    // matching state cookie but no code
    const withState = await app.request(`/sso/oidc/${conn.id}/callback?state=s1`, {
      headers: { Cookie: `oidc_state_${conn.id}=s1; oidc_verifier_${conn.id}=v1` },
    });
    expect(withState.status).toBe(400); // missing code
  });
});

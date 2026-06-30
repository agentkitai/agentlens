/**
 * SSO enforcement + domain verification (#148).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SsoConnectionStore, type SsoConnection } from '../../db/sso-connection-store.js';
import { ssoAdminRoutes } from '../sso-admin.js';
import { domainOf, confirmDomainVerification, enforcedConnectionForEmail } from '../../lib/sso/enforcement.js';

const BASE = 'https://app.example.com';

let db: SqliteDb;
let store: SsoConnectionStore;
let app: Hono;
let conn: SsoConnection;

beforeEach(async () => {
  db = createTestDb();
  runMigrations(db);
  store = new SsoConnectionStore(db);
  conn = await store.create({ orgId: 'org-1', type: 'saml', name: 'Okta', domain: 'acme.com' });
  app = new Hono();
  app.route('/sso', ssoAdminRoutes(db, { baseUrl: BASE }));
});

describe('SSO enforcement + domain verification (#148)', () => {
  it('domainOf extracts the email domain', () => {
    expect(domainOf('alice@Acme.com')).toBe('acme.com');
    expect(domainOf('not-an-email')).toBeNull();
  });

  it('GET /sso/enforcement: not enforced until enabled+verified+enforced', async () => {
    const before = await app.request(`/sso/enforcement?email=${encodeURIComponent('a@acme.com')}`);
    expect((await before.json()).enforced).toBe(false);

    await store.update(conn.id, { enabled: true, domainVerified: true, enforced: true });
    const after = await app.request(`/sso/enforcement?email=${encodeURIComponent('a@acme.com')}`);
    const body = await after.json();
    expect(body.enforced).toBe(true);
    expect(body.loginUrl).toBe(`${BASE}/sso/saml/${conn.id}/login`);

    // a different domain is not enforced
    expect((await (await app.request('/sso/enforcement?email=x@other.com')).json()).enforced).toBe(false);
  });

  it('domain verify-request returns a DNS TXT record and stores the token', async () => {
    const res = await app.request(`/sso/connections/${conn.id}/domain/verify-request`, { method: 'POST' });
    const body = await res.json();
    expect(body.domain).toBe('acme.com');
    expect(body.txtRecord).toMatch(/^agentlens-verify=[0-9a-f]{32}$/);
    // token persisted in the connection config
    const stored = (await store.getById(conn.id))!.config.domainVerificationToken;
    expect(body.token).toBe(stored);
  });

  it('confirmDomainVerification verifies when the DNS TXT contains the token', async () => {
    // request a token first
    const reqRes = await app.request(`/sso/connections/${conn.id}/domain/verify-request`, { method: 'POST' });
    const { token } = await reqRes.json();

    // mock resolver: wrong record → not verified
    expect(await confirmDomainVerification(store, conn.id, async () => [['some-other-record']])).toBe(false);
    expect((await store.getById(conn.id))!.domainVerified).toBe(false);

    // correct record → verified
    const ok = await confirmDomainVerification(store, conn.id, async () => [[`agentlens-verify=${token}`]]);
    expect(ok).toBe(true);
    expect((await store.getById(conn.id))!.domainVerified).toBe(true);
  });

  it('enforcedConnectionForEmail returns the connection only when fully enforced', async () => {
    expect(await enforcedConnectionForEmail(store, 'a@acme.com')).toBeNull();
    await store.update(conn.id, { enabled: true, domainVerified: true, enforced: true });
    expect((await enforcedConnectionForEmail(store, 'a@acme.com'))?.id).toBe(conn.id);
  });
});

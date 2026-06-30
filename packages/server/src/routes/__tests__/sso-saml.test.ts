/**
 * SAML 2.0 SP routes (#148) — login redirect, metadata, ACS validation, and the
 * IdP-group → role mapping.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SsoConnectionStore, type SsoConnection } from '../../db/sso-connection-store.js';
import { samlRoutes } from '../sso-saml.js';
import { extractSamlUser, resolveSamlRole } from '../../lib/sso/saml.js';
import type { Profile } from '@node-saml/node-saml';

const BASE = 'https://app.example.com';
const SECRET = 'sso-test-secret';
const ENTRY = 'https://idp.okta.com/app/sso/saml';
// A throwaway self-signed-looking cert body (only parsed when validating responses).
const DUMMY_CERT =
  'MIIDpDCCAoygAwIBAgIGAV2ka+55MA0GCSqGSIb3DQEBCwUAMIGSMQswCQYDVQQGEwJVUzETMBEG';

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
    type: 'saml',
    name: 'Okta',
    enabled: true,
    config: { entryPoint: ENTRY, idpCert: DUMMY_CERT },
    groupRoleMappings: { 'acme-admins': 'admin', 'acme-viewers': 'viewer' },
  });
  app = new Hono();
  app.route('/sso/saml', samlRoutes(db, { baseUrl: BASE, sessionSecret: SECRET }));
});

describe('SAML 2.0 SP routes (#148)', () => {
  it('GET /:id/login redirects to the IdP entryPoint', async () => {
    const res = await app.request(`/sso/saml/${conn.id}/login`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(ENTRY);
    expect(res.headers.get('location')).toContain('SAMLRequest=');
  });

  it('GET /:id/metadata returns SP metadata XML', async () => {
    const res = await app.request(`/sso/saml/${conn.id}/metadata`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    const xml = await res.text();
    expect(xml).toContain('EntityDescriptor');
    expect(xml).toContain(`${BASE}/sso/saml/${conn.id}/acs`); // ACS URL in metadata
  });

  it('POST /:id/acs rejects a missing SAMLResponse (400) and a bad one (401)', async () => {
    const missing = await app.request(`/sso/saml/${conn.id}/acs`, { method: 'POST', body: new URLSearchParams() });
    expect(missing.status).toBe(400);
    const bad = await app.request(`/sso/saml/${conn.id}/acs`, {
      method: 'POST',
      body: new URLSearchParams({ SAMLResponse: Buffer.from('<not-a-valid-response/>').toString('base64') }),
    });
    expect(bad.status).toBe(401);
  });

  it('returns 404 for an unknown or disabled connection', async () => {
    expect((await app.request('/sso/saml/nope/login')).status).toBe(404);
    await store.update(conn.id, { enabled: false });
    expect((await app.request(`/sso/saml/${conn.id}/login`)).status).toBe(404);
  });

  it('extractSamlUser + resolveSamlRole map IdP groups to a role', () => {
    const profile = {
      nameID: 'alice@acme.com',
      attributes: { displayName: 'Alice', groups: ['acme-admins'] },
    } as unknown as Profile;
    const u = extractSamlUser(profile);
    expect(u.email).toBe('alice@acme.com');
    expect(u.displayName).toBe('Alice');
    expect(u.groups).toEqual(['acme-admins']);
    expect(resolveSamlRole(conn, u.groups)).toBe('admin');
    expect(resolveSamlRole(conn, ['unknown-group'])).toBe('viewer'); // default
  });
});

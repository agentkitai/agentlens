/**
 * SCIM 2.0 provisioning (#148) — Users CRUD + bearer auth + deprovision.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { scimRoutes } from '../scim.js';

const TOKEN = 'scim-secret-token';
const TENANT = 'default';

function makeApp(db: SqliteDb) {
  const app = new Hono();
  app.route('/scim/v2', scimRoutes(db, { token: TOKEN, tenantId: TENANT }));
  return app;
}

const authed = (extra?: RequestInit): RequestInit => ({
  ...extra,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(extra?.headers ?? {}) },
});

describe('SCIM 2.0 /Users (#148)', () => {
  let app: Hono;

  beforeEach(() => {
    const db = createTestDb();
    runMigrations(db);
    app = makeApp(db);
  });

  it('rejects requests without a valid bearer token (401)', async () => {
    expect((await app.request('/scim/v2/Users')).status).toBe(401);
    expect((await app.request('/scim/v2/Users', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('provisions, fetches, filters, and deprovisions a user', async () => {
    // provision
    const created = await app.request('/scim/v2/Users', authed({
      method: 'POST',
      body: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'alice@acme.com', name: { formatted: 'Alice A' }, active: true }),
    }));
    expect(created.status).toBe(201);
    const user = await created.json();
    expect(user.userName).toBe('alice@acme.com');
    expect(user.active).toBe(true);
    expect(user.id).toBeTruthy();

    // duplicate → 409
    const dup = await app.request('/scim/v2/Users', authed({ method: 'POST', body: JSON.stringify({ userName: 'alice@acme.com' }) }));
    expect(dup.status).toBe(409);

    // fetch by id
    const got = await app.request(`/scim/v2/Users/${user.id}`, authed());
    expect(got.status).toBe(200);
    expect((await got.json()).displayName).toBe('Alice A');

    // filter by userName
    const listed = await app.request(`/scim/v2/Users?filter=${encodeURIComponent('userName eq "alice@acme.com"')}`, authed());
    const list = await listed.json();
    expect(list.totalResults).toBe(1);
    expect(list.Resources[0].userName).toBe('alice@acme.com');

    // deprovision via PATCH active:false (the standard Okta/Azure path)
    const patched = await app.request(`/scim/v2/Users/${user.id}`, authed({
      method: 'PATCH',
      body: JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] }),
    }));
    expect((await patched.json()).active).toBe(false);

    // hard delete → 204, then 404
    expect((await app.request(`/scim/v2/Users/${user.id}`, authed({ method: 'DELETE' }))).status).toBe(204);
    expect((await app.request(`/scim/v2/Users/${user.id}`, authed())).status).toBe(404);
  });

  it('exposes ServiceProviderConfig', async () => {
    const res = await app.request('/scim/v2/ServiceProviderConfig', authed());
    expect(res.status).toBe(200);
    expect((await res.json()).patch.supported).toBe(true);
  });
});

/**
 * SSO connection store (#148) — per-org SAML/OIDC config + domain enforcement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SsoConnectionStore } from '../sso-connection-store.js';

let db: SqliteDb;
let store: SsoConnectionStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new SsoConnectionStore(db);
});

describe('SsoConnectionStore (#148)', () => {
  it('creates, reads, updates, and deletes a SAML connection', async () => {
    const conn = await store.create({
      orgId: 'org-1',
      type: 'saml',
      name: 'Okta',
      domain: 'acme.com',
      config: { entityId: 'https://idp', ssoUrl: 'https://idp/sso' },
      groupRoleMappings: { 'acme-admins': 'admin', 'acme-viewers': 'viewer' },
    });
    expect(conn.type).toBe('saml');
    expect(conn.enabled).toBe(false);
    expect(conn.domainVerified).toBe(false);
    expect(conn.config.ssoUrl).toBe('https://idp/sso');

    expect((await store.getById(conn.id))?.name).toBe('Okta');
    expect((await store.listByOrg('org-1')).map((c) => c.id)).toEqual([conn.id]);

    const updated = await store.update(conn.id, { enabled: true, domainVerified: true, enforced: true });
    expect(updated?.enabled).toBe(true);
    expect(updated?.domainVerified).toBe(true);

    expect(await store.delete(conn.id)).toBe(true);
    expect(await store.getById(conn.id)).toBeUndefined();
  });

  it('getEnforcedByDomain only returns enabled+verified+enforced connections', async () => {
    const conn = await store.create({ type: 'oidc', name: 'Azure', domain: 'corp.com' });
    // not enforced yet → no match
    expect(await store.getEnforcedByDomain('corp.com')).toBeUndefined();
    await store.update(conn.id, { enabled: true, domainVerified: true, enforced: true });
    expect((await store.getEnforcedByDomain('corp.com'))?.id).toBe(conn.id);
    // a different (unverified) domain doesn't match
    expect(await store.getEnforcedByDomain('other.com')).toBeUndefined();
  });

  it('roleForGroups maps the first matching IdP group to its role', () => {
    const conn = {
      groupRoleMappings: { admins: 'admin', members: 'member' },
    } as unknown as Parameters<typeof SsoConnectionStore.roleForGroups>[0];
    expect(SsoConnectionStore.roleForGroups(conn, ['unknown', 'members'])).toBe('member');
    expect(SsoConnectionStore.roleForGroups(conn, ['nope'])).toBeNull();
  });
});

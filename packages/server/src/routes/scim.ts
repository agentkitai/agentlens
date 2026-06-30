/**
 * SCIM 2.0 provisioning endpoints (#148) — `/scim/v2`.
 *
 * Enterprise-gated (mounted only when `scimEnabled`). Bearer-token auth with the
 * configured SCIM token. Provisions/deprovisions users in the unified `users`
 * table (via the dialect-agnostic UserStore) for a single configured tenant.
 * Group provisioning + per-connection tokens are follow-up slices.
 *
 * Refs: RFC 7643 (schema) / RFC 7644 (protocol).
 */
import { Hono } from 'hono';
import type { AnyDb } from '../db/dialect-db.js';
import { UserStore, type SsoUser } from '../db/user-store.js';
import { ScimGroupStore, type ScimGroup } from '../db/scim-group-store.js';
import { OrgProjectStore } from '../db/org-project-store.js';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

interface ScimOpts {
  token: string;
  tenantId: string;
}

function scimUser(u: SsoUser): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    userName: u.email,
    name: u.displayName ? { formatted: u.displayName } : undefined,
    displayName: u.displayName,
    active: u.active,
    emails: [{ value: u.email, primary: true }],
    roles: [{ value: u.role, primary: true }],
    meta: {
      resourceType: 'User',
      created: new Date(u.createdAt * 1000).toISOString(),
      lastModified: new Date(u.updatedAt * 1000).toISOString(),
      location: `/scim/v2/Users/${u.id}`,
    },
  };
}

function scimError(detail: string, status: number) {
  return { schemas: [ERROR_SCHEMA], detail, status: String(status) };
}

/** Parse `userName eq "x@y.com"` → the email; null if not that shape. */
function parseUserNameFilter(filter: string | undefined): string | null {
  if (!filter) return null;
  const m = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
  return m ? m[1]! : null;
}

/** Parse `displayName eq "Engineers"` → the name; null if not that shape. */
function parseDisplayNameFilter(filter: string | undefined): string | null {
  if (!filter) return null;
  const m = /displayName\s+eq\s+"([^"]+)"/i.exec(filter);
  return m ? m[1]! : null;
}

function scimGroup(g: ScimGroup): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: g.id,
    displayName: g.displayName,
    members: g.memberIds.map((id) => ({ value: id })),
    meta: {
      resourceType: 'Group',
      created: g.createdAt,
      lastModified: g.updatedAt,
      location: `/scim/v2/Groups/${g.id}`,
    },
  };
}

export function scimRoutes(db: AnyDb, opts: ScimOpts) {
  const app = new Hono();
  const store = new UserStore(db);

  // Bearer-token gate for every SCIM request.
  app.use('*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!opts.token || token !== opts.token) {
      return c.json(scimError('Unauthorized', 401), 401);
    }
    await next();
  });

  // Capability discovery (minimal).
  app.get('/ServiceProviderConfig', (c) =>
    c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      filter: { supported: true, maxResults: 500 },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ name: 'OAuth Bearer Token', type: 'oauthbearertoken', primary: true }],
    }),
  );

  // List / filter users.
  app.get('/Users', async (c) => {
    const email = parseUserNameFilter(c.req.query('filter'));
    const startIndex = Math.max(Number(c.req.query('startIndex') ?? 1), 1);
    const count = Number(c.req.query('count') ?? 100);
    const { users, total } = await store.list(opts.tenantId, {
      ...(email ? { email } : {}),
      limit: count,
      offset: startIndex - 1,
    });
    return c.json({
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map(scimUser),
    });
  });

  app.get('/Users/:id', async (c) => {
    const u = await store.getById(c.req.param('id'));
    if (!u || u.tenantId !== opts.tenantId) return c.json(scimError('User not found', 404), 404);
    return c.json(scimUser(u));
  });

  // Provision a user.
  app.post('/Users', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = (body.userName as string) || ((body.emails as Array<{ value: string }>)?.[0]?.value);
    if (!email) return c.json(scimError('userName is required', 400), 400);

    const existing = await store.getByEmail(opts.tenantId, email);
    if (existing) return c.json(scimError('User already exists', 409), 409);

    const name = body.name as { formatted?: string; givenName?: string; familyName?: string } | undefined;
    const displayName =
      (body.displayName as string) ||
      name?.formatted ||
      [name?.givenName, name?.familyName].filter(Boolean).join(' ') ||
      undefined;
    const user = await store.create({ tenantId: opts.tenantId, email, displayName });
    // If the IdP sent active:false on create, reflect it.
    if (body.active === false) await store.update(user.id, { active: false });
    const final = (await store.getById(user.id))!;
    return c.json(scimUser(final), 201);
  });

  // PATCH — the standard deprovision path (active:false) + attribute updates.
  app.patch('/Users/:id', async (c) => {
    const u = await store.getById(c.req.param('id'));
    if (!u || u.tenantId !== opts.tenantId) return c.json(scimError('User not found', 404), 404);

    const body = (await c.req.json().catch(() => ({}))) as { Operations?: Array<{ op: string; path?: string; value?: unknown }> };
    const patch: { displayName?: string | null; active?: boolean } = {};
    for (const op of body.Operations ?? []) {
      if (op.op?.toLowerCase() === 'remove') continue;
      const path = op.path?.toLowerCase();
      if (path === 'active') patch.active = op.value === true || op.value === 'true';
      else if (path === 'displayname') patch.displayName = op.value as string;
      else if (!op.path && op.value && typeof op.value === 'object') {
        const v = op.value as Record<string, unknown>;
        if ('active' in v) patch.active = v.active === true || v.active === 'true';
        if ('displayName' in v) patch.displayName = v.displayName as string;
      }
    }
    const updated = await store.update(u.id, patch);
    return c.json(scimUser(updated!));
  });

  // PUT — full replace.
  app.put('/Users/:id', async (c) => {
    const u = await store.getById(c.req.param('id'));
    if (!u || u.tenantId !== opts.tenantId) return c.json(scimError('User not found', 404), 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = body.name as { formatted?: string } | undefined;
    const updated = await store.update(u.id, {
      displayName: (body.displayName as string) ?? name?.formatted ?? null,
      active: body.active === undefined ? undefined : body.active !== false,
    });
    return c.json(scimUser(updated!));
  });

  // Deprovision (hard delete).
  app.delete('/Users/:id', async (c) => {
    const u = await store.getById(c.req.param('id'));
    if (!u || u.tenantId !== opts.tenantId) return c.json(scimError('User not found', 404), 404);
    await store.delete(u.id);
    return c.body(null, 204);
  });

  // ─── Groups ───────────────────────────────────────────────
  const groups = new ScimGroupStore(db);
  const orgs = new OrgProjectStore(db);

  // Reflect SCIM group membership into org membership so groups grant access.
  async function reflectMembers(userIds: string[]): Promise<void> {
    for (const uid of userIds) {
      const u = await store.getById(uid);
      if (u && u.tenantId === opts.tenantId) await orgs.addOrgMember(opts.tenantId, uid, 'member');
    }
  }

  app.get('/Groups', async (c) => {
    const displayName = parseDisplayNameFilter(c.req.query('filter'));
    const startIndex = Math.max(Number(c.req.query('startIndex') ?? 1), 1);
    const count = Number(c.req.query('count') ?? 100);
    const { groups: list, total } = await groups.list(opts.tenantId, {
      ...(displayName ? { displayName } : {}),
      limit: count,
      offset: startIndex - 1,
    });
    return c.json({
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: list.length,
      Resources: list.map(scimGroup),
    });
  });

  app.get('/Groups/:id', async (c) => {
    const g = await groups.getById(c.req.param('id'));
    if (!g || g.tenantId !== opts.tenantId) return c.json(scimError('Group not found', 404), 404);
    return c.json(scimGroup(g));
  });

  app.post('/Groups', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const displayName = body.displayName as string;
    if (!displayName) return c.json(scimError('displayName is required', 400), 400);
    const memberIds = ((body.members as Array<{ value: string }>) ?? []).map((m) => m.value).filter(Boolean);
    const g = await groups.create({ tenantId: opts.tenantId, displayName, externalId: body.externalId as string | undefined, memberIds });
    await reflectMembers(memberIds);
    return c.json(scimGroup((await groups.getById(g.id))!), 201);
  });

  // PATCH — add/remove members (the standard Okta/Azure group-sync path) + rename.
  app.patch('/Groups/:id', async (c) => {
    const g = await groups.getById(c.req.param('id'));
    if (!g || g.tenantId !== opts.tenantId) return c.json(scimError('Group not found', 404), 404);
    const body = (await c.req.json().catch(() => ({}))) as { Operations?: Array<{ op: string; path?: string; value?: unknown }> };
    const added: string[] = [];
    for (const op of body.Operations ?? []) {
      const verb = op.op?.toLowerCase();
      const path = op.path?.toLowerCase();
      if (path === 'members') {
        const vals = (Array.isArray(op.value) ? op.value : [op.value]).map((m) => (m as { value: string })?.value).filter(Boolean);
        if (verb === 'add') for (const uid of vals) { await groups.addMember(g.id, uid); added.push(uid); }
        else if (verb === 'remove') for (const uid of vals) await groups.removeMember(g.id, uid);
      } else if (path === 'displayname' && typeof op.value === 'string') {
        await groups.update(g.id, { displayName: op.value });
      } else if (!op.path && op.value && typeof op.value === 'object' && 'displayName' in (op.value as object)) {
        await groups.update(g.id, { displayName: (op.value as { displayName: string }).displayName });
      }
    }
    await reflectMembers(added);
    return c.json(scimGroup((await groups.getById(g.id))!));
  });

  // PUT — full replace (members + name).
  app.put('/Groups/:id', async (c) => {
    const g = await groups.getById(c.req.param('id'));
    if (!g || g.tenantId !== opts.tenantId) return c.json(scimError('Group not found', 404), 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.displayName === 'string') await groups.update(g.id, { displayName: body.displayName });
    const memberIds = ((body.members as Array<{ value: string }>) ?? []).map((m) => m.value).filter(Boolean);
    await groups.setMembers(g.id, memberIds);
    await reflectMembers(memberIds);
    return c.json(scimGroup((await groups.getById(g.id))!));
  });

  app.delete('/Groups/:id', async (c) => {
    const g = await groups.getById(c.req.param('id'));
    if (!g || g.tenantId !== opts.tenantId) return c.json(scimError('Group not found', 404), 404);
    await groups.delete(g.id);
    return c.body(null, 204);
  });

  return app;
}

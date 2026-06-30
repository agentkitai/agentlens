/**
 * Projects API (#229, #240).
 *
 *   GET  /api/projects          — projects the caller can reach (JWT: via membership;
 *                                 API key: its bound project). Powers the switcher (#231).
 *   POST /api/projects/:pid/keys — mint an API key bound to a project (admin/owner).
 */
import { Hono, type Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import type { AnyDb } from '../db/dialect-db.js';
import type { SqliteDb } from '../db/index.js';
import type { UnifiedAuthVariables } from '../middleware/unified-auth.js';
import { OrgProjectStore } from '../db/org-project-store.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { hashApiKey } from '../middleware/auth.js';
import { getTenantId, getOrgId } from './tenant-helper.js';

/** Caller must be admin/owner (dev mode counts). api_keys are the sqlite control plane. */
function isAdmin(c: Context<{ Variables: UnifiedAuthVariables }>, db: SqliteDb): boolean {
  const callerKey = c.get('apiKey');
  if (callerKey?.id === 'dev') return true;
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, callerKey.id)).get();
  return !!row && (row.role === 'admin' || row.role === 'owner');
}

export function projectRoutes(anyDb: AnyDb, db: SqliteDb) {
  const app = new Hono<{ Variables: UnifiedAuthVariables }>();
  const store = new OrgProjectStore(anyDb);

  app.get('/', async (c) => {
    const auth = c.get('auth');
    // JWT users: every project they can reach (direct project membership or via org).
    if (auth?.userId) {
      return c.json({ projects: await store.listUserProjects(auth.userId) });
    }
    // API key (no user): its bound project (the key's tenant_id IS its project).
    const project = await store.getProject(getTenantId(c));
    return c.json({ projects: project ? [{ project, role: auth?.role ?? 'admin' }] : [] });
  });

  // Mint a project-bound API key: tenant_id = the project (ADR 0002). The raw key
  // is returned exactly once. Admin/owner only, and only for a project in the
  // caller's org. api_keys live in the sqlite control plane → use `db`.
  app.post('/:pid/keys', async (c) => {
    if (!isAdmin(c, db)) return c.json({ error: 'Forbidden: admin role required' }, 403);
    const pid = c.req.param('pid');
    const project = await store.getProject(pid);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.orgId !== getOrgId(c)) return c.json({ error: 'Project is not in your org' }, 403);

    const b = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = b.name?.trim() || `project-${pid}`;
    const id = ulid();
    const raw = `als_${randomBytes(32).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    db.insert(apiKeys)
      .values({ id, keyHash: hashApiKey(raw), name, scopes: JSON.stringify(['*']), createdAt: now, tenantId: pid })
      .run();

    return c.json({ id, key: raw, projectId: pid, name, createdAt: new Date(now * 1000).toISOString() }, 201);
  });

  return app;
}

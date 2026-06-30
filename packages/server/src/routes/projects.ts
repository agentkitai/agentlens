/**
 * Projects API (#229) — a caller's accessible projects.
 *
 *   GET /api/projects — projects the caller can reach (JWT: via membership;
 *   API key: its bound project). Powers the dashboard project switcher (#231).
 */
import { Hono } from 'hono';
import type { AnyDb } from '../db/dialect-db.js';
import type { UnifiedAuthVariables } from '../middleware/unified-auth.js';
import { OrgProjectStore } from '../db/org-project-store.js';
import { getTenantId } from './tenant-helper.js';

export function projectRoutes(db: AnyDb) {
  const app = new Hono<{ Variables: UnifiedAuthVariables }>();
  const store = new OrgProjectStore(db);

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

  return app;
}

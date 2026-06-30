/**
 * Resolve the active PROJECT scope for an authenticated request (#228 / ADR 0002).
 *
 * Runs after unified-auth. Two jobs:
 *  1. JWT callers may select a project via the `X-Project-Id` header (or a
 *     `:projectId` route param); membership is enforced via
 *     `OrgProjectStore.getEffectiveRole` → 403 on no access, and the effective
 *     project role is applied.
 *  2. The active project's real org is resolved (`projects.org_id`) onto
 *     `auth.orgId`, replacing the legacy `orgId == tenant_id` conflation.
 *
 * API keys are bound to their project (the key's `tenant_id` IS its project), so
 * no per-user membership check applies — the key is the credential. The data
 * isolation key remains `auth.projectId` (returned by getTenantId) throughout.
 */
import { createMiddleware } from 'hono/factory';
import { OrgProjectStore } from '../db/org-project-store.js';
import type { AnyDb } from '../db/dialect-db.js';
import type { AuthContext } from './unified-auth.js';

export function resolveProjectScope(db: AnyDb) {
  const store = new OrgProjectStore(db);
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    if (!auth) return next(); // public / self-authenticating routes

    // JWT: honor an explicit project selection, gated by membership.
    if (auth.type === 'jwt') {
      const requested = c.req.header('X-Project-Id') ?? c.req.param('projectId');
      if (requested && requested !== auth.projectId) {
        const role = auth.userId ? await store.getEffectiveRole(requested, auth.userId) : null;
        if (!role) {
          return c.json({ error: `No access to project '${requested}'` }, 403);
        }
        auth.projectId = requested;
        auth.role = role as AuthContext['role'];
      }
    }

    // Resolve the active project's real org (api-key + jwt). An unprovisioned
    // project (no projects row) leaves orgId as-is — isolation is by projectId.
    try {
      const project = await store.getProject(auth.projectId);
      if (project) auth.orgId = project.orgId;
    } catch {
      /* best-effort; isolation does not depend on org resolution */
    }

    return next();
  });
}

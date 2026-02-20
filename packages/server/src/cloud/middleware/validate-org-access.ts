/**
 * Cloud Org Validation Middleware [F6-S8]
 *
 * Validates that the :orgId URL parameter matches the authenticated user's org.
 * Returns 403 on mismatch, 401 when no auth context present.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

/**
 * Middleware that validates :orgId URL param against the authenticated user's org(s).
 *
 * Supports multi-org users by checking against auth.orgs[] array.
 * Updates effective auth.orgId to the validated URL orgId for downstream use.
 */
export function validateOrgAccess() {
  return createMiddleware(async (c, next) => {
    const urlOrgId = c.req.param('orgId');
    if (!urlOrgId) return next();

    const auth = c.get('auth' as any) as {
      orgId?: string;
      orgs?: Array<{ org_id: string }>;
    } | undefined;

    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    // Check against primary orgId
    if (auth.orgId === urlOrgId) return next();

    // Check against full org list (multi-org users)
    if (auth.orgs?.some((o) => o.org_id === urlOrgId)) {
      // Update effective orgId for downstream tenant scoping
      auth.orgId = urlOrgId;
      return next();
    }

    throw new HTTPException(403, {
      message: `Access denied: you are not a member of org '${urlOrgId}'`,
    });
  });
}

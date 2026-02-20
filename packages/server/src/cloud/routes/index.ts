/**
 * Cloud Routes — Hono adapter [F6-fix]
 *
 * Wraps framework-agnostic cloud route handlers into a Hono sub-app
 * and applies validateOrgAccess() middleware on org-scoped routes.
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../../middleware/auth.js';
import { validateOrgAccess } from '../middleware/validate-org-access.js';
import { createOrgRouteHandlers, type OrgRoutesDeps } from './org-routes.js';

export function cloudOrgRoutes(deps: OrgRoutesDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const handlers = createOrgRouteHandlers(deps);

  // Apply org access validation on all org-scoped routes
  app.use('/:orgId/*', validateOrgAccess());

  // GET /api/cloud/orgs — list user's orgs
  app.get('/', async (c) => {
    const auth = (c as any).get('auth') as { userId?: string } | undefined;
    if (!auth?.userId) return c.json({ error: 'Authentication required' }, 401);
    const result = await handlers.listOrgs(auth.userId);
    return c.json(result.body, result.status as any);
  });

  // POST /api/cloud/orgs — create a new org
  app.post('/', async (c) => {
    const auth = (c as any).get('auth') as { userId?: string } | undefined;
    if (!auth?.userId) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json();
    const result = await handlers.createOrg(auth.userId, body);
    return c.json(result.body, result.status as any);
  });

  // POST /api/cloud/orgs/switch — switch active org
  app.post('/switch', async (c) => {
    const auth = (c as any).get('auth') as { userId?: string } | undefined;
    if (!auth?.userId) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json();
    const result = await handlers.switchOrg(auth.userId, body);
    return c.json(result.body, result.status as any);
  });

  // GET /api/cloud/orgs/:orgId/members
  app.get('/:orgId/members', async (c) => {
    const orgId = c.req.param('orgId');
    const result = await handlers.listMembers(orgId);
    return c.json(result.body, result.status as any);
  });

  // GET /api/cloud/orgs/:orgId/invitations
  app.get('/:orgId/invitations', async (c) => {
    const orgId = c.req.param('orgId');
    const result = await handlers.listInvitations(orgId);
    return c.json(result.body, result.status as any);
  });

  // POST /api/cloud/orgs/:orgId/invitations
  app.post('/:orgId/invitations', async (c) => {
    const auth = (c as any).get('auth') as { userId?: string } | undefined;
    if (!auth?.userId) return c.json({ error: 'Authentication required' }, 401);
    const orgId = c.req.param('orgId');
    const body = await c.req.json();
    const result = await handlers.inviteMember(orgId, auth.userId, body);
    return c.json(result.body, result.status as any);
  });

  // DELETE /api/cloud/orgs/:orgId/invitations/:invId
  app.delete('/:orgId/invitations/:invId', async (c) => {
    const orgId = c.req.param('orgId');
    const invId = c.req.param('invId');
    const result = await handlers.cancelInvitation(orgId, invId);
    return c.json(result.body, result.status as any);
  });

  // PUT /api/cloud/orgs/:orgId/members/:userId/role
  app.put('/:orgId/members/:userId/role', async (c) => {
    const auth = (c as any).get('auth') as { role?: string } | undefined;
    const orgId = c.req.param('orgId');
    const userId = c.req.param('userId');
    const body = await c.req.json();
    const result = await handlers.changeMemberRole(orgId, userId, auth?.role ?? 'member', body);
    return c.json(result.body, result.status as any);
  });

  // DELETE /api/cloud/orgs/:orgId/members/:userId
  app.delete('/:orgId/members/:userId', async (c) => {
    const orgId = c.req.param('orgId');
    const userId = c.req.param('userId');
    const result = await handlers.removeMember(orgId, userId);
    return c.json(result.body, result.status as any);
  });

  // POST /api/cloud/orgs/:orgId/transfer
  app.post('/:orgId/transfer', async (c) => {
    const auth = (c as any).get('auth') as { userId?: string } | undefined;
    if (!auth?.userId) return c.json({ error: 'Authentication required' }, 401);
    const orgId = c.req.param('orgId');
    const body = await c.req.json();
    const result = await handlers.transferOwnership(orgId, auth.userId, body);
    return c.json(result.body, result.status as any);
  });

  return app;
}

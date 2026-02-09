/**
 * Org & Team Routes (S-7.1, S-7.2)
 *
 * Express-compatible route handlers for org management and team management.
 * These are designed to be mounted at /api/cloud/orgs.
 */

import { OrgService, OrgServiceError } from '../org-service.js';
import type { MigrationClient } from '../migrate.js';
import type { AuditLogService } from '../auth/audit-log.js';

export interface OrgRoutesDeps {
  db: MigrationClient;
  auditLog?: AuditLogService;
}

/**
 * Creates a map of route handlers for org/team management.
 * Can be wired into Express, Fastify, or any HTTP framework.
 */
export function createOrgRouteHandlers(deps: OrgRoutesDeps) {
  const orgService = new OrgService(deps.db);

  return {
    /** GET /api/cloud/orgs — list user's orgs */
    async listOrgs(userId: string): Promise<{ status: number; body: unknown }> {
      const orgs = await orgService.listUserOrgs(userId);
      return { status: 200, body: orgs };
    },

    /** POST /api/cloud/orgs — create a new org */
    async createOrg(
      userId: string,
      body: { name: string },
    ): Promise<{ status: number; body: unknown }> {
      try {
        const org = await orgService.createOrg(userId, body.name);
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: org.id,
            actor_type: 'user',
            actor_id: userId,
            action: 'org.created' as any,
            resource_type: 'org',
            resource_id: org.id,
            details: { name: body.name },
            ip_address: null,
            result: 'success',
          });
        }
        return { status: 201, body: org };
      } catch (err) {
        if (err instanceof OrgServiceError) {
          return { status: err.statusCode, body: { error: err.message } };
        }
        throw err;
      }
    },

    /** POST /api/cloud/orgs/switch — switch active org (returns new JWT context) */
    async switchOrg(
      userId: string,
      body: { orgId: string },
    ): Promise<{ status: number; body: unknown }> {
      // Verify user belongs to this org
      const orgs = await orgService.listUserOrgs(userId);
      const target = orgs.find((o) => o.id === body.orgId);
      if (!target) {
        return { status: 403, body: { error: 'You are not a member of this organization' } };
      }
      // The actual JWT re-issuance would be done by the auth layer.
      // This endpoint validates the switch is allowed.
      return { status: 200, body: { token: 'refresh-required', orgId: body.orgId } };
    },

    /** GET /api/cloud/orgs/:orgId/members — list org members */
    async listMembers(
      orgId: string,
    ): Promise<{ status: number; body: unknown }> {
      const members = await orgService.listMembers(orgId);
      return { status: 200, body: members };
    },

    /** GET /api/cloud/orgs/:orgId/invitations — list pending invitations */
    async listInvitations(
      orgId: string,
    ): Promise<{ status: number; body: unknown }> {
      const invitations = await orgService.listInvitations(orgId);
      return { status: 200, body: invitations };
    },

    /** POST /api/cloud/orgs/:orgId/invitations — invite a member */
    async inviteMember(
      orgId: string,
      invitedByUserId: string,
      body: { email: string; role: string },
    ): Promise<{ status: number; body: unknown }> {
      try {
        const { invitation } = await orgService.inviteMember(
          orgId,
          invitedByUserId,
          body.email,
          body.role as 'admin' | 'member' | 'viewer',
        );
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: orgId,
            actor_type: 'user',
            actor_id: invitedByUserId,
            action: 'member.invited',
            resource_type: 'invitation',
            resource_id: invitation.id,
            details: { email: body.email, role: body.role },
            ip_address: null,
            result: 'success',
          });
        }
        return { status: 201, body: invitation };
      } catch (err) {
        if (err instanceof OrgServiceError) {
          return { status: err.statusCode, body: { error: err.message } };
        }
        throw err;
      }
    },

    /** DELETE /api/cloud/orgs/:orgId/invitations/:invId — cancel invitation */
    async cancelInvitation(
      orgId: string,
      invitationId: string,
    ): Promise<{ status: number; body: unknown }> {
      const ok = await orgService.cancelInvitation(orgId, invitationId);
      return { status: ok ? 200 : 404, body: { ok } };
    },

    /** PUT /api/cloud/orgs/:orgId/members/:userId/role — change role */
    async changeMemberRole(
      orgId: string,
      targetUserId: string,
      actorRole: string,
      body: { role: string },
    ): Promise<{ status: number; body: unknown }> {
      try {
        await orgService.changeMemberRole(orgId, targetUserId, body.role, actorRole);
        return { status: 200, body: { ok: true } };
      } catch (err) {
        if (err instanceof OrgServiceError) {
          return { status: err.statusCode, body: { error: err.message } };
        }
        throw err;
      }
    },

    /** DELETE /api/cloud/orgs/:orgId/members/:userId — remove member */
    async removeMember(
      orgId: string,
      targetUserId: string,
    ): Promise<{ status: number; body: unknown }> {
      try {
        await orgService.removeMember(orgId, targetUserId);
        return { status: 200, body: { ok: true } };
      } catch (err) {
        if (err instanceof OrgServiceError) {
          return { status: err.statusCode, body: { error: err.message } };
        }
        throw err;
      }
    },

    /** POST /api/cloud/orgs/:orgId/transfer — transfer ownership */
    async transferOwnership(
      orgId: string,
      fromUserId: string,
      body: { toUserId: string },
    ): Promise<{ status: number; body: unknown }> {
      try {
        await orgService.transferOwnership(orgId, fromUserId, body.toUserId);
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: orgId,
            actor_type: 'user',
            actor_id: fromUserId,
            action: 'org.ownership_transferred',
            resource_type: 'org',
            resource_id: orgId,
            details: { from: fromUserId, to: body.toUserId },
            ip_address: null,
            result: 'success',
          });
        }
        return { status: 200, body: { ok: true } };
      } catch (err) {
        if (err instanceof OrgServiceError) {
          return { status: err.statusCode, body: { error: err.message } };
        }
        throw err;
      }
    },
  };
}

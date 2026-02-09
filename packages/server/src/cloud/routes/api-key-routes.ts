/**
 * API Key Management Routes (S-7.3)
 *
 * Express-compatible route handlers for API key CRUD.
 * Mounted at /api/cloud/orgs/:orgId/api-keys
 */

import { ApiKeyService, ApiKeyError } from '../auth/api-keys.js';
import type { MigrationClient } from '../migrate.js';
import type { AuditLogService } from '../auth/audit-log.js';

export interface ApiKeyRoutesDeps {
  db: MigrationClient;
  auditLog?: AuditLogService;
}

const TIER_KEY_LIMITS: Record<string, number> = {
  free: 2,
  pro: 10,
  team: 50,
  enterprise: 200,
};

export function createApiKeyRouteHandlers(deps: ApiKeyRoutesDeps) {
  const keyService = new ApiKeyService(deps.db);

  return {
    /** GET /api/cloud/orgs/:orgId/api-keys — list all keys */
    async listKeys(orgId: string): Promise<{ status: number; body: unknown }> {
      const keys = await keyService.list(orgId);
      return { status: 200, body: keys };
    },

    /** POST /api/cloud/orgs/:orgId/api-keys — create a key */
    async createKey(
      orgId: string,
      userId: string,
      body: { name: string; environment: string },
    ): Promise<{ status: number; body: unknown }> {
      try {
        const result = await keyService.create({
          orgId,
          name: body.name,
          environment: body.environment as any,
          createdBy: userId,
        });
        if (deps.auditLog) {
          await deps.auditLog.write({
            org_id: orgId,
            actor_type: 'user',
            actor_id: userId,
            action: 'api_key.created',
            resource_type: 'api_key',
            resource_id: result.record.id,
            details: { name: body.name, environment: body.environment },
            ip_address: null,
            result: 'success',
          });
        }
        return { status: 201, body: result };
      } catch (err) {
        if (err instanceof ApiKeyError) {
          return { status: 422, body: { error: err.message, code: err.code } };
        }
        throw err;
      }
    },

    /** DELETE /api/cloud/orgs/:orgId/api-keys/:keyId — revoke a key */
    async revokeKey(
      orgId: string,
      keyId: string,
      userId: string,
    ): Promise<{ status: number; body: unknown }> {
      const ok = await keyService.revoke(orgId, keyId);
      if (ok && deps.auditLog) {
        await deps.auditLog.write({
          org_id: orgId,
          actor_type: 'user',
          actor_id: userId,
          action: 'api_key.revoked',
          resource_type: 'api_key',
          resource_id: keyId,
          details: {},
          ip_address: null,
          result: 'success',
        });
      }
      return { status: ok ? 200 : 404, body: { ok } };
    },

    /** GET /api/cloud/orgs/:orgId/api-keys/limit — get key limit info */
    async getKeyLimit(orgId: string): Promise<{ status: number; body: unknown }> {
      const count = await keyService.countActive(orgId);
      const orgResult = await deps.db.query(`SELECT plan FROM orgs WHERE id = $1`, [orgId]);
      const plan = (orgResult.rows as any[])[0]?.plan ?? 'free';
      const limit = TIER_KEY_LIMITS[plan] ?? TIER_KEY_LIMITS.free;
      return {
        status: 200,
        body: { current: count, limit, plan },
      };
    },
  };
}

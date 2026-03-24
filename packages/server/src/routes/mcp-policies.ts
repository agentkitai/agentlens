/**
 * MCP Policy Enforcement Routes (Phase 2 — Feature 6)
 *
 * GET    /api/mcp/policies         — List MCP tool usage policies
 * POST   /api/mcp/policies         — Create a policy
 * DELETE /api/mcp/policies/:id     — Delete a policy
 * POST   /api/mcp/evaluate         — Check if an MCP tool call is allowed
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { parseBody, notFound, created } from './helpers.js';
import type { SqliteDb } from '../db/index.js';
import { sql } from 'drizzle-orm';

// ─── Schema ──────────────────────────────────────────────

const CreateMcpPolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
  tool_name: z.string().min(1).max(200),
  agent_id: z.string().optional(),
  action: z.enum(['allow', 'deny']).default('deny'),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

// ─── Types ───────────────────────────────────────────────

export interface McpPolicy {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  enabled: boolean;
  tool_name: string;
  agent_id?: string;
  action: 'allow' | 'deny';
  conditions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Store ───────────────────────────────────────────────

export class McpPolicyStore {
  constructor(private readonly db: SqliteDb) {
    this._ensureTable();
  }

  private _ensureTable(): void {
    this.db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS mcp_policies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        tool_name TEXT NOT NULL,
        agent_id TEXT,
        action TEXT NOT NULL DEFAULT 'deny',
        conditions TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `));
  }

  createPolicy(policy: McpPolicy): void {
    this.db.run(sql`
      INSERT INTO mcp_policies (id, tenant_id, name, description, enabled, tool_name, agent_id, action, conditions, created_at, updated_at)
      VALUES (${policy.id}, ${policy.tenantId}, ${policy.name}, ${policy.description ?? null},
              ${policy.enabled ? 1 : 0}, ${policy.tool_name}, ${policy.agent_id ?? null},
              ${policy.action}, ${JSON.stringify(policy.conditions)},
              ${policy.createdAt}, ${policy.updatedAt})
    `);
  }

  listPolicies(tenantId: string, toolName?: string): McpPolicy[] {
    if (toolName) {
      const rows = this.db.all<Record<string, unknown>>(sql`
        SELECT * FROM mcp_policies WHERE tenant_id = ${tenantId} AND tool_name = ${toolName} ORDER BY created_at DESC
      `);
      return rows.map((r) => this._map(r));
    }
    const rows = this.db.all<Record<string, unknown>>(sql`
      SELECT * FROM mcp_policies WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `);
    return rows.map((r) => this._map(r));
  }

  getPolicy(tenantId: string, id: string): McpPolicy | null {
    const row = this.db.get<Record<string, unknown>>(sql`
      SELECT * FROM mcp_policies WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return row ? this._map(row) : null;
  }

  deletePolicy(tenantId: string, id: string): boolean {
    const existing = this.getPolicy(tenantId, id);
    if (!existing) return false;
    this.db.run(sql`DELETE FROM mcp_policies WHERE id = ${id} AND tenant_id = ${tenantId}`);
    return true;
  }

  /** Get all enabled policies matching tool_name and agent_id */
  findMatchingPolicies(tenantId: string, toolName: string, agentId?: string): McpPolicy[] {
    const rows = this.db.all<Record<string, unknown>>(sql`
      SELECT * FROM mcp_policies
      WHERE tenant_id = ${tenantId}
        AND enabled = 1
        AND tool_name = ${toolName}
        AND (agent_id IS NULL OR agent_id = ${agentId ?? ''})
      ORDER BY created_at ASC
    `);
    return rows.map((r) => this._map(r));
  }

  private _map(row: Record<string, unknown>): McpPolicy {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      name: row['name'] as string,
      description: (row['description'] as string) || undefined,
      enabled: row['enabled'] === 1 || row['enabled'] === true,
      tool_name: row['tool_name'] as string,
      agent_id: (row['agent_id'] as string) || undefined,
      action: (row['action'] as 'allow' | 'deny') ?? 'deny',
      conditions: JSON.parse((row['conditions'] as string) || '{}'),
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}

// ─── Routes ──────────────────────────────────────────────

export function mcpPolicyRoutes(db: SqliteDb) {
  const store = new McpPolicyStore(db);
  const app = new Hono<{ Variables: AuthVariables }>();

  /**
   * @summary List MCP tool usage policies
   * @param {string} [tool_name] — filter by tool name (query param)
   * @returns {200} `{ policies: McpPolicy[] }`
   */
  app.get('/policies', async (c) => {
    const tenantId = getTenantId(c);
    const toolName = c.req.query('tool_name');
    const policies = store.listPolicies(tenantId, toolName || undefined);
    return c.json({ policies });
  });

  /**
   * @summary Create an MCP tool usage policy
   * @body {CreateMcpPolicy} — name, tool_name, agent_id, action, conditions
   * @returns {201} `McpPolicy`
   * @throws {400} Validation failed
   */
  app.post('/policies', async (c) => {
    const tenantId = getTenantId(c);
    const parsed = await parseBody(c, CreateMcpPolicySchema);
    if (!parsed.success) return parsed.response;

    const now = new Date().toISOString();
    const policy: McpPolicy = {
      id: ulid(),
      tenantId,
      name: parsed.data.name,
      description: parsed.data.description,
      enabled: parsed.data.enabled,
      tool_name: parsed.data.tool_name,
      agent_id: parsed.data.agent_id,
      action: parsed.data.action,
      conditions: parsed.data.conditions ?? {},
      createdAt: now,
      updatedAt: now,
    };

    store.createPolicy(policy);
    return created(c, policy);
  });

  /**
   * @summary Delete an MCP policy
   * @param {string} id — Policy ID (path)
   * @returns {200} `{ ok: true }`
   * @throws {404} Policy not found
   */
  app.delete('/policies/:id', async (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const deleted = store.deletePolicy(tenantId, id);
    if (!deleted) return notFound(c, 'MCP policy');
    return c.json({ ok: true });
  });

  /**
   * @summary Evaluate if an MCP tool call is allowed by policies
   * @body { tool_name: string, agent_id?: string }
   * @returns {200} `{ allowed: boolean, matched_policies: McpPolicy[], reason?: string }`
   * @throws {400} Missing tool_name
   */
  app.post('/evaluate', async (c) => {
    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    if (!body?.tool_name) {
      return c.json({ error: 'Missing tool_name', status: 400 }, 400);
    }

    const toolName = body.tool_name as string;
    const agentId = body.agent_id as string | undefined;

    const matching = store.findMatchingPolicies(tenantId, toolName, agentId);

    if (matching.length === 0) {
      // No policies match — allow by default
      return c.json({ allowed: true, matched_policies: [], reason: 'No matching policies' });
    }

    // If any deny policy matches, deny
    const denyPolicy = matching.find((p) => p.action === 'deny');
    if (denyPolicy) {
      return c.json({
        allowed: false,
        matched_policies: matching,
        reason: `Denied by policy "${denyPolicy.name}": tool "${toolName}" ${agentId ? `cannot be called by agent "${agentId}"` : 'is restricted'}`,
      });
    }

    return c.json({ allowed: true, matched_policies: matching, reason: 'Allowed by policy' });
  });

  return app;
}

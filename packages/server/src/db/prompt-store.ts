/**
 * Prompt Store (Feature 19 — Story 3)
 *
 * CRUD operations for prompt templates, versions, and fingerprints.
 * All operations are tenant-isolated.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import type {
  PromptTemplate,
  PromptVersion,
  PromptVariable,
  PromptFingerprint,
  PromptVersionAnalytics,
  PromptDeployment,
  PromptEnvironment,
  DeployLedgerVerifyResult,
  PromptAgentUsage,
} from '@agentkitai/agentlens-core';
import { costUsdDetailed } from '@agentkitai/agentlens-core';

// ─── DB Row Types ──────────────────────────────────────────

interface TemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  category: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface VersionRow {
  id: string;
  template_id: string;
  tenant_id: string;
  version_number: number;
  content: string;
  variables: string | null;
  content_hash: string;
  changelog: string | null;
  created_by: string | null;
  created_at: string;
}

interface FingerprintRow {
  content_hash: string;
  tenant_id: string;
  agent_id: string;
  first_seen_at: string;
  last_seen_at: string;
  call_count: number;
  template_id: string | null;
  sample_content: string | null;
}

// ─── Input Types ───────────────────────────────────────────

export interface CreateTemplateInput {
  name: string;
  description?: string;
  category?: string;
  content: string;
  variables?: PromptVariable[];
  createdBy?: string;
}

export interface CreateVersionInput {
  content: string;
  variables?: PromptVariable[];
  changelog?: string;
  createdBy?: string;
}

export interface ListTemplatesQuery {
  tenantId: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── Helpers ───────────────────────────────────────────────

/** Normalize prompt content for stable hashing */
export function normalizePromptContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Compute SHA-256 hash of normalized content */
export function computePromptHash(content: string): string {
  const normalized = normalizePromptContent(content);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ─── Deploy ledger (#120) ──────────────────────────────────

const DEFAULT_ENVIRONMENTS = ['staging', 'prod'];
const DEFAULT_PROTECTED = ['prod'];

function parseEnvList(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  const items = v.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

/** Configured deploy environments, default `staging` + (protected) `prod`. */
export function getPromptEnvironments(): PromptEnvironment[] {
  const names = parseEnvList(process.env.PROMPT_ENVIRONMENTS, DEFAULT_ENVIRONMENTS);
  const protectedSet = new Set(parseEnvList(process.env.PROMPT_PROTECTED_ENVIRONMENTS, DEFAULT_PROTECTED));
  return names.map((name) => ({ name, protected: protectedSet.has(name) }));
}

export function isKnownEnvironment(env: string): boolean {
  return getPromptEnvironments().some((e) => e.name === env);
}

export function isProtectedEnvironment(env: string): boolean {
  return getPromptEnvironments().some((e) => e.name === env && e.protected);
}

interface DeploymentRow {
  id: string;
  tenant_id: string;
  template_id: string;
  environment: string;
  version_id: string;
  action: string;
  status: string;
  actor_id: string | null;
  actor_method: string | null;
  approver_id: string | null;
  approval_ref: string | null;
  note: string | null;
  seq: number;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}

interface DeploymentHashFields {
  id: string;
  tenantId: string;
  templateId: string;
  environment: string;
  versionId: string;
  action: string;
  status: string;
  actorId: string | null;
  actorMethod: string | null;
  approverId: string | null;
  approvalRef: string | null;
  note: string | null;
  seq: number;
  createdAt: string;
  prevHash: string | null;
}

/**
 * SHA-256 over the canonical deploy-ledger fields + prevHash. A stable key
 * order makes the hash reproducible for verification; any edit/reorder changes
 * a row's hash and breaks the chain (mirrors core `computeEventHash`).
 */
export function computeDeploymentHash(f: DeploymentHashFields): string {
  const canonical = JSON.stringify({
    v: 1,
    id: f.id,
    tenantId: f.tenantId,
    templateId: f.templateId,
    environment: f.environment,
    versionId: f.versionId,
    action: f.action,
    status: f.status,
    actorId: f.actorId,
    actorMethod: f.actorMethod,
    approverId: f.approverId,
    approvalRef: f.approvalRef,
    note: f.note,
    seq: f.seq,
    createdAt: f.createdAt,
    prevHash: f.prevHash,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function toDeployment(row: DeploymentRow): PromptDeployment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    templateId: row.template_id,
    environment: row.environment,
    versionId: row.version_id,
    action: row.action as 'deploy' | 'rollback',
    status: row.status as 'committed' | 'denied',
    actorId: row.actor_id ?? undefined,
    actorMethod: row.actor_method ?? undefined,
    approverId: row.approver_id ?? undefined,
    approvalRef: row.approval_ref ?? undefined,
    note: row.note ?? undefined,
    seq: row.seq,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

function toTemplate(row: TemplateRow, versionNumber?: number): PromptTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category,
    currentVersionId: row.current_version_id ?? undefined,
    currentVersionNumber: versionNumber,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersion(row: VersionRow): PromptVersion {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    content: row.content,
    variables: row.variables ? JSON.parse(row.variables) : [],
    contentHash: row.content_hash,
    changelog: row.changelog ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

function toFingerprint(row: FingerprintRow): PromptFingerprint {
  return {
    contentHash: row.content_hash,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    callCount: row.call_count,
    templateId: row.template_id ?? undefined,
    sampleContent: row.sample_content ?? undefined,
  };
}

// ─── Store Class ───────────────────────────────────────────

export class PromptStore {
  constructor(private db: SqliteDb) {}

  // ─── Template CRUD ────────────────────────────────────────

  createTemplate(
    tenantId: string,
    input: CreateTemplateInput,
  ): { template: PromptTemplate; version: PromptVersion } {
    const templateId = randomUUID();
    const versionId = randomUUID();
    const now = new Date().toISOString();
    const contentHash = computePromptHash(input.content);
    const variables = input.variables ? JSON.stringify(input.variables) : null;

    // Atomic: insert template + version 1
    this.db.run(sql`
      INSERT INTO prompt_templates (id, tenant_id, name, description, category, current_version_id, created_at, updated_at)
      VALUES (${templateId}, ${tenantId}, ${input.name}, ${input.description ?? null}, ${input.category ?? 'general'}, ${versionId}, ${now}, ${now})
    `);

    this.db.run(sql`
      INSERT INTO prompt_versions (id, template_id, tenant_id, version_number, content, variables, content_hash, changelog, created_by, created_at)
      VALUES (${versionId}, ${templateId}, ${tenantId}, ${1}, ${input.content}, ${variables}, ${contentHash}, ${'Initial version'}, ${input.createdBy ?? null}, ${now})
    `);

    const template: PromptTemplate = {
      id: templateId,
      tenantId,
      name: input.name,
      description: input.description,
      category: input.category ?? 'general',
      currentVersionId: versionId,
      currentVersionNumber: 1,
      createdAt: now,
      updatedAt: now,
    };

    const version: PromptVersion = {
      id: versionId,
      templateId,
      versionNumber: 1,
      content: input.content,
      variables: input.variables ?? [],
      contentHash,
      changelog: 'Initial version',
      createdBy: input.createdBy,
      createdAt: now,
    };

    return { template, version };
  }

  getTemplate(id: string, tenantId: string): (PromptTemplate & { versions?: PromptVersion[] }) | null {
    const row = this.db.get<TemplateRow>(sql`
      SELECT * FROM prompt_templates
      WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    if (!row) return null;

    // Get current version number
    let versionNumber: number | undefined;
    if (row.current_version_id) {
      const vRow = this.db.get<{ version_number: number }>(sql`
        SELECT version_number FROM prompt_versions WHERE id = ${row.current_version_id}
      `);
      versionNumber = vRow?.version_number;
    }

    return toTemplate(row, versionNumber);
  }

  listTemplates(query: ListTemplatesQuery): { templates: PromptTemplate[]; total: number } {
    const { tenantId, category, search, limit = 50, offset = 0 } = query;

    // Build WHERE clauses
    let whereClause = sql`tenant_id = ${tenantId} AND deleted_at IS NULL`;
    if (category) {
      whereClause = sql`${whereClause} AND category = ${category}`;
    }
    if (search) {
      whereClause = sql`${whereClause} AND name LIKE ${'%' + search + '%'}`;
    }

    const totalRow = this.db.get<{ count: number }>(sql`
      SELECT COUNT(*) as count FROM prompt_templates WHERE ${whereClause}
    `);
    const total = totalRow?.count ?? 0;

    const rows = this.db.all<TemplateRow>(sql`
      SELECT * FROM prompt_templates WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const templates = rows.map((row) => {
      // We skip fetching version numbers for list performance; clients can get details
      return toTemplate(row);
    });

    return { templates, total };
  }

  softDeleteTemplate(id: string, tenantId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.run(sql`
      UPDATE prompt_templates SET deleted_at = ${now}, updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    return result.changes > 0;
  }

  // ─── Version Management ───────────────────────────────────

  createVersion(
    templateId: string,
    tenantId: string,
    input: CreateVersionInput,
  ): PromptVersion | null {
    // Check template exists
    const template = this.db.get<TemplateRow>(sql`
      SELECT * FROM prompt_templates
      WHERE id = ${templateId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    if (!template) return null;

    const contentHash = computePromptHash(input.content);

    // Check if hash matches current version (dedup — no-op)
    if (template.current_version_id) {
      const currentVersion = this.db.get<VersionRow>(sql`
        SELECT * FROM prompt_versions WHERE id = ${template.current_version_id}
      `);
      if (currentVersion && currentVersion.content_hash === contentHash) {
        return toVersion(currentVersion);
      }
    }

    // Get max version number
    const maxRow = this.db.get<{ max_ver: number | null }>(sql`
      SELECT MAX(version_number) as max_ver FROM prompt_versions
      WHERE template_id = ${templateId}
    `);
    const nextVersion = (maxRow?.max_ver ?? 0) + 1;

    const versionId = randomUUID();
    const now = new Date().toISOString();
    const variables = input.variables ? JSON.stringify(input.variables) : null;

    this.db.run(sql`
      INSERT INTO prompt_versions (id, template_id, tenant_id, version_number, content, variables, content_hash, changelog, created_by, created_at)
      VALUES (${versionId}, ${templateId}, ${tenantId}, ${nextVersion}, ${input.content}, ${variables}, ${contentHash}, ${input.changelog ?? null}, ${input.createdBy ?? null}, ${now})
    `);

    this.db.run(sql`
      UPDATE prompt_templates SET current_version_id = ${versionId}, updated_at = ${now}
      WHERE id = ${templateId}
    `);

    return {
      id: versionId,
      templateId,
      versionNumber: nextVersion,
      content: input.content,
      variables: input.variables ?? [],
      contentHash,
      changelog: input.changelog,
      createdBy: input.createdBy,
      createdAt: now,
    };
  }

  getVersion(versionId: string, tenantId: string): PromptVersion | null {
    const row = this.db.get<VersionRow>(sql`
      SELECT * FROM prompt_versions WHERE id = ${versionId} AND tenant_id = ${tenantId}
    `);
    return row ? toVersion(row) : null;
  }

  listVersions(templateId: string, tenantId: string): PromptVersion[] {
    const rows = this.db.all<VersionRow>(sql`
      SELECT * FROM prompt_versions
      WHERE template_id = ${templateId} AND tenant_id = ${tenantId}
      ORDER BY version_number DESC
    `);
    return rows.map(toVersion);
  }

  // ─── Fingerprinting ──────────────────────────────────────

  upsertFingerprint(
    hash: string,
    tenantId: string,
    agentId: string,
    sampleContent?: string,
    count = 1,
  ): void {
    const now = new Date().toISOString();
    const sample = sampleContent?.slice(0, 2000) ?? null;
    const inc = Math.max(1, Math.trunc(count));

    this.db.run(sql`
      INSERT INTO prompt_fingerprints (content_hash, tenant_id, agent_id, first_seen_at, last_seen_at, call_count, sample_content)
      VALUES (${hash}, ${tenantId}, ${agentId}, ${now}, ${now}, ${inc}, ${sample})
      ON CONFLICT (content_hash, tenant_id, agent_id)
      DO UPDATE SET last_seen_at = ${now}, call_count = call_count + ${inc}
    `);
  }

  getFingerprints(tenantId: string, agentId?: string): PromptFingerprint[] {
    if (agentId) {
      const rows = this.db.all<FingerprintRow>(sql`
        SELECT * FROM prompt_fingerprints
        WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}
        ORDER BY last_seen_at DESC
      `);
      return rows.map(toFingerprint);
    }
    const rows = this.db.all<FingerprintRow>(sql`
      SELECT * FROM prompt_fingerprints
      WHERE tenant_id = ${tenantId}
      ORDER BY last_seen_at DESC
    `);
    return rows.map(toFingerprint);
  }

  linkFingerprintToTemplate(
    hash: string,
    tenantId: string,
    templateId: string,
  ): boolean {
    const result = this.db.run(sql`
      UPDATE prompt_fingerprints SET template_id = ${templateId}
      WHERE content_hash = ${hash} AND tenant_id = ${tenantId}
    `);
    return result.changes > 0;
  }

  // ─── Analytics ────────────────────────────────────────────

  getVersionAnalytics(
    templateId: string,
    tenantId: string,
    from?: string,
    to?: string,
  ): PromptVersionAnalytics[] {
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to ?? new Date().toISOString();

    const rows = this.db.all<{
      version_id: string;
      version_number: number;
      call_count: number;
      total_cost_usd: number;
      avg_cost_usd: number;
      avg_latency_ms: number;
      error_rate: number;
      avg_input_tokens: number;
      avg_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_write_tokens: number;
    }>(sql`
      SELECT
        pv.id AS version_id,
        pv.version_number,
        COUNT(DISTINCT e.id) AS call_count,
        COALESCE(SUM(json_extract(r.payload, '$.costUsd')), 0) AS total_cost_usd,
        COALESCE(AVG(json_extract(r.payload, '$.costUsd')), 0) AS avg_cost_usd,
        COALESCE(AVG(json_extract(r.payload, '$.latencyMs')), 0) AS avg_latency_ms,
        COALESCE(
          CAST(SUM(CASE WHEN json_extract(r.payload, '$.finishReason') = 'error' THEN 1 ELSE 0 END) AS REAL)
          / NULLIF(COUNT(DISTINCT e.id), 0),
          0
        ) AS error_rate,
        COALESCE(AVG(json_extract(r.payload, '$.usage.inputTokens')), 0) AS avg_input_tokens,
        COALESCE(AVG(json_extract(r.payload, '$.usage.outputTokens')), 0) AS avg_output_tokens,
        COALESCE(SUM(json_extract(r.payload, '$.usage.cacheReadTokens')), 0) AS total_cache_read_tokens,
        COALESCE(SUM(json_extract(r.payload, '$.usage.cacheWriteTokens')), 0) AS total_cache_write_tokens
      FROM prompt_versions pv
      LEFT JOIN events e
        ON json_extract(e.payload, '$.promptVersionId') = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON json_extract(r.payload, '$.callId') = json_extract(e.payload, '$.callId')
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, pv.version_number
      ORDER BY pv.version_number DESC
    `);

    // Cache savings need a per-model rate, so aggregate cache-read tokens grouped
    // by (version, model) and price each group in JS (the main query is per-version).
    const savings = this.cacheSavingsByVersion(templateId, tenantId, fromDate, toDate);

    return rows.map((r) => ({
      versionId: r.version_id,
      versionNumber: r.version_number,
      callCount: r.call_count,
      totalCostUsd: r.total_cost_usd,
      avgCostUsd: r.avg_cost_usd,
      avgLatencyMs: r.avg_latency_ms,
      errorRate: r.error_rate,
      avgInputTokens: r.avg_input_tokens,
      avgOutputTokens: r.avg_output_tokens,
      totalCacheReadTokens: r.total_cache_read_tokens,
      totalCacheWriteTokens: r.total_cache_write_tokens,
      estimatedCacheSavingsUsd: savings.get(r.version_id) ?? 0,
    }));
  }

  /** Estimated USD saved by cache reads per version = cacheReadTokens × (input − cacheRead) rate. */
  private cacheSavingsByVersion(
    templateId: string,
    tenantId: string,
    fromDate: string,
    toDate: string,
  ): Map<string, number> {
    const rows = this.db.all<{ version_id: string; model: string | null; cache_read: number }>(sql`
      SELECT
        pv.id AS version_id,
        json_extract(r.payload, '$.model') AS model,
        COALESCE(SUM(json_extract(r.payload, '$.usage.cacheReadTokens')), 0) AS cache_read
      FROM prompt_versions pv
      LEFT JOIN events e
        ON json_extract(e.payload, '$.promptVersionId') = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON json_extract(r.payload, '$.callId') = json_extract(e.payload, '$.callId')
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, model
    `);

    const byVersion = new Map<string, number>();
    for (const row of rows) {
      if (!row.model || !row.cache_read) continue;
      // Single source of truth for the per-model cache discount (robust to a
      // LiteLLM refresh): savings = the cacheSavingsUsd costUsdDetailed reports.
      const { cacheSavingsUsd } = costUsdDetailed(row.model, {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: row.cache_read,
      });
      if (cacheSavingsUsd > 0) byVersion.set(row.version_id, (byVersion.get(row.version_id) ?? 0) + cacheSavingsUsd);
    }
    return byVersion;
  }

  // ─── Deploy ledger (#120) ────────────────────────────────

  /**
   * Append one row to the tamper-evident deploy ledger for (tenant, env).
   * Validates the version belongs to the template+tenant, then chains the row
   * to the env's current tail (prevHash + monotonic seq). Append-only: never
   * mutates prior rows or a "current version" pointer — the live version is
   * derived from the ledger. Returns null if the env is unknown or the
   * template/version doesn't exist for the tenant.
   *
   * Gating (AgentGate) is decided in the route; this records the outcome,
   * including denials (status='denied'), so the audit trail is complete.
   */
  appendDeployment(
    tenantId: string,
    input: {
      templateId: string;
      environment: string;
      versionId: string;
      action: 'deploy' | 'rollback';
      status?: 'committed' | 'denied';
      actorId?: string | null;
      actorMethod?: string | null;
      approverId?: string | null;
      approvalRef?: string | null;
      note?: string | null;
    },
  ): PromptDeployment | null {
    if (!isKnownEnvironment(input.environment)) return null;

    const version = this.db.get<VersionRow>(sql`
      SELECT * FROM prompt_versions
      WHERE id = ${input.versionId} AND template_id = ${input.templateId} AND tenant_id = ${tenantId}
    `);
    if (!version) return null;

    // Chain to the env's tail. The UNIQUE(tenant, env, seq) index fails closed
    // if two writers race the same seq (mirrors append-event's race handling).
    const tail = this.db.get<{ seq: number; hash: string }>(sql`
      SELECT seq, hash FROM prompt_deployments
      WHERE tenant_id = ${tenantId} AND environment = ${input.environment}
      ORDER BY seq DESC LIMIT 1
    `);
    const seq = (tail?.seq ?? 0) + 1;
    const prevHash = tail?.hash ?? null;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const status = input.status ?? 'committed';

    const fields: DeploymentHashFields = {
      id,
      tenantId,
      templateId: input.templateId,
      environment: input.environment,
      versionId: input.versionId,
      action: input.action,
      status,
      actorId: input.actorId ?? null,
      actorMethod: input.actorMethod ?? null,
      approverId: input.approverId ?? null,
      approvalRef: input.approvalRef ?? null,
      note: input.note ?? null,
      seq,
      createdAt,
      prevHash,
    };
    const hash = computeDeploymentHash(fields);

    this.db.run(sql`
      INSERT INTO prompt_deployments
        (id, tenant_id, template_id, environment, version_id, action, status,
         actor_id, actor_method, approver_id, approval_ref, note, seq, prev_hash, hash, created_at)
      VALUES
        (${id}, ${tenantId}, ${input.templateId}, ${input.environment}, ${input.versionId}, ${input.action}, ${status},
         ${fields.actorId}, ${fields.actorMethod}, ${fields.approverId}, ${fields.approvalRef}, ${fields.note}, ${seq}, ${prevHash}, ${hash}, ${createdAt})
    `);

    return toDeployment({
      id,
      tenant_id: tenantId,
      template_id: input.templateId,
      environment: input.environment,
      version_id: input.versionId,
      action: input.action,
      status,
      actor_id: fields.actorId,
      actor_method: fields.actorMethod,
      approver_id: fields.approverId,
      approval_ref: fields.approvalRef,
      note: fields.note,
      seq,
      prev_hash: prevHash,
      hash,
      created_at: createdAt,
    });
  }

  /** The version currently live in an environment for a template (latest committed row), or null. */
  getLiveVersion(tenantId: string, environment: string, templateId: string): string | null {
    const row = this.db.get<{ version_id: string }>(sql`
      SELECT version_id FROM prompt_deployments
      WHERE tenant_id = ${tenantId} AND environment = ${environment}
        AND template_id = ${templateId} AND status = 'committed'
      ORDER BY seq DESC LIMIT 1
    `);
    return row?.version_id ?? null;
  }

  /** Map of environment → live version id for a template (only envs with a live version). */
  getLiveVersions(tenantId: string, templateId: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const env of getPromptEnvironments()) {
      const v = this.getLiveVersion(tenantId, env.name, templateId);
      if (v) out[env.name] = v;
    }
    return out;
  }

  /** Deploy history (newest first), optionally filtered by template and/or environment. */
  listDeployments(
    tenantId: string,
    opts: { templateId?: string; environment?: string; limit?: number } = {},
  ): PromptDeployment[] {
    const conds = [sql`tenant_id = ${tenantId}`];
    if (opts.templateId) conds.push(sql`template_id = ${opts.templateId}`);
    if (opts.environment) conds.push(sql`environment = ${opts.environment}`);
    const where = sql.join(conds, sql` AND `);
    const limit = Math.min(opts.limit ?? 200, 1000);
    const rows = this.db.all<DeploymentRow>(sql`
      SELECT * FROM prompt_deployments WHERE ${where}
      ORDER BY created_at DESC, seq DESC LIMIT ${limit}
    `);
    return rows.map(toDeployment);
  }

  /** Verify a (tenant, environment) deploy chain: seq continuity, prev-hash links, and per-row hashes. */
  verifyDeployLedger(tenantId: string, environment: string): DeployLedgerVerifyResult {
    const rows = this.db.all<DeploymentRow>(sql`
      SELECT * FROM prompt_deployments
      WHERE tenant_id = ${tenantId} AND environment = ${environment}
      ORDER BY seq ASC
    `);
    let prevHash: string | null = null;
    let expectedSeq = 1;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        return { environment, valid: false, count: rows.length, brokenAtSeq: row.seq, reason: `seq gap: expected ${expectedSeq}, got ${row.seq}` };
      }
      if ((row.prev_hash ?? null) !== prevHash) {
        return { environment, valid: false, count: rows.length, brokenAtSeq: row.seq, reason: 'prev_hash link broken' };
      }
      const recomputed = computeDeploymentHash({
        id: row.id,
        tenantId: row.tenant_id,
        templateId: row.template_id,
        environment: row.environment,
        versionId: row.version_id,
        action: row.action,
        status: row.status,
        actorId: row.actor_id,
        actorMethod: row.actor_method,
        approverId: row.approver_id,
        approvalRef: row.approval_ref,
        note: row.note,
        seq: row.seq,
        createdAt: row.created_at,
        prevHash: row.prev_hash,
      });
      if (recomputed !== row.hash) {
        return { environment, valid: false, count: rows.length, brokenAtSeq: row.seq, reason: 'hash mismatch (record tampered)' };
      }
      prevHash = row.hash;
      expectedSeq++;
    }
    return { environment, valid: true, count: rows.length };
  }

  /**
   * Per-agent usage + cost per version (#120). Groups real generations by the
   * verified agent id (falling back to the event's agent id when unverified),
   * reusing the same payload.promptVersionId join as getVersionAnalytics.
   */
  getVersionAnalyticsByAgent(
    templateId: string,
    tenantId: string,
    from?: string,
    to?: string,
  ): PromptAgentUsage[] {
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to ?? new Date().toISOString();

    const rows = this.db.all<{
      version_id: string;
      version_number: number;
      resolved_agent_id: string | null;
      verified: number;
      call_count: number;
      total_cost_usd: number;
      avg_latency_ms: number;
      error_rate: number;
    }>(sql`
      SELECT
        pv.id AS version_id,
        pv.version_number,
        COALESCE(json_extract(e.metadata, '$.verifiedAgentId'), e.agent_id) AS resolved_agent_id,
        CASE WHEN json_extract(e.metadata, '$.verifiedAgentId') IS NOT NULL THEN 1 ELSE 0 END AS verified,
        COUNT(DISTINCT e.id) AS call_count,
        COALESCE(SUM(json_extract(r.payload, '$.costUsd')), 0) AS total_cost_usd,
        COALESCE(AVG(json_extract(r.payload, '$.latencyMs')), 0) AS avg_latency_ms,
        COALESCE(
          CAST(SUM(CASE WHEN json_extract(r.payload, '$.finishReason') = 'error' THEN 1 ELSE 0 END) AS REAL)
          / NULLIF(COUNT(DISTINCT e.id), 0),
          0
        ) AS error_rate
      FROM prompt_versions pv
      JOIN events e
        ON json_extract(e.payload, '$.promptVersionId') = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON json_extract(r.payload, '$.callId') = json_extract(e.payload, '$.callId')
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, resolved_agent_id
      ORDER BY pv.version_number DESC, call_count DESC
    `);

    return rows.map((r) => ({
      versionId: r.version_id,
      versionNumber: r.version_number,
      agentId: r.resolved_agent_id ?? 'unknown',
      verified: r.verified === 1,
      callCount: r.call_count,
      totalCostUsd: r.total_cost_usd,
      avgLatencyMs: r.avg_latency_ms,
      errorRate: r.error_rate,
    }));
  }
}

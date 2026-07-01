/**
 * Prompt Store (Feature 19 — Story 3)
 *
 * CRUD operations for prompt templates, versions, and fingerprints.
 * All operations are tenant-isolated.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { pickVariant, type AbVariant } from '../lib/prompt-ab.js';
import { type AnyDb, isSqliteDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';
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

// ─── Dialect-aware JSON access (#175) ──────────────────────
// events.payload/metadata is jsonb on Postgres and TEXT on SQLite. These build the
// right field-extraction SQL for each dialect; paths/columns are code constants
// (never user input), so raw interpolation is safe. col e.g. 'r.payload'.
function jText(isPg: boolean, col: string, ...path: string[]): string {
  if (!isPg) return `json_extract(${col}, '$.${path.join('.')}')`;
  const leaf = path[path.length - 1];
  const parents = path.slice(0, -1).map((p) => `'${p}'`);
  return parents.length ? `${col}->${parents.join('->')}->>'${leaf}'` : `${col}->>'${leaf}'`;
}
function jNum(isPg: boolean, col: string, ...path: string[]): string {
  return isPg ? `(${jText(isPg, col, ...path)})::numeric` : `json_extract(${col}, '$.${path.join('.')}')`;
}

// ─── DB Row Types ──────────────────────────────────────────

interface TemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  category: string;
  folder: string | null;
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
  config: string | null;
  prompt_type: string | null;
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
  folder?: string;
  content: string;
  variables?: PromptVariable[];
  config?: Record<string, unknown>;
  promptType?: 'text' | 'chat';
  createdBy?: string;
}

export interface CreateVersionInput {
  content: string;
  variables?: PromptVariable[];
  config?: Record<string, unknown>;
  promptType?: 'text' | 'chat';
  changelog?: string;
  createdBy?: string;
}

export interface ListTemplatesQuery {
  tenantId: string;
  category?: string;
  folder?: string;
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
    folder: row.folder ?? undefined,
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
    config: row.config ? JSON.parse(row.config) : undefined,
    promptType: row.prompt_type === 'chat' ? 'chat' : 'text',
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

// ─── A/B test types (#150) ─────────────────────────────────

export interface AbTest {
  id: string;
  tenantId: string;
  templateId: string;
  environment: string;
  variants: AbVariant[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AbTestRow {
  id: string;
  tenant_id: string;
  template_id: string;
  environment: string;
  variants: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toAbTest(r: AbTestRow): AbTest {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    templateId: r.template_id,
    environment: r.environment,
    variants: JSON.parse(r.variants),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── Store Class ───────────────────────────────────────────

export class PromptStore {
  constructor(private db: AnyDb) {}

  // ─── Template CRUD ────────────────────────────────────────

  async createTemplate(
    tenantId: string,
    input: CreateTemplateInput,
  ): Promise<{ template: PromptTemplate; version: PromptVersion }> {
    const templateId = randomUUID();
    const versionId = randomUUID();
    const now = new Date().toISOString();
    const contentHash = computePromptHash(input.content);
    const variables = input.variables ? JSON.stringify(input.variables) : null;
    const config = input.config ? JSON.stringify(input.config) : null;
    const promptType = input.promptType ?? 'text';

    // Atomic: insert template + version 1
    await dbRun(this.db, sql`
      INSERT INTO prompt_templates (id, tenant_id, name, description, category, folder, current_version_id, created_at, updated_at)
      VALUES (${templateId}, ${tenantId}, ${input.name}, ${input.description ?? null}, ${input.category ?? 'general'}, ${input.folder ?? null}, ${versionId}, ${now}, ${now})
    `);

    await dbRun(this.db, sql`
      INSERT INTO prompt_versions (id, template_id, tenant_id, version_number, content, variables, config, prompt_type, content_hash, changelog, created_by, created_at)
      VALUES (${versionId}, ${templateId}, ${tenantId}, ${1}, ${input.content}, ${variables}, ${config}, ${promptType}, ${contentHash}, ${'Initial version'}, ${input.createdBy ?? null}, ${now})
    `);

    const template: PromptTemplate = {
      id: templateId,
      tenantId,
      name: input.name,
      description: input.description,
      category: input.category ?? 'general',
      folder: input.folder,
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

  async getTemplate(id: string, tenantId: string): Promise<(PromptTemplate & { versions?: PromptVersion[] }) | null> {
    const row = await dbGet<TemplateRow>(this.db, sql`
      SELECT * FROM prompt_templates
      WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    if (!row) return null;

    // Get current version number
    let versionNumber: number | undefined;
    if (row.current_version_id) {
      const vRow = await dbGet<{ version_number: number }>(this.db, sql`
        SELECT version_number FROM prompt_versions WHERE id = ${row.current_version_id}
      `);
      versionNumber = vRow?.version_number;
    }

    return toTemplate(row, versionNumber);
  }

  async listTemplates(query: ListTemplatesQuery): Promise<{ templates: PromptTemplate[]; total: number }> {
    const { tenantId, category, folder, search, limit = 50, offset = 0 } = query;

    // Build WHERE clauses
    let whereClause = sql`tenant_id = ${tenantId} AND deleted_at IS NULL`;
    if (category) {
      whereClause = sql`${whereClause} AND category = ${category}`;
    }
    if (folder !== undefined) {
      whereClause = sql`${whereClause} AND folder = ${folder}`;
    }
    if (search) {
      whereClause = sql`${whereClause} AND name LIKE ${'%' + search + '%'}`;
    }

    const totalRow = await dbGet<{ count: number }>(this.db, sql`
      SELECT COUNT(*) as count FROM prompt_templates WHERE ${whereClause}
    `);
    const total = totalRow?.count ?? 0;

    const rows = await dbAll<TemplateRow>(this.db, sql`
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

  async softDeleteTemplate(id: string, tenantId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const changed = await dbRunCount(this.db, sql`
      UPDATE prompt_templates SET deleted_at = ${now}, updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    return changed > 0;
  }

  // ─── Version Management ───────────────────────────────────

  async createVersion(
    templateId: string,
    tenantId: string,
    input: CreateVersionInput,
  ): Promise<PromptVersion | null> {
    // Check template exists
    const template = await dbGet<TemplateRow>(this.db, sql`
      SELECT * FROM prompt_templates
      WHERE id = ${templateId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `);
    if (!template) return null;

    const contentHash = computePromptHash(input.content);

    // Check if hash matches current version (dedup — no-op)
    if (template.current_version_id) {
      const currentVersion = await dbGet<VersionRow>(this.db, sql`
        SELECT * FROM prompt_versions WHERE id = ${template.current_version_id}
      `);
      if (currentVersion && currentVersion.content_hash === contentHash) {
        return toVersion(currentVersion);
      }
    }

    // Get max version number
    const maxRow = await dbGet<{ max_ver: number | null }>(this.db, sql`
      SELECT MAX(version_number) as max_ver FROM prompt_versions
      WHERE template_id = ${templateId}
    `);
    const nextVersion = (maxRow?.max_ver ?? 0) + 1;

    const versionId = randomUUID();
    const now = new Date().toISOString();
    const variables = input.variables ? JSON.stringify(input.variables) : null;
    const config = input.config ? JSON.stringify(input.config) : null;
    const promptType = input.promptType ?? 'text';

    await dbRun(this.db, sql`
      INSERT INTO prompt_versions (id, template_id, tenant_id, version_number, content, variables, config, prompt_type, content_hash, changelog, created_by, created_at)
      VALUES (${versionId}, ${templateId}, ${tenantId}, ${nextVersion}, ${input.content}, ${variables}, ${config}, ${promptType}, ${contentHash}, ${input.changelog ?? null}, ${input.createdBy ?? null}, ${now})
    `);

    await dbRun(this.db, sql`
      UPDATE prompt_templates SET current_version_id = ${versionId}, updated_at = ${now}
      WHERE id = ${templateId}
    `);

    return {
      id: versionId,
      templateId,
      versionNumber: nextVersion,
      content: input.content,
      variables: input.variables ?? [],
      config: input.config,
      promptType,
      contentHash,
      changelog: input.changelog,
      createdBy: input.createdBy,
      createdAt: now,
    };
  }

  async getVersion(versionId: string, tenantId: string): Promise<PromptVersion | null> {
    const row = await dbGet<VersionRow>(this.db, sql`
      SELECT * FROM prompt_versions WHERE id = ${versionId} AND tenant_id = ${tenantId}
    `);
    return row ? toVersion(row) : null;
  }

  async listVersions(templateId: string, tenantId: string): Promise<PromptVersion[]> {
    const rows = await dbAll<VersionRow>(this.db, sql`
      SELECT * FROM prompt_versions
      WHERE template_id = ${templateId} AND tenant_id = ${tenantId}
      ORDER BY version_number DESC
    `);
    return rows.map(toVersion);
  }

  // ─── Fingerprinting ──────────────────────────────────────

  async upsertFingerprint(
    hash: string,
    tenantId: string,
    agentId: string,
    sampleContent?: string,
    count = 1,
  ): Promise<void> {
    const now = new Date().toISOString();
    const sample = sampleContent?.slice(0, 2000) ?? null;
    const inc = Math.max(1, Math.trunc(count));

    await dbRun(this.db, sql`
      INSERT INTO prompt_fingerprints (content_hash, tenant_id, agent_id, first_seen_at, last_seen_at, call_count, sample_content)
      VALUES (${hash}, ${tenantId}, ${agentId}, ${now}, ${now}, ${inc}, ${sample})
      ON CONFLICT (content_hash, tenant_id, agent_id)
      DO UPDATE SET last_seen_at = ${now}, call_count = prompt_fingerprints.call_count + ${inc}
    `);
  }

  async getFingerprints(tenantId: string, agentId?: string): Promise<PromptFingerprint[]> {
    if (agentId) {
      const rows = await dbAll<FingerprintRow>(this.db, sql`
        SELECT * FROM prompt_fingerprints
        WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}
        ORDER BY last_seen_at DESC
      `);
      return rows.map(toFingerprint);
    }
    const rows = await dbAll<FingerprintRow>(this.db, sql`
      SELECT * FROM prompt_fingerprints
      WHERE tenant_id = ${tenantId}
      ORDER BY last_seen_at DESC
    `);
    return rows.map(toFingerprint);
  }

  async linkFingerprintToTemplate(
    hash: string,
    tenantId: string,
    templateId: string,
  ): Promise<boolean> {
    const changed = await dbRunCount(this.db, sql`
      UPDATE prompt_fingerprints SET template_id = ${templateId}
      WHERE content_hash = ${hash} AND tenant_id = ${tenantId}
    `);
    return changed > 0;
  }

  // ─── Analytics ────────────────────────────────────────────

  async getVersionAnalytics(
    templateId: string,
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<PromptVersionAnalytics[]> {
    // #175: per-version analytics join events via dialect-aware JSON access.
    const isPg = !isSqliteDb(this.db);
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to ?? new Date().toISOString();

    const rows = await dbAll<{
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
    }>(this.db, sql`
      SELECT
        pv.id AS version_id,
        pv.version_number,
        COUNT(DISTINCT e.id) AS call_count,
        COALESCE(SUM(${sql.raw(jNum(isPg, 'r.payload', 'costUsd'))}), 0) AS total_cost_usd,
        COALESCE(AVG(${sql.raw(jNum(isPg, 'r.payload', 'costUsd'))}), 0) AS avg_cost_usd,
        COALESCE(AVG(${sql.raw(jNum(isPg, 'r.payload', 'latencyMs'))}), 0) AS avg_latency_ms,
        COALESCE(
          CAST(SUM(CASE WHEN ${sql.raw(jText(isPg, 'r.payload', 'finishReason'))} = 'error' THEN 1 ELSE 0 END) AS REAL)
          / NULLIF(COUNT(DISTINCT e.id), 0),
          0
        ) AS error_rate,
        COALESCE(AVG(${sql.raw(jNum(isPg, 'r.payload', 'usage', 'inputTokens'))}), 0) AS avg_input_tokens,
        COALESCE(AVG(${sql.raw(jNum(isPg, 'r.payload', 'usage', 'outputTokens'))}), 0) AS avg_output_tokens,
        COALESCE(SUM(${sql.raw(jNum(isPg, 'r.payload', 'usage', 'cacheReadTokens'))}), 0) AS total_cache_read_tokens,
        COALESCE(SUM(${sql.raw(jNum(isPg, 'r.payload', 'usage', 'cacheWriteTokens'))}), 0) AS total_cache_write_tokens
      FROM prompt_versions pv
      LEFT JOIN events e
        ON ${sql.raw(jText(isPg, 'e.payload', 'promptVersionId'))} = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON ${sql.raw(jText(isPg, 'r.payload', 'callId'))} = ${sql.raw(jText(isPg, 'e.payload', 'callId'))}
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, pv.version_number
      ORDER BY pv.version_number DESC
    `);

    // Cache savings need a per-model rate, so aggregate cache-read tokens grouped
    // by (version, model) and price each group in JS (the main query is per-version).
    const savings = await this.cacheSavingsByVersion(templateId, tenantId, fromDate, toDate);

    // Postgres returns numeric/count aggregates as strings — coerce to numbers.
    return rows.map((r) => ({
      versionId: r.version_id,
      versionNumber: Number(r.version_number),
      callCount: Number(r.call_count),
      totalCostUsd: Number(r.total_cost_usd),
      avgCostUsd: Number(r.avg_cost_usd),
      avgLatencyMs: Number(r.avg_latency_ms),
      errorRate: Number(r.error_rate),
      avgInputTokens: Number(r.avg_input_tokens),
      avgOutputTokens: Number(r.avg_output_tokens),
      totalCacheReadTokens: Number(r.total_cache_read_tokens),
      totalCacheWriteTokens: Number(r.total_cache_write_tokens),
      estimatedCacheSavingsUsd: savings.get(r.version_id) ?? 0,
    }));
  }

  /** Estimated USD saved by cache reads per version = cacheReadTokens × (input − cacheRead) rate. */
  private async cacheSavingsByVersion(
    templateId: string,
    tenantId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Map<string, number>> {
    const isPg = !isSqliteDb(this.db);
    const modelExpr = jText(isPg, 'r.payload', 'model');
    const rows = await dbAll<{ version_id: string; model: string | null; cache_read: number }>(this.db, sql`
      SELECT
        pv.id AS version_id,
        ${sql.raw(modelExpr)} AS model,
        COALESCE(SUM(${sql.raw(jNum(isPg, 'r.payload', 'usage', 'cacheReadTokens'))}), 0) AS cache_read
      FROM prompt_versions pv
      LEFT JOIN events e
        ON ${sql.raw(jText(isPg, 'e.payload', 'promptVersionId'))} = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON ${sql.raw(jText(isPg, 'r.payload', 'callId'))} = ${sql.raw(jText(isPg, 'e.payload', 'callId'))}
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, ${sql.raw(modelExpr)}
    `);

    const byVersion = new Map<string, number>();
    for (const row of rows) {
      const cacheRead = Number(row.cache_read);
      if (!row.model || !cacheRead) continue;
      // Single source of truth for the per-model cache discount (robust to a
      // LiteLLM refresh): savings = the cacheSavingsUsd costUsdDetailed reports.
      const { cacheSavingsUsd } = costUsdDetailed(row.model, {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: cacheRead,
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
  async appendDeployment(
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
  ): Promise<PromptDeployment | null> {
    if (!isKnownEnvironment(input.environment)) return null;

    const version = await dbGet<VersionRow>(this.db, sql`
      SELECT * FROM prompt_versions
      WHERE id = ${input.versionId} AND template_id = ${input.templateId} AND tenant_id = ${tenantId}
    `);
    if (!version) return null;

    // Chain to the env's tail. The UNIQUE(tenant, env, seq) index fails closed
    // if two writers race the same seq (mirrors append-event's race handling).
    const tail = await dbGet<{ seq: number; hash: string }>(this.db, sql`
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

    await dbRun(this.db, sql`
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
  async getLiveVersion(tenantId: string, environment: string, templateId: string): Promise<string | null> {
    const row = await dbGet<{ version_id: string }>(this.db, sql`
      SELECT version_id FROM prompt_deployments
      WHERE tenant_id = ${tenantId} AND environment = ${environment}
        AND template_id = ${templateId} AND status = 'committed'
      ORDER BY seq DESC LIMIT 1
    `);
    return row?.version_id ?? null;
  }

  /** Map of environment → live version id for a template (only envs with a live version). */
  async getLiveVersions(tenantId: string, templateId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const env of getPromptEnvironments()) {
      const v = await this.getLiveVersion(tenantId, env.name, templateId);
      if (v) out[env.name] = v;
    }
    return out;
  }

  // ─── A/B testing (#150) ───────────────────────────────────

  /** Create (or replace) the active A/B test for a (template, environment). */
  async createAbTest(
    tenantId: string,
    templateId: string,
    environment: string,
    variants: AbVariant[],
    createdBy?: string,
  ): Promise<AbTest> {
    const now = new Date().toISOString();
    // One active test per (template, env): stop any existing active one.
    await dbRun(this.db, sql`
      UPDATE prompt_ab_tests SET status = 'stopped', updated_at = ${now}
      WHERE tenant_id = ${tenantId} AND template_id = ${templateId} AND environment = ${environment} AND status = 'active'
    `);
    const id = `abtest_${randomUUID()}`;
    await dbRun(this.db, sql`
      INSERT INTO prompt_ab_tests (id, tenant_id, template_id, environment, variants, status, created_by, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${templateId}, ${environment}, ${JSON.stringify(variants)}, 'active', ${createdBy ?? null}, ${now}, ${now})
    `);
    return { id, tenantId, templateId, environment, variants, status: 'active', createdAt: now, updatedAt: now };
  }

  async getActiveAbTest(tenantId: string, templateId: string, environment: string): Promise<AbTest | undefined> {
    const r = await dbGet<AbTestRow>(this.db, sql`
      SELECT * FROM prompt_ab_tests
      WHERE tenant_id = ${tenantId} AND template_id = ${templateId} AND environment = ${environment} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `);
    return r ? toAbTest(r) : undefined;
  }

  async listAbTests(tenantId: string, templateId: string): Promise<AbTest[]> {
    return (await dbAll<AbTestRow>(this.db, sql`SELECT * FROM prompt_ab_tests WHERE tenant_id = ${tenantId} AND template_id = ${templateId} ORDER BY created_at DESC`)).map(toAbTest);
  }

  async stopAbTest(tenantId: string, id: string): Promise<boolean> {
    const existing = await dbGet<{ id: string }>(this.db, sql`SELECT id FROM prompt_ab_tests WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'active'`);
    await dbRun(this.db, sql`UPDATE prompt_ab_tests SET status = 'stopped', updated_at = ${new Date().toISOString()} WHERE tenant_id = ${tenantId} AND id = ${id}`);
    return existing !== undefined;
  }

  /**
   * Resolve the version to serve for (template, environment): an active A/B test's
   * weighted (sticky-by-key) variant, else the single live version.
   */
  async resolveVersion(
    tenantId: string,
    templateId: string,
    environment: string,
    key?: string,
  ): Promise<{ versionId: string; label: string; abTestId?: string } | null> {
    const ab = await this.getActiveAbTest(tenantId, templateId, environment);
    if (ab) {
      const v = pickVariant(ab.variants, key);
      if (v) return { versionId: v.versionId, label: v.label, abTestId: ab.id };
    }
    const live = await this.getLiveVersion(tenantId, environment, templateId);
    return live ? { versionId: live, label: environment } : null;
  }

  /** Deploy history (newest first), optionally filtered by template and/or environment. */
  async listDeployments(
    tenantId: string,
    opts: { templateId?: string; environment?: string; limit?: number } = {},
  ): Promise<PromptDeployment[]> {
    const conds = [sql`tenant_id = ${tenantId}`];
    if (opts.templateId) conds.push(sql`template_id = ${opts.templateId}`);
    if (opts.environment) conds.push(sql`environment = ${opts.environment}`);
    const where = sql.join(conds, sql` AND `);
    const limit = Math.min(opts.limit ?? 200, 1000);
    const rows = await dbAll<DeploymentRow>(this.db, sql`
      SELECT * FROM prompt_deployments WHERE ${where}
      ORDER BY created_at DESC, seq DESC LIMIT ${limit}
    `);
    return rows.map(toDeployment);
  }

  /** Verify a (tenant, environment) deploy chain: seq continuity, prev-hash links, and per-row hashes. */
  async verifyDeployLedger(tenantId: string, environment: string): Promise<DeployLedgerVerifyResult> {
    const rows = await dbAll<DeploymentRow>(this.db, sql`
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
  async getVersionAnalyticsByAgent(
    templateId: string,
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<PromptAgentUsage[]> {
    // #175: dialect-aware JSON access (events.metadata/payload jsonb on pg).
    const isPg = !isSqliteDb(this.db);
    const fromDate = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to ?? new Date().toISOString();
    const verifiedId = jText(isPg, 'e.metadata', 'verifiedAgentId');
    const resolvedExpr = `COALESCE(${verifiedId}, e.agent_id)`;
    const verifiedExpr = `CASE WHEN ${verifiedId} IS NOT NULL THEN 1 ELSE 0 END`;

    const rows = await dbAll<{
      version_id: string;
      version_number: number;
      resolved_agent_id: string | null;
      verified: number;
      call_count: number;
      total_cost_usd: number;
      avg_latency_ms: number;
      error_rate: number;
    }>(this.db, sql`
      SELECT
        pv.id AS version_id,
        pv.version_number,
        ${sql.raw(resolvedExpr)} AS resolved_agent_id,
        ${sql.raw(verifiedExpr)} AS verified,
        COUNT(DISTINCT e.id) AS call_count,
        COALESCE(SUM(${sql.raw(jNum(isPg, 'r.payload', 'costUsd'))}), 0) AS total_cost_usd,
        COALESCE(AVG(${sql.raw(jNum(isPg, 'r.payload', 'latencyMs'))}), 0) AS avg_latency_ms,
        COALESCE(
          CAST(SUM(CASE WHEN ${sql.raw(jText(isPg, 'r.payload', 'finishReason'))} = 'error' THEN 1 ELSE 0 END) AS REAL)
          / NULLIF(COUNT(DISTINCT e.id), 0),
          0
        ) AS error_rate
      FROM prompt_versions pv
      JOIN events e
        ON ${sql.raw(jText(isPg, 'e.payload', 'promptVersionId'))} = pv.id
        AND e.event_type = 'llm_call'
        AND e.tenant_id = ${tenantId}
        AND e.timestamp BETWEEN ${fromDate} AND ${toDate}
      LEFT JOIN events r
        ON ${sql.raw(jText(isPg, 'r.payload', 'callId'))} = ${sql.raw(jText(isPg, 'e.payload', 'callId'))}
        AND r.event_type = 'llm_response'
        AND r.tenant_id = ${tenantId}
      WHERE pv.template_id = ${templateId} AND pv.tenant_id = ${tenantId}
      GROUP BY pv.id, ${sql.raw(resolvedExpr)}, ${sql.raw(verifiedExpr)}
      ORDER BY pv.version_number DESC, call_count DESC
    `);

    // Postgres returns numeric/count aggregates as strings — coerce.
    return rows.map((r) => ({
      versionId: r.version_id,
      versionNumber: Number(r.version_number),
      agentId: r.resolved_agent_id ?? 'unknown',
      verified: Number(r.verified) === 1,
      callCount: Number(r.call_count),
      totalCostUsd: Number(r.total_cost_usd),
      avgLatencyMs: Number(r.avg_latency_ms),
      errorRate: Number(r.error_rate),
    }));
  }
}

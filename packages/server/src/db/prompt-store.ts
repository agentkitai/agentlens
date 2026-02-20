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
} from '@agentlensai/core';

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
  ): void {
    const now = new Date().toISOString();
    const sample = sampleContent?.slice(0, 2000) ?? null;

    this.db.run(sql`
      INSERT INTO prompt_fingerprints (content_hash, tenant_id, agent_id, first_seen_at, last_seen_at, call_count, sample_content)
      VALUES (${hash}, ${tenantId}, ${agentId}, ${now}, ${now}, ${1}, ${sample})
      ON CONFLICT (content_hash, tenant_id, agent_id)
      DO UPDATE SET last_seen_at = ${now}, call_count = call_count + 1
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
        COALESCE(AVG(json_extract(r.payload, '$.usage.outputTokens')), 0) AS avg_output_tokens
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
    }));
  }
}

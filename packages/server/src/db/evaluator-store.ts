/**
 * EvaluatorStore (#55 Phase 4 — evaluator catalog).
 *
 * CRUD + publish/verify lifecycle for reusable, named scorer definitions. Built-in
 * evaluators are seeded under a shared SYSTEM_TENANT so they're visible to every
 * tenant (they carry no tenant data) and are read-only; user-defined evaluators are
 * tenant-isolated. Raw-sql, SQLite-backed — mirrors EvalStore/PromptStore.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';
import type {
  EvaluatorDefinition,
  EvaluatorStatus,
  ScorerConfig,
  ScorerType,
} from '@agentkitai/agentlens-core';

/** Tenant the read-only built-in catalog lives under (visible to all tenants). */
export const SYSTEM_TENANT = '__system__';

interface EvaluatorRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  scorer_type: string;
  config_template: string;
  tags: string;
  builtin: number;
  status: string;
  published_by: string | null;
  published_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEvaluatorInput {
  name: string;
  description?: string;
  scorerType: ScorerType;
  configTemplate: ScorerConfig;
  tags?: string[];
}

export interface ListEvaluatorFilter {
  scorerType?: ScorerType;
  tag?: string;
  status?: EvaluatorStatus;
  builtin?: boolean;
  verified?: boolean;
}

function toEvaluator(row: EvaluatorRow): EvaluatorDefinition {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    scorerType: row.scorer_type as ScorerType,
    configTemplate: JSON.parse(row.config_template) as ScorerConfig,
    tags: JSON.parse(row.tags) as string[],
    builtin: row.builtin === 1,
    status: row.status as EvaluatorStatus,
    publishedBy: row.published_by ?? undefined,
    publishedAt: row.published_at ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EvaluatorStore {
  constructor(private db: AnyDb) {}

  async create(tenantId: string, input: CreateEvaluatorInput): Promise<EvaluatorDefinition> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: EvaluatorRow = {
      id,
      tenant_id: tenantId,
      name: input.name,
      description: input.description ?? null,
      scorer_type: input.scorerType,
      config_template: JSON.stringify(input.configTemplate ?? {}),
      tags: JSON.stringify(input.tags ?? []),
      builtin: 0,
      status: 'draft',
      published_by: null,
      published_at: null,
      verified_at: null,
      created_at: now,
      updated_at: now,
    };
    await dbRun(this.db, sql`
      INSERT INTO evaluator_definitions
        (id, tenant_id, name, description, scorer_type, config_template, tags, builtin, status, published_by, published_at, verified_at, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${row.name}, ${row.description}, ${row.scorer_type}, ${row.config_template}, ${row.tags}, ${0}, ${'draft'}, ${null}, ${null}, ${null}, ${now}, ${now})
    `);
    return toEvaluator(row);
  }

  /** Get an evaluator visible to the tenant (its own, or a global built-in). */
  async get(tenantId: string, id: string): Promise<EvaluatorDefinition | null> {
    const rows = await dbAll<EvaluatorRow>(this.db, sql`
      SELECT * FROM evaluator_definitions
      WHERE id = ${id} AND (tenant_id = ${tenantId} OR builtin = 1)
      LIMIT 1
    `);
    return rows[0] ? toEvaluator(rows[0]) : null;
  }

  /** List evaluators visible to the tenant (own + built-ins), newest first. */
  async list(tenantId: string, filter: ListEvaluatorFilter = {}): Promise<EvaluatorDefinition[]> {
    const conds = [sql`(tenant_id = ${tenantId} OR builtin = 1)`];
    if (filter.scorerType) conds.push(sql`scorer_type = ${filter.scorerType}`);
    if (filter.status) conds.push(sql`status = ${filter.status}`);
    if (filter.builtin !== undefined) conds.push(sql`builtin = ${filter.builtin ? 1 : 0}`);
    if (filter.verified !== undefined) conds.push(filter.verified ? sql`verified_at IS NOT NULL` : sql`verified_at IS NULL`);
    const where = sql.join(conds, sql` AND `);
    const rows = await dbAll<EvaluatorRow>(this.db, sql`
      SELECT * FROM evaluator_definitions WHERE ${where} ORDER BY created_at DESC
    `);
    let result = rows.map(toEvaluator);
    // Tag filter in JS (tags are a JSON array column).
    if (filter.tag) result = result.filter((e) => e.tags.includes(filter.tag!));
    return result;
  }

  /** Update metadata (name/description/tags) of a tenant-owned evaluator. Returns
   *  null if not found; built-ins (other tenant) never match the tenant scope. */
  async update(tenantId: string, id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<EvaluatorDefinition | null> {
    const existing = await dbGet<EvaluatorRow>(this.db, sql`
      SELECT * FROM evaluator_definitions WHERE id = ${id} AND tenant_id = ${tenantId} AND builtin = 0 LIMIT 1
    `);
    if (!existing) return null;
    const now = new Date().toISOString();
    const name = patch.name ?? existing.name;
    const description = patch.description !== undefined ? patch.description : existing.description;
    const tags = patch.tags !== undefined ? JSON.stringify(patch.tags) : existing.tags;
    await dbRun(this.db, sql`
      UPDATE evaluator_definitions SET name = ${name}, description = ${description}, tags = ${tags}, updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND builtin = 0
    `);
    return this.get(tenantId, id);
  }

  /** Delete a tenant-owned (non-builtin) evaluator. Returns false if not found. */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const n = await dbRunCount(this.db, sql`
      DELETE FROM evaluator_definitions WHERE id = ${id} AND tenant_id = ${tenantId} AND builtin = 0
    `);
    return n > 0;
  }

  /** draft → published. Returns null if not found / not tenant-owned. */
  async publish(tenantId: string, id: string, publishedBy?: string): Promise<EvaluatorDefinition | null> {
    const now = new Date().toISOString();
    const n = await dbRunCount(this.db, sql`
      UPDATE evaluator_definitions
      SET status = ${'published'}, published_by = ${publishedBy ?? null}, published_at = ${now}, updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND builtin = 0
    `);
    return n > 0 ? this.get(tenantId, id) : null;
  }

  /** Mark a tenant-owned evaluator verified (trust signal). Returns null if not found. */
  async verify(tenantId: string, id: string): Promise<EvaluatorDefinition | null> {
    const now = new Date().toISOString();
    const n = await dbRunCount(this.db, sql`
      UPDATE evaluator_definitions SET verified_at = ${now}, updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND builtin = 0
    `);
    return n > 0 ? this.get(tenantId, id) : null;
  }

  /**
   * Idempotently seed the read-only built-in catalog under SYSTEM_TENANT. Built-ins
   * have deterministic ids so re-seeding (every startup) updates them in place.
   */
  async seedBuiltins(builtins: Array<{ id: string; name: string; description: string; scorerType: ScorerType; configTemplate: ScorerConfig; tags: string[] }>): Promise<void> {
    const now = new Date().toISOString();
    for (const b of builtins) {
      await dbRun(this.db, sql`
        INSERT INTO evaluator_definitions
          (id, tenant_id, name, description, scorer_type, config_template, tags, builtin, status, published_by, published_at, verified_at, created_at, updated_at)
        VALUES (${b.id}, ${SYSTEM_TENANT}, ${b.name}, ${b.description}, ${b.scorerType}, ${JSON.stringify(b.configTemplate)}, ${JSON.stringify(b.tags)}, ${1}, ${'published'}, ${'agentlens'}, ${now}, ${now}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          name = ${b.name}, description = ${b.description}, scorer_type = ${b.scorerType},
          config_template = ${JSON.stringify(b.configTemplate)}, tags = ${JSON.stringify(b.tags)}, updated_at = ${now}
      `);
    }
  }
}

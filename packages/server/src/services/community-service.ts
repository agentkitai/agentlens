/**
 * Community Sharing Service (Stories 4.1–4.3)
 *
 * Handles lesson sharing, search, configuration, and deny-list management.
 * Enforces hierarchical toggles: tenant OFF overrides agent ON.
 * Rate limiting: 50/hr per tenant. Audit log on every operation.
 */

import { randomUUID, createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import * as schema from '../db/schema.sqlite.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import { RedactionPipeline, type RedactionPipelineConfig } from '../lib/redaction/pipeline.js';
import { LessonStore } from '../db/lesson-store.js';
import type {
  SharingConfig,
  AgentSharingConfig,
  LessonSharingCategory,
  SharedLesson,
  CommunitySearchResult,
  SharingAuditEvent,
  RedactionFinding,
} from '@agentlensai/core';
import { LESSON_SHARING_CATEGORIES, createRawLessonContent } from '@agentlensai/core';

// ─── Pool Transport Interface ────────────────────────────

export interface PoolTransport {
  share(data: {
    anonymousContributorId: string;
    category: string;
    title: string;
    content: string;
    embedding: number[];
    qualitySignals?: Record<string, unknown>;
  }): Promise<{ id: string }>;

  search(data: {
    embedding: number[];
    category?: string;
    minReputation?: number;
    limit?: number;
  }): Promise<{
    results: Array<{
      lesson: {
        id: string;
        category: string;
        title: string;
        content: string;
        reputationScore: number;
        qualitySignals: Record<string, unknown>;
      };
      similarity: number;
    }>;
  }>;
}

/** In-memory transport for testing */
export class LocalCommunityPoolTransport implements PoolTransport {
  readonly shared: Array<{
    id: string;
    anonymousContributorId: string;
    category: string;
    title: string;
    content: string;
    embedding: number[];
    qualitySignals?: Record<string, unknown>;
  }> = [];

  async share(data: Parameters<PoolTransport['share']>[0]): Promise<{ id: string }> {
    const id = randomUUID();
    this.shared.push({ id, ...data });
    return { id };
  }

  async search(data: Parameters<PoolTransport['search']>[0]): Promise<ReturnType<PoolTransport['search']> extends Promise<infer R> ? R : never> {
    let results = this.shared.map((lesson) => ({
      lesson: {
        id: lesson.id,
        category: lesson.category,
        title: lesson.title,
        content: lesson.content,
        reputationScore: 50,
        qualitySignals: lesson.qualitySignals ?? {},
      },
      similarity: cosineSimilarity(data.embedding, lesson.embedding),
    }));

    if (data.category) {
      results = results.filter((r) => r.lesson.category === data.category);
    }
    if (data.minReputation !== undefined) {
      results = results.filter((r) => r.lesson.reputationScore >= data.minReputation!);
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return { results: results.slice(0, data.limit ?? 50) };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Simple TF-IDF Embedding ─────────────────────────────

/** Compute a lightweight hash-based embedding for text */
export function computeSimpleEmbedding(text: string, dimensions = 64): number[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const vec = new Float64Array(dimensions);
  for (const word of words) {
    const hash = createHash('md5').update(word).digest();
    for (let i = 0; i < dimensions; i++) {
      vec[i] += (hash[i % hash.length] - 128) / 128;
    }
  }
  // Normalize
  let mag = 0;
  for (let i = 0; i < dimensions; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < dimensions; i++) vec[i] /= mag;
  return Array.from(vec);
}

// ─── Rate Limiter ────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const RATE_WINDOW_MS = 3_600_000; // 1 hour
const DEFAULT_RATE_LIMIT = 50;

class SharingRateLimiter {
  private buckets = new Map<string, RateBucket>();

  check(key: string, limit: number = DEFAULT_RATE_LIMIT): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

// ─── Deny List Rule ──────────────────────────────────────

export interface DenyListRule {
  id: string;
  tenantId: string;
  pattern: string;
  isRegex: boolean;
  reason: string;
  createdAt: string;
}

// ─── Share Result ────────────────────────────────────────

export type ShareResult =
  | { status: 'shared'; anonymousLessonId: string; redactionFindings: RedactionFinding[] }
  | { status: 'blocked'; reason: string }
  | { status: 'pending_review'; reviewId: string }
  | { status: 'error'; error: string }
  | { status: 'rate_limited' }
  | { status: 'disabled'; reason: string };

// ─── Community Service ───────────────────────────────────

export interface CommunityServiceOptions {
  transport: PoolTransport;
  redactionConfig?: RedactionPipelineConfig;
  now?: () => Date;
}

export class CommunityService {
  private readonly db: SqliteDb;
  private readonly transport: PoolTransport;
  private readonly anonIdManager: AnonymousIdManager;
  private readonly lessonStore: LessonStore;
  private readonly redactionPipeline: RedactionPipeline;
  readonly rateLimiter = new SharingRateLimiter();
  private readonly now: () => Date;

  constructor(db: SqliteDb, options: CommunityServiceOptions) {
    this.db = db;
    this.transport = options.transport;
    this.anonIdManager = new AnonymousIdManager(db, { now: options.now });
    this.lessonStore = new LessonStore(db);
    this.redactionPipeline = new RedactionPipeline(options.redactionConfig);
    this.now = options.now ?? (() => new Date());
  }

  // ─── Sharing Config (tenant-level) ─────────────────

  getSharingConfig(tenantId: string): SharingConfig {
    const row = this.db
      .select()
      .from(schema.sharingConfig)
      .where(eq(schema.sharingConfig.tenantId, tenantId))
      .get();

    if (row) {
      return {
        tenantId: row.tenantId,
        enabled: row.enabled,
        humanReviewEnabled: row.humanReviewEnabled,
        poolEndpoint: row.poolEndpoint,
        anonymousContributorId: row.anonymousContributorId,
        purgeToken: row.purgeToken,
        rateLimitPerHour: row.rateLimitPerHour,
        volumeAlertThreshold: row.volumeAlertThreshold,
        updatedAt: row.updatedAt,
      };
    }

    return {
      tenantId,
      enabled: false,
      humanReviewEnabled: false,
      poolEndpoint: null,
      anonymousContributorId: null,
      purgeToken: null,
      rateLimitPerHour: 50,
      volumeAlertThreshold: 100,
      updatedAt: new Date().toISOString(),
    };
  }

  updateSharingConfig(tenantId: string, updates: Partial<Omit<SharingConfig, 'tenantId' | 'updatedAt'>>): SharingConfig {
    const now = this.now().toISOString();
    const existing = this.db
      .select()
      .from(schema.sharingConfig)
      .where(eq(schema.sharingConfig.tenantId, tenantId))
      .get();

    if (existing) {
      const setObj: Record<string, unknown> = { updatedAt: now };
      if (updates.enabled !== undefined) setObj.enabled = updates.enabled;
      if (updates.humanReviewEnabled !== undefined) setObj.humanReviewEnabled = updates.humanReviewEnabled;
      if (updates.poolEndpoint !== undefined) setObj.poolEndpoint = updates.poolEndpoint;
      if (updates.anonymousContributorId !== undefined) setObj.anonymousContributorId = updates.anonymousContributorId;
      if (updates.purgeToken !== undefined) setObj.purgeToken = updates.purgeToken;
      if (updates.rateLimitPerHour !== undefined) setObj.rateLimitPerHour = updates.rateLimitPerHour;
      if (updates.volumeAlertThreshold !== undefined) setObj.volumeAlertThreshold = updates.volumeAlertThreshold;
      this.db.update(schema.sharingConfig).set(setObj).where(eq(schema.sharingConfig.tenantId, tenantId)).run();
    } else {
      this.db.insert(schema.sharingConfig).values({
        tenantId,
        enabled: updates.enabled ?? false,
        humanReviewEnabled: updates.humanReviewEnabled ?? false,
        poolEndpoint: updates.poolEndpoint ?? null,
        anonymousContributorId: updates.anonymousContributorId ?? null,
        purgeToken: updates.purgeToken ?? null,
        rateLimitPerHour: updates.rateLimitPerHour ?? 50,
        volumeAlertThreshold: updates.volumeAlertThreshold ?? 100,
        updatedAt: now,
      }).run();
    }

    return this.getSharingConfig(tenantId);
  }

  // ─── Agent Sharing Config ──────────────────────────

  getAgentSharingConfig(tenantId: string, agentId: string): AgentSharingConfig {
    const row = this.db
      .select()
      .from(schema.agentSharingConfig)
      .where(and(
        eq(schema.agentSharingConfig.tenantId, tenantId),
        eq(schema.agentSharingConfig.agentId, agentId),
      ))
      .get();

    if (row) {
      return {
        tenantId: row.tenantId,
        agentId: row.agentId,
        enabled: row.enabled,
        categories: JSON.parse(row.categories) as LessonSharingCategory[],
        updatedAt: row.updatedAt,
      };
    }

    return {
      tenantId,
      agentId,
      enabled: false,
      categories: [],
      updatedAt: new Date().toISOString(),
    };
  }

  updateAgentSharingConfig(
    tenantId: string,
    agentId: string,
    updates: Partial<Pick<AgentSharingConfig, 'enabled' | 'categories'>>,
  ): AgentSharingConfig {
    const now = this.now().toISOString();
    const existing = this.db
      .select()
      .from(schema.agentSharingConfig)
      .where(and(
        eq(schema.agentSharingConfig.tenantId, tenantId),
        eq(schema.agentSharingConfig.agentId, agentId),
      ))
      .get();

    if (existing) {
      const setObj: Record<string, unknown> = { updatedAt: now };
      if (updates.enabled !== undefined) setObj.enabled = updates.enabled;
      if (updates.categories !== undefined) setObj.categories = JSON.stringify(updates.categories);
      this.db.update(schema.agentSharingConfig)
        .set(setObj)
        .where(and(
          eq(schema.agentSharingConfig.tenantId, tenantId),
          eq(schema.agentSharingConfig.agentId, agentId),
        ))
        .run();
    } else {
      this.db.insert(schema.agentSharingConfig).values({
        tenantId,
        agentId,
        enabled: updates.enabled ?? false,
        categories: JSON.stringify(updates.categories ?? []),
        updatedAt: now,
      }).run();
    }

    return this.getAgentSharingConfig(tenantId, agentId);
  }

  // ─── Deny List CRUD ────────────────────────────────

  getDenyList(tenantId: string): DenyListRule[] {
    return this.db
      .select()
      .from(schema.denyListRules)
      .where(eq(schema.denyListRules.tenantId, tenantId))
      .all()
      .map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        pattern: r.pattern,
        isRegex: r.isRegex,
        reason: r.reason,
        createdAt: r.createdAt,
      }));
  }

  addDenyListRule(tenantId: string, pattern: string, isRegex: boolean, reason: string): DenyListRule {
    const id = randomUUID();
    const now = this.now().toISOString();

    // Validate regex if isRegex
    if (isRegex) {
      try {
        new RegExp(pattern);
      } catch {
        throw new Error(`Invalid regex pattern: ${pattern}`);
      }
    }

    this.db.insert(schema.denyListRules).values({
      id,
      tenantId,
      pattern,
      isRegex,
      reason,
      createdAt: now,
    }).run();

    return { id, tenantId, pattern, isRegex, reason, createdAt: now };
  }

  deleteDenyListRule(tenantId: string, ruleId: string): boolean {
    const result = this.db
      .delete(schema.denyListRules)
      .where(and(
        eq(schema.denyListRules.id, ruleId),
        eq(schema.denyListRules.tenantId, tenantId),
      ))
      .run();
    return result.changes > 0;
  }

  // ─── Share (Story 4.1) ─────────────────────────────

  async share(tenantId: string, lessonId: string, initiatedBy: string = 'system'): Promise<ShareResult> {
    // 1. Check tenant-level toggle (NO CACHING — always read from DB)
    const tenantConfig = this.getSharingConfig(tenantId);
    if (!tenantConfig.enabled) {
      return { status: 'disabled', reason: 'Tenant sharing is disabled' };
    }

    // 2. Load lesson
    const lesson = this.lessonStore.get(tenantId, lessonId);
    if (!lesson) {
      return { status: 'error', error: 'Lesson not found' };
    }

    // 3. Check agent-level toggle (hierarchical enforcement)
    if (lesson.agentId) {
      const agentConfig = this.getAgentSharingConfig(tenantId, lesson.agentId);
      if (!agentConfig.enabled) {
        return { status: 'disabled', reason: 'Agent sharing is disabled' };
      }

      // Check category-level toggle
      const category = lesson.category as LessonSharingCategory;
      if (agentConfig.categories.length > 0 && !agentConfig.categories.includes(category)) {
        return { status: 'disabled', reason: `Category '${category}' is not enabled for this agent` };
      }
    }

    // 4. Rate limiting
    const rateLimit = tenantConfig.rateLimitPerHour || DEFAULT_RATE_LIMIT;
    if (!this.rateLimiter.check(tenantId, rateLimit)) {
      this.writeAuditLog(tenantId, {
        eventType: 'rate',
        lessonId,
        initiatedBy,
      });
      return { status: 'rate_limited' };
    }

    // 5. Get deny list patterns for redaction context
    const denyListRules = this.getDenyList(tenantId);
    const denyListPatterns = denyListRules.map((r) => r.isRegex ? r.pattern : r.pattern);

    // 6. Run redaction pipeline
    const rawContent = createRawLessonContent(lesson.title, lesson.content, lesson.context ?? {});
    const redactionResult = await this.redactionPipeline.process(rawContent, {
      tenantId,
      agentId: lesson.agentId,
      category: lesson.category,
      denyListPatterns,
      knownTenantTerms: [],
    });

    if (redactionResult.status === 'blocked') {
      this.writeAuditLog(tenantId, {
        eventType: 'share',
        lessonId,
        initiatedBy,
      });
      return { status: 'blocked', reason: redactionResult.reason };
    }

    if (redactionResult.status === 'pending_review') {
      this.writeAuditLog(tenantId, {
        eventType: 'share',
        lessonId,
        initiatedBy,
      });
      return { status: 'pending_review', reviewId: redactionResult.reviewId };
    }

    if (redactionResult.status === 'error') {
      return { status: 'error', error: redactionResult.error };
    }

    // 7. Generate anonymous contributor ID
    const anonymousContributorId = this.anonIdManager.getOrRotateContributorId(tenantId);

    // 8. Compute embedding
    const redactedContent = redactionResult.content;
    const embedding = computeSimpleEmbedding(`${redactedContent.title} ${redactedContent.content}`);

    // 9. Send to pool
    let poolResult: { id: string };
    try {
      poolResult = await this.transport.share({
        anonymousContributorId,
        category: lesson.category,
        title: redactedContent.title,
        content: redactedContent.content,
        embedding,
        qualitySignals: lesson.context ?? {},
      });
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    // 10. Write audit log
    this.writeAuditLog(tenantId, {
      eventType: 'share',
      lessonId,
      anonymousLessonId: poolResult.id,
      redactionFindings: redactionResult.findings,
      initiatedBy,
    });

    return {
      status: 'shared',
      anonymousLessonId: poolResult.id,
      redactionFindings: redactionResult.findings,
    };
  }

  // ─── Search (Story 4.2) ────────────────────────────

  async search(
    tenantId: string,
    query: string,
    options?: { category?: string; minReputation?: number; limit?: number },
    initiatedBy: string = 'system',
  ): Promise<CommunitySearchResult> {
    const limit = Math.min(options?.limit ?? 50, 50);
    const embedding = computeSimpleEmbedding(query);

    const poolResult = await this.transport.search({
      embedding,
      category: options?.category,
      minReputation: options?.minReputation,
      limit,
    });

    // Strip any identifying metadata from results
    const lessons: SharedLesson[] = poolResult.results.map((r) => ({
      id: r.lesson.id,
      category: r.lesson.category as LessonSharingCategory,
      title: r.lesson.title,
      content: r.lesson.content,
      reputationScore: r.lesson.reputationScore,
      qualitySignals: r.lesson.qualitySignals ?? {},
    }));

    // Write audit log
    this.writeAuditLog(tenantId, {
      eventType: 'query',
      queryText: query,
      resultIds: lessons.map((l) => l.id),
      initiatedBy,
    });

    return { lessons, total: lessons.length, query };
  }

  // ─── Audit Log ─────────────────────────────────────

  private writeAuditLog(
    tenantId: string,
    data: {
      eventType: string;
      lessonId?: string;
      anonymousLessonId?: string;
      redactionFindings?: RedactionFinding[];
      queryText?: string;
      resultIds?: string[];
      initiatedBy: string;
    },
  ): void {
    this.db.insert(schema.sharingAuditLog).values({
      id: randomUUID(),
      tenantId,
      eventType: data.eventType,
      lessonId: data.lessonId ?? null,
      anonymousLessonId: data.anonymousLessonId ?? null,
      lessonHash: null,
      redactionFindings: data.redactionFindings ? JSON.stringify(data.redactionFindings) : null,
      queryText: data.queryText ?? null,
      resultIds: data.resultIds ? JSON.stringify(data.resultIds) : null,
      poolEndpoint: null,
      initiatedBy: data.initiatedBy,
      timestamp: this.now().toISOString(),
    }).run();
  }

  getAuditLog(tenantId: string, limit = 50): SharingAuditEvent[] {
    const rows = this.db
      .select()
      .from(schema.sharingAuditLog)
      .where(eq(schema.sharingAuditLog.tenantId, tenantId))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      eventType: r.eventType as SharingAuditEvent['eventType'],
      lessonId: r.lessonId ?? undefined,
      anonymousLessonId: r.anonymousLessonId ?? undefined,
      lessonHash: r.lessonHash ?? undefined,
      redactionFindings: r.redactionFindings ? JSON.parse(r.redactionFindings) : undefined,
      queryText: r.queryText ?? undefined,
      resultIds: r.resultIds ? JSON.parse(r.resultIds) : undefined,
      poolEndpoint: r.poolEndpoint ?? undefined,
      initiatedBy: r.initiatedBy ?? 'system',
      timestamp: r.timestamp,
    }));
  }
}

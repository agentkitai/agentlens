/**
 * Shared query helpers extracted from SqliteEventStore (Story S-7.2).
 *
 * These pure functions handle row mapping and condition building,
 * decoupled from the store class so they can be reused by other
 * storage backends or utility code.
 */

import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm';
import type {
  AgentLensEvent,
  EventQuery,
  Session,
  SessionQuery,
  Agent,
  AlertRule,
} from '@agentkitai/agentlens-core';
import { events, sessions, agents, alertRules } from '../schema.sqlite.js';

// ─── JSON Helpers ──────────────────────────────────────────

/**
 * Safe JSON.parse that returns a fallback on any error instead of throwing.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Condition Builders ────────────────────────────────────

/**
 * Build an array of drizzle SQL conditions from an EventQuery.
 * The caller should combine them with `and(...)`.
 */
export function buildEventConditions(query: Omit<EventQuery, 'limit' | 'offset'>) {
  const conditions = [];

  if (query.tenantId) {
    conditions.push(eq(events.tenantId, query.tenantId));
  }
  // org→project isolation (#147) — filtered only when the scope provides them.
  if (query.orgId) {
    conditions.push(eq(events.orgId, query.orgId));
  }
  if (query.projectId) {
    conditions.push(eq(events.projectId, query.projectId));
  }
  if (query.sessionId) {
    conditions.push(eq(events.sessionId, query.sessionId));
  }
  if (query.agentId) {
    conditions.push(eq(events.agentId, query.agentId));
  }
  if (query.eventType) {
    if (Array.isArray(query.eventType)) {
      conditions.push(inArray(events.eventType, query.eventType));
    } else {
      conditions.push(eq(events.eventType, query.eventType));
    }
  }
  if (query.severity) {
    if (Array.isArray(query.severity)) {
      conditions.push(inArray(events.severity, query.severity));
    } else {
      conditions.push(eq(events.severity, query.severity));
    }
  }
  if (query.from) {
    conditions.push(gte(events.timestamp, query.from));
  }
  if (query.to) {
    conditions.push(lte(events.timestamp, query.to));
  }
  if (query.search) {
    // L-14 FIX: Limit search string length to prevent DoS
    const searchTerm = query.search.slice(0, 500);
    // Escape LIKE wildcards to prevent wildcard abuse
    const escaped = searchTerm
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    conditions.push(sql`${events.payload} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
  }

  return conditions;
}

/**
 * Build an array of drizzle SQL conditions from a SessionQuery.
 * Uses json_each() for exact tag matching with OR semantics.
 */
export function buildSessionConditions(query: SessionQuery) {
  const conditions = [];

  if (query.tenantId) {
    conditions.push(eq(sessions.tenantId, query.tenantId));
  }
  // org→project isolation (#147) — filtered only when the scope provides them.
  if (query.orgId) {
    conditions.push(eq(sessions.orgId, query.orgId));
  }
  if (query.projectId) {
    conditions.push(eq(sessions.projectId, query.projectId));
  }
  if (query.agentId) {
    conditions.push(eq(sessions.agentId, query.agentId));
  }
  if (query.status) {
    if (Array.isArray(query.status)) {
      if (query.status.length === 1) {
        conditions.push(eq(sessions.status, query.status[0]));
      } else if (query.status.length > 1) {
        conditions.push(inArray(sessions.status, query.status));
      }
    } else {
      conditions.push(eq(sessions.status, query.status));
    }
  }
  if (query.from) {
    conditions.push(gte(sessions.startedAt, query.from));
  }
  if (query.to) {
    conditions.push(lte(sessions.startedAt, query.to));
  }
  if (query.tags && query.tags.length > 0) {
    const tagPlaceholders = query.tags.map((tag) => sql`${tag}`);
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM json_each(${sessions.tags}) AS je
        WHERE je.value IN (${sql.join(tagPlaceholders, sql`, `)})
      )`,
    );
  }

  return conditions;
}

// ─── Row Mappers ───────────────────────────────────────────

/** Map a raw events table row to an AgentLensEvent. */
export function mapEventRow(row: typeof events.$inferSelect): AgentLensEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.sessionId,
    agentId: row.agentId,
    eventType: row.eventType as AgentLensEvent['eventType'],
    severity: row.severity as AgentLensEvent['severity'],
    payload: safeJsonParse(row.payload, {} as Record<string, unknown>),
    metadata: safeJsonParse(row.metadata, {} as Record<string, unknown>),
    prevHash: row.prevHash,
    hash: row.hash,
    tenantId: row.tenantId,
  };
}

/** Map a raw sessions table row to a Session. */
/**
 * Sessions with no event for this long report as 'idle' instead of 'active'.
 * Exporters like Claude Code rarely emit session_ended, so a stored 'active' can
 * outlive the real session. Derived at read (not a stored terminal state) so a
 * later event — last_event_at bumps — flips it back to 'active' automatically.
 * Tune with AGENTLENS_SESSION_IDLE_MINUTES (default 30).
 */
export const SESSION_IDLE_MS = (Number(process.env['AGENTLENS_SESSION_IDLE_MINUTES']) || 30) * 60_000;

export function deriveSessionStatus(
  stored: string,
  lastEventAt: string | null | undefined,
  startedAt: string,
): Session['status'] {
  if (stored !== 'active') return stored as Session['status']; // completed/error are terminal
  const last = Date.parse(lastEventAt ?? startedAt);
  return Number.isFinite(last) && Date.now() - last > SESSION_IDLE_MS ? 'idle' : 'active';
}

export function mapSessionRow(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    status: deriveSessionStatus(row.status, row.lastEventAt, row.startedAt),
    eventCount: row.eventCount,
    toolCallCount: row.toolCallCount,
    errorCount: row.errorCount,
    totalCostUsd: row.totalCostUsd,
    llmCallCount: row.llmCallCount,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    tags: safeJsonParse(row.tags, [] as string[]),
    tenantId: row.tenantId,
  };
}

/** Map a raw agents table row to an Agent. */
export function mapAgentRow(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sessionCount: row.sessionCount,
    tenantId: row.tenantId,
    modelOverride: row.modelOverride ?? undefined,
    pausedAt: row.pausedAt ?? undefined,
    pauseReason: row.pauseReason ?? undefined,
  };
}

/** Map a raw alert_rules table row to an AlertRule. */
export function mapAlertRuleRow(row: typeof alertRules.$inferSelect): AlertRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    condition: row.condition as AlertRule['condition'],
    threshold: row.threshold,
    windowMinutes: row.windowMinutes,
    scope: safeJsonParse(row.scope, {} as AlertRule['scope']),
    notifyChannels: safeJsonParse(row.notifyChannels, [] as string[]),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tenantId: row.tenantId,
  };
}

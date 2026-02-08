/**
 * SQLite schema for AgentLens — defined with Drizzle ORM.
 *
 * Tables: events, sessions, agents, alertRules, alertHistory, apiKeys
 * All indexes per Architecture §6.2.
 */

import { sqliteTable, text, integer, real, blob, index, primaryKey } from 'drizzle-orm/sqlite-core';

// ─── Events Table ──────────────────────────────────────────
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(), // ULID
    timestamp: text('timestamp').notNull(), // ISO 8601
    sessionId: text('session_id').notNull(),
    agentId: text('agent_id').notNull(),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull().default('info'),
    payload: text('payload').notNull(), // JSON
    metadata: text('metadata').notNull().default('{}'), // JSON
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    tenantId: text('tenant_id').notNull().default('default'),
  },
  (table) => [
    index('idx_events_timestamp').on(table.timestamp),
    index('idx_events_session_id').on(table.sessionId),
    index('idx_events_agent_id').on(table.agentId),
    index('idx_events_type').on(table.eventType),
    index('idx_events_session_ts').on(table.sessionId, table.timestamp),
    // Composite index for dashboard query: "recent events for agent X of type Y"
    index('idx_events_agent_type_ts').on(table.agentId, table.eventType, table.timestamp),
    // Tenant isolation indexes
    index('idx_events_tenant_id').on(table.tenantId),
    index('idx_events_tenant_session').on(table.tenantId, table.sessionId),
    index('idx_events_tenant_agent_ts').on(table.tenantId, table.agentId, table.timestamp),
  ],
);

// ─── Sessions Table (materialized) ────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').notNull(),
    agentId: text('agent_id').notNull(),
    agentName: text('agent_name'),
    startedAt: text('started_at').notNull(), // ISO 8601
    endedAt: text('ended_at'),
    status: text('status', {
      enum: ['active', 'completed', 'error'],
    })
      .notNull()
      .default('active'),
    eventCount: integer('event_count').notNull().default(0),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    llmCallCount: integer('llm_call_count').notNull().default(0),
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    tags: text('tags').notNull().default('[]'), // JSON array
    tenantId: text('tenant_id').notNull().default('default'),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.tenantId] }),
    index('idx_sessions_agent_id').on(table.agentId),
    index('idx_sessions_started_at').on(table.startedAt),
    index('idx_sessions_status').on(table.status),
    // Tenant isolation indexes
    index('idx_sessions_tenant_id').on(table.tenantId),
    index('idx_sessions_tenant_agent').on(table.tenantId, table.agentId),
    index('idx_sessions_tenant_started').on(table.tenantId, table.startedAt),
  ],
);

// ─── Agents Table (materialized) ──────────────────────────
export const agents = sqliteTable(
  'agents',
  {
    id: text('id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    sessionCount: integer('session_count').notNull().default(0),
    tenantId: text('tenant_id').notNull().default('default'),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.tenantId] }),
    index('idx_agents_tenant_id').on(table.tenantId),
  ],
);

// ─── Alert Rules Table ────────────────────────────────────
export const alertRules = sqliteTable('alert_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  condition: text('condition').notNull(),
  threshold: real('threshold').notNull(),
  windowMinutes: integer('window_minutes').notNull(),
  scope: text('scope').notNull().default('{}'), // JSON
  notifyChannels: text('notify_channels').notNull().default('[]'), // JSON
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
});

// ─── Alert History ────────────────────────────────────────
export const alertHistory = sqliteTable(
  'alert_history',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => alertRules.id),
    triggeredAt: text('triggered_at').notNull(),
    resolvedAt: text('resolved_at'),
    currentValue: real('current_value').notNull(),
    threshold: real('threshold').notNull(),
    message: text('message').notNull(),
    tenantId: text('tenant_id').notNull().default('default'),
  },
  (table) => [index('idx_alert_history_rule_id').on(table.ruleId)],
);

// ─── Lessons Table (Epic 3) ────────────────────────────────
export const lessons = sqliteTable(
  'lessons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id'),
    category: text('category').notNull().default('general'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    context: text('context').notNull().default('{}'), // JSON
    importance: text('importance').notNull().default('normal'),
    sourceSessionId: text('source_session_id'),
    sourceEventId: text('source_event_id'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: text('last_accessed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    index('idx_lessons_tenant').on(table.tenantId),
    index('idx_lessons_tenant_agent').on(table.tenantId, table.agentId),
    index('idx_lessons_tenant_category').on(table.tenantId, table.category),
    index('idx_lessons_tenant_importance').on(table.tenantId, table.importance),
  ],
);

// ─── API Keys ─────────────────────────────────────────────
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    keyHash: text('key_hash').notNull(),
    name: text('name').notNull(),
    scopes: text('scopes').notNull(), // JSON array
    createdAt: integer('created_at').notNull(), // unix timestamp
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    rateLimit: integer('rate_limit'),
    tenantId: text('tenant_id').notNull().default('default'),
  },
  (table) => [index('idx_api_keys_hash').on(table.keyHash)],
);

// ─── Embeddings Table (Epic 2) ────────────────────────────
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceType: text('source_type').notNull(), // 'event', 'session', 'lesson'
    sourceId: text('source_id').notNull(),
    contentHash: text('content_hash').notNull(), // SHA-256 of embedded text
    textContent: text('text_content').notNull(),
    embedding: blob('embedding', { mode: 'buffer' }).notNull(), // Float32Array as binary
    embeddingModel: text('embedding_model').notNull(),
    dimensions: integer('dimensions').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_embeddings_tenant').on(table.tenantId),
    index('idx_embeddings_source').on(table.sourceType, table.sourceId),
    index('idx_embeddings_content_hash').on(table.tenantId, table.contentHash),
  ],
);

// ─── Session Summaries Table (Epic 2) ─────────────────────
export const sessionSummaries = sqliteTable(
  'session_summaries',
  {
    sessionId: text('session_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    summary: text('summary').notNull(),
    topics: text('topics').notNull().default('[]'), // JSON array
    toolSequence: text('tool_sequence').notNull().default('[]'), // JSON array
    errorSummary: text('error_summary'),
    outcome: text('outcome'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.tenantId] }),
    index('idx_session_summaries_tenant').on(table.tenantId),
  ],
);

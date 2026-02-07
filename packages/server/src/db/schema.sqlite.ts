/**
 * SQLite schema for AgentLens — defined with Drizzle ORM.
 *
 * Tables: events, sessions, agents, alertRules, alertHistory, apiKeys
 * All indexes per Architecture §6.2.
 */

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

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
  },
  (table) => [
    index('idx_events_timestamp').on(table.timestamp),
    index('idx_events_session_id').on(table.sessionId),
    index('idx_events_agent_id').on(table.agentId),
    index('idx_events_type').on(table.eventType),
    index('idx_events_session_ts').on(table.sessionId, table.timestamp),
    // Composite index for dashboard query: "recent events for agent X of type Y"
    index('idx_events_agent_type_ts').on(table.agentId, table.eventType, table.timestamp),
  ],
);

// ─── Sessions Table (materialized) ────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
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
    tags: text('tags').notNull().default('[]'), // JSON array
  },
  (table) => [
    index('idx_sessions_agent_id').on(table.agentId),
    index('idx_sessions_started_at').on(table.startedAt),
    index('idx_sessions_status').on(table.status),
  ],
);

// ─── Agents Table (materialized) ──────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  sessionCount: integer('session_count').notNull().default(0),
});

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
  },
  (table) => [index('idx_alert_history_rule_id').on(table.ruleId)],
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
  },
  (table) => [index('idx_api_keys_hash').on(table.keyHash)],
);

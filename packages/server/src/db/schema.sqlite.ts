/**
 * SQLite schema for AgentLens — defined with Drizzle ORM.
 *
 * Tables: events, sessions, agents, alertRules, alertHistory, apiKeys,
 *         sharing_config, agent_sharing_config, deny_list_rules, sharing_audit_log,
 *         sharing_review_queue, anonymous_id_map, capability_registry, delegation_log
 * All indexes per Architecture §6.2.
 */

import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

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
      enum: ['active', 'completed', 'error', 'failed'],
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
    /** Model override set by guardrail downgrade_model action (B1) */
    modelOverride: text('model_override'),
    /** ISO timestamp when agent was paused by a guardrail (B1) */
    pausedAt: text('paused_at'),
    /** Human-readable reason for pausing (B1) */
    pauseReason: text('pause_reason'),
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
    id: text('id').notNull(),
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
    primaryKey({ columns: [table.id, table.tenantId] }),
    index('idx_lessons_tenant').on(table.tenantId),
    index('idx_lessons_tenant_agent').on(table.tenantId, table.agentId),
    index('idx_lessons_tenant_category').on(table.tenantId, table.category),
    index('idx_lessons_tenant_importance').on(table.tenantId, table.importance),
  ],
);

// ─── Users Table (Enterprise Auth) ────────────────────────
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(), // ULID
    tenantId: text('tenant_id').notNull().default('default'),
    email: text('email').notNull(),
    displayName: text('display_name'),
    oidcSubject: text('oidc_subject'),
    oidcIssuer: text('oidc_issuer'),
    role: text('role').notNull().default('viewer'), // admin | editor | viewer
    createdAt: integer('created_at').notNull(), // unix epoch
    updatedAt: integer('updated_at').notNull(), // unix epoch
    lastLoginAt: integer('last_login_at'),
    disabledAt: integer('disabled_at'),
  },
  (table) => [
    index('idx_users_tenant').on(table.tenantId),
    index('idx_users_email').on(table.email),
    uniqueIndex('idx_users_tenant_email').on(table.tenantId, table.email),
    uniqueIndex('idx_users_oidc').on(table.oidcIssuer, table.oidcSubject),
  ],
);

// ─── Refresh Tokens Table (Enterprise Auth) ───────────────
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(), // ULID
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: text('tenant_id').notNull().default('default'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(), // unix epoch
    createdAt: integer('created_at').notNull(), // unix epoch
    revokedAt: integer('revoked_at'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (table) => [
    index('idx_refresh_tokens_user').on(table.userId),
    index('idx_refresh_tokens_hash').on(table.tokenHash),
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
    createdBy: text('created_by').references(() => users.id), // nullable FK → users
    role: text('role').notNull().default('editor'), // admin | editor | viewer
    rotatedAt: integer('rotated_at'), // unix timestamp when key was rotated (replaced by new key)
    expiresAt: integer('expires_at'), // unix timestamp after which rotated key is rejected
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
    index('idx_embeddings_tenant_source_time').on(table.tenantId, table.sourceType, table.createdAt),
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

// ─── Phase 4: Sharing Configuration ──────────────────────
export const sharingConfig = sqliteTable('sharing_config', {
  tenantId: text('tenant_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  humanReviewEnabled: integer('human_review_enabled', { mode: 'boolean' }).notNull().default(false),
  poolEndpoint: text('pool_endpoint'),
  anonymousContributorId: text('anonymous_contributor_id'),
  purgeToken: text('purge_token'),
  rateLimitPerHour: integer('rate_limit_per_hour').notNull().default(50),
  volumeAlertThreshold: integer('volume_alert_threshold').notNull().default(100),
  updatedAt: text('updated_at').notNull(),
});

// ─── Phase 4: Per-Agent Sharing Toggle ───────────────────
export const agentSharingConfig = sqliteTable(
  'agent_sharing_config',
  {
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    categories: text('categories').notNull().default('[]'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.agentId] }),
  ],
);

// ─── Phase 4: Deny-List Rules ────────────────────────────
export const denyListRules = sqliteTable(
  'deny_list_rules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    pattern: text('pattern').notNull(),
    isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_deny_list_rules_tenant').on(table.tenantId),
  ],
);

// ─── Phase 4: Sharing Audit Log ──────────────────────────
export const sharingAuditLog = sqliteTable(
  'sharing_audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    eventType: text('event_type').notNull(),
    lessonId: text('lesson_id'),
    anonymousLessonId: text('anonymous_lesson_id'),
    lessonHash: text('lesson_hash'),
    redactionFindings: text('redaction_findings'),
    queryText: text('query_text'),
    resultIds: text('result_ids'),
    poolEndpoint: text('pool_endpoint'),
    initiatedBy: text('initiated_by'),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    index('idx_sharing_audit_tenant_ts').on(table.tenantId, table.timestamp),
    index('idx_sharing_audit_type').on(table.tenantId, table.eventType),
  ],
);

// ─── Phase 4: Human Review Queue ─────────────────────────
export const sharingReviewQueue = sqliteTable(
  'sharing_review_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    originalTitle: text('original_title').notNull(),
    originalContent: text('original_content').notNull(),
    redactedTitle: text('redacted_title').notNull(),
    redactedContent: text('redacted_content').notNull(),
    redactionFindings: text('redaction_findings').notNull(),
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_review_queue_tenant_status').on(table.tenantId, table.status),
  ],
);

// ─── Phase 4: Anonymous ID Mapping ───────────────────────
export const anonymousIdMap = sqliteTable(
  'anonymous_id_map',
  {
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    anonymousAgentId: text('anonymous_agent_id').notNull(),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.agentId, table.validFrom] }),
    index('idx_anon_map_anon_id').on(table.anonymousAgentId),
  ],
);

// ─── Phase 4: Capability Registry (local) ────────────────
export const capabilityRegistry = sqliteTable(
  'capability_registry',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    taskType: text('task_type').notNull(),
    customType: text('custom_type'),
    inputSchema: text('input_schema').notNull(),
    outputSchema: text('output_schema').notNull(),
    qualityMetrics: text('quality_metrics').notNull().default('{}'),
    estimatedLatencyMs: integer('estimated_latency_ms'),
    estimatedCostUsd: real('estimated_cost_usd'),
    maxInputBytes: integer('max_input_bytes'),
    scope: text('scope').notNull().default('internal'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    acceptDelegations: integer('accept_delegations', { mode: 'boolean' }).notNull().default(false),
    inboundRateLimit: integer('inbound_rate_limit').notNull().default(10),
    outboundRateLimit: integer('outbound_rate_limit').notNull().default(20),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_capability_tenant_agent').on(table.tenantId, table.agentId),
    index('idx_capability_task_type').on(table.tenantId, table.taskType),
  ],
);

// ─── Phase 4: Discovery Permission Config ────────────────
export const discoveryConfig = sqliteTable('discovery_config', {
  tenantId: text('tenant_id').primaryKey(),
  minTrustThreshold: integer('min_trust_threshold').notNull().default(60),
  delegationEnabled: integer('delegation_enabled', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});

// ─── Phase 4: Delegation Log ─────────────────────────────
export const delegationLog = sqliteTable(
  'delegation_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    direction: text('direction').notNull(),
    agentId: text('agent_id').notNull(),
    anonymousTargetId: text('anonymous_target_id'),
    anonymousSourceId: text('anonymous_source_id'),
    taskType: text('task_type').notNull(),
    status: text('status').notNull(),
    requestSizeBytes: integer('request_size_bytes'),
    responseSizeBytes: integer('response_size_bytes'),
    executionTimeMs: integer('execution_time_ms'),
    costUsd: real('cost_usd'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_delegation_tenant_ts').on(table.tenantId, table.createdAt),
    index('idx_delegation_agent').on(table.tenantId, table.agentId),
    index('idx_delegation_status').on(table.tenantId, table.status),
  ],
);

// ─── Notification Channels (Feature 12) ──────────────────
export const notificationChannels = sqliteTable(
  'notification_channels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    type: text('type').notNull(), // 'webhook' | 'slack' | 'pagerduty' | 'email'
    name: text('name').notNull(),
    config: text('config').notNull(), // encrypted JSON
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_notification_channels_tenant').on(table.tenantId),
    index('idx_notification_channels_type').on(table.tenantId, table.type),
  ],
);

// ─── Notification Log (Feature 12) ──────────────────────
export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    channelId: text('channel_id').notNull(),
    ruleId: text('rule_id'),
    ruleType: text('rule_type'), // 'alert_rule' | 'guardrail'
    status: text('status').notNull(), // 'success' | 'failed' | 'retrying'
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    payloadSummary: text('payload_summary'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_notification_log_tenant').on(table.tenantId),
    index('idx_notification_log_channel').on(table.channelId),
    index('idx_notification_log_created').on(table.tenantId, table.createdAt),
  ],
);

// ─── Prompt Management Tables (Feature 19) ──────────────────

export const promptTemplates = sqliteTable(
  'prompt_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('general'),
    currentVersionId: text('current_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('idx_prompt_templates_tenant').on(table.tenantId),
    index('idx_prompt_templates_tenant_cat').on(table.tenantId, table.category),
    index('idx_prompt_templates_tenant_name').on(table.tenantId, table.name),
  ],
);

export const promptVersions = sqliteTable(
  'prompt_versions',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    content: text('content').notNull(),
    variables: text('variables'),
    contentHash: text('content_hash').notNull(),
    changelog: text('changelog'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_prompt_versions_tpl_ver').on(table.templateId, table.versionNumber),
    index('idx_prompt_versions_tenant').on(table.tenantId),
    index('idx_prompt_versions_hash').on(table.contentHash),
  ],
);

export const promptFingerprints = sqliteTable(
  'prompt_fingerprints',
  {
    contentHash: text('content_hash').notNull(),
    tenantId: text('tenant_id').notNull(),
    agentId: text('agent_id').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    callCount: integer('call_count').notNull().default(0),
    templateId: text('template_id'),
    sampleContent: text('sample_content'),
  },
  (table) => [
    primaryKey({ columns: [table.contentHash, table.tenantId, table.agentId] }),
    index('idx_prompt_fp_tenant').on(table.tenantId),
    index('idx_prompt_fp_agent').on(table.tenantId, table.agentId),
    index('idx_prompt_fp_template').on(table.templateId),
  ],
);

// ─── Audit Log Table (SH-2) ──────────────────────────────
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(), // ULID
    timestamp: text('timestamp').notNull(), // ISO 8601
    tenantId: text('tenant_id').notNull(),
    actorType: text('actor_type').notNull(), // 'user' | 'api_key' | 'system'
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: text('details').notNull().default('{}'), // JSON
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_audit_log_tenant_ts').on(table.tenantId, table.timestamp),
    index('idx_audit_log_action').on(table.action),
  ],
);

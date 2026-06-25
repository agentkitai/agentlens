/**
 * Server configuration — reads from environment variables with sensible defaults.
 */

import { createLogger } from './lib/logger.js';

const log = createLogger('Config');

export interface ServerConfig {
  /** Port to listen on (default: 3400) */
  port: number;
  /** CORS allowed origin (default: '*') — legacy single origin */
  corsOrigin: string;
  /** Comma-separated CORS allowed origins (takes precedence over corsOrigin) */
  corsOrigins?: string;
  /** Whether auth is disabled — dev mode (default: false) */
  authDisabled: boolean;
  /** SQLite database path (default: './agentlens.db') */
  dbPath: string;
  /** Storage backend: 'sqlite' (default) or 'postgres' */
  storageBackend: 'sqlite' | 'postgres';
  /** Retention days (0 = keep forever, default: 90) */
  retentionDays: number;
  /** Optional bearer token for OTLP ingestion auth */
  otlpAuthToken?: string;
  /** Service token authenticating AgentGate's internal spend-read calls (#13).
   *  Also used to authenticate AgentLens's OUTBOUND ingest-key verify call to
   *  AgentGate (#24) — a bidirectional shared service secret. When unset, POST
   *  /api/internal/spend is disabled and OTLP ingest-key verification is off. */
  agentgateServiceToken?: string;
  /** AgentGate base URL (#24). When set (with agentgateServiceToken), an OTLP
   *  exporter may present a longer-lived X-Agent-Ingest-Key, which AgentLens
   *  verifies against AgentGate's POST /api/internal/verify-ingest-key with a
   *  short cache. Unset → ingest-key verification is off (token path unchanged). */
  agentgateUrl?: string;
  /** OTLP rate limit per IP per minute (default: 1000) */
  otlpRateLimit: number;
  /** Whether OTLP endpoints require full unified auth (default: false) */
  otlpAuthRequired: boolean;

  // ─── Mesh Integration ───────────────────────────────────
  /** Enable mesh proxy (default: false) */
  meshEnabled: boolean;
  /** Mesh HTTP server URL (required when meshEnabled) */
  meshUrl: string;

  // ─── Lore Integration ──────────────────────────────────
  /** Enable Lore memory integration (default: false) */
  loreEnabled: boolean;
  /** Lore API URL (required when loreEnabled) */
  loreApiUrl?: string;
  /** Lore API key (required when loreEnabled) */
  loreApiKey?: string;

  /** HMAC-SHA256 key for signing audit verification reports (optional) */
  auditSigningKey?: string;

  /** Enable strict multi-tenant mode — rejects unscoped ingestion (default: false) [F6-S13] */
  multiTenantMode: boolean;

  /** Billing-grade spend attribution (#87, DEFAULT OFF). When on, /api/internal/spend
   *  and /api/analytics/costs attribute cost by the server-verified agent id
   *  (events table `verified_agent_id`); unverified spend falls into an
   *  "unattributed" bucket. When off, spend groups by the self-reported
   *  agent_id (guardrail mode — today's behavior, unchanged). */
  billingGradeSpend: boolean;

  /** Default |drift| fraction at which POST /api/internal/reconcile flags an agent
   *  (#89). 0.01 = 1%. Overridable per-request via the `threshold` body field. */
  reconcileDriftThreshold: number;
}

/**
 * Read configuration from environment variables.
 */
export function getConfig(): ServerConfig {
  const port = parseInt(process.env['PORT'] ?? '3400', 10);
  return {
    port: isNaN(port) ? 3400 : port,
    corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3400',
    corsOrigins: process.env['CORS_ORIGINS'] || undefined,
    authDisabled: process.env['AUTH_DISABLED'] === 'true',
    dbPath: process.env['DB_PATH'] ?? process.env['DATABASE_PATH'] ?? './agentlens.db',
    storageBackend: (() => {
      const raw = process.env['STORAGE_BACKEND'] ?? process.env['DB_DIALECT'];
      if (!raw) return 'sqlite' as const;
      // Log deprecation if DB_DIALECT used without STORAGE_BACKEND
      if (!process.env['STORAGE_BACKEND'] && process.env['DB_DIALECT']) {
        log.warn('⚠️  DB_DIALECT is deprecated. Use STORAGE_BACKEND instead.');
      }
      const normalized = raw === 'postgresql' ? 'postgres' : raw;
      if (normalized !== 'postgres' && normalized !== 'sqlite') {
        throw new Error(`Invalid STORAGE_BACKEND: '${raw}'. Expected 'postgres', 'postgresql', or 'sqlite'.`);
      }
      return normalized;
    })(),
    retentionDays: (() => {
      const parsed = parseInt(process.env['RETENTION_DAYS'] ?? '90', 10);
      return isNaN(parsed) ? 90 : parsed;
    })(),
    otlpAuthToken: process.env['OTLP_AUTH_TOKEN'] || undefined,
    agentgateServiceToken: process.env['AGENTGATE_SERVICE_TOKEN'] || undefined,
    agentgateUrl: process.env['AGENTGATE_URL'] || undefined,
    otlpAuthRequired: process.env['OTLP_AUTH_REQUIRED'] === 'true',
    otlpRateLimit: (() => {
      const parsed = parseInt(process.env['OTLP_RATE_LIMIT'] ?? '1000', 10);
      return isNaN(parsed) ? 1000 : parsed;
    })(),

    // Mesh integration
    meshEnabled: process.env['MESH_ENABLED'] === 'true',
    meshUrl: process.env['MESH_URL'] ?? '',

    // Lore integration (v0.5.0+ — always remote, no local mode)
    loreEnabled: process.env['LORE_ENABLED'] === 'true',
    loreApiUrl: process.env['LORE_API_URL'] || undefined,
    loreApiKey: process.env['LORE_API_KEY'] || undefined,

    // Audit verification signing
    auditSigningKey: process.env['AGENTLENS_AUDIT_SIGNING_KEY'] || undefined,

    // Multi-tenant mode [F6-S13]
    multiTenantMode: process.env['MULTI_TENANT_MODE'] === 'true',

    // Billing-grade spend attribution (#87) — default OFF (guardrail mode)
    billingGradeSpend: process.env['BILLING_GRADE_SPEND'] === 'true',

    // Reconciliation drift alert threshold (#89) — default 1%
    reconcileDriftThreshold: (() => {
      const parsed = parseFloat(process.env['RECONCILE_DRIFT_THRESHOLD'] ?? '0.01');
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.01;
    })(),
  };
}

/**
 * Validate config at startup. Logs warnings and throws on fatal misconfigurations.
 */
export function validateConfig(config: ServerConfig): void {
  if (config.authDisabled) {
    const nodeEnv = process.env['NODE_ENV'] ?? 'development';
    if (nodeEnv === 'production') {
      log.error('CRITICAL: AUTH_DISABLED=true in production environment! This is a severe security risk. Set AUTH_DISABLED=false or remove it.');
    } else if (nodeEnv !== 'development') {
      log.warn('WARNING: AUTH_DISABLED=true in non-development environment (NODE_ENV=' + nodeEnv + '). This is not recommended.');
    }
    log.warn('⚠️  Authentication is DISABLED. Do not use in production!');
  }

  if (config.corsOrigin === '*' && !config.authDisabled) {
    throw new Error(
      'FATAL: CORS_ORIGIN=* with authentication enabled is insecure. ' +
      'Set a specific origin (e.g. http://localhost:3400) or set AUTH_DISABLED=true for development.',
    );
  }

  // C-2 FIX: Warn when OTLP endpoints are exposed without auth in production mode
  if (!config.authDisabled && !config.otlpAuthToken) {
    log.warn('⚠️  OTLP endpoints (/v1/traces, /v1/metrics, /v1/logs) have NO authentication. Set OTLP_AUTH_TOKEN for production.');
  }

  // ─── Mesh config validation ─────────────────────────────
  if (config.meshEnabled && !config.meshUrl) {
    log.warn('⚠️  MESH_ENABLED=true but MESH_URL is not set — mesh proxy will not be registered.');
  }

  // ─── Lore config validation ────────────────────────────
  validateLoreConfig(config);
}

function validateLoreConfig(config: ServerConfig): void {
  if (!config.loreEnabled) return;

  if (!config.loreApiUrl) {
    throw new Error(
      'FATAL: LORE_ENABLED=true requires LORE_API_URL to be set.',
    );
  }
  if (!config.loreApiKey) {
    throw new Error(
      'FATAL: LORE_ENABLED=true requires LORE_API_KEY to be set.',
    );
  }
}

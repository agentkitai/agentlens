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
  /** Lore mode: 'local' uses lore-sdk directly, 'remote' proxies to Lore server (default: 'remote') */
  loreMode: 'local' | 'remote';
  /** Lore API URL (required when loreMode === 'remote' && loreEnabled) */
  loreApiUrl?: string;
  /** Lore API key (required when loreMode === 'remote' && loreEnabled) */
  loreApiKey?: string;
  /** Lore SQLite database path (optional, lore-sdk has defaults) */
  loreDbPath?: string;

  /** HMAC-SHA256 key for signing audit verification reports (optional) */
  auditSigningKey?: string;
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
    otlpAuthRequired: process.env['OTLP_AUTH_REQUIRED'] === 'true',
    otlpRateLimit: (() => {
      const parsed = parseInt(process.env['OTLP_RATE_LIMIT'] ?? '1000', 10);
      return isNaN(parsed) ? 1000 : parsed;
    })(),

    // Mesh integration
    meshEnabled: process.env['MESH_ENABLED'] === 'true',
    meshUrl: process.env['MESH_URL'] ?? '',

    // Lore integration
    loreEnabled: process.env['LORE_ENABLED'] === 'true',
    loreMode: (process.env['LORE_MODE'] === 'local' ? 'local' : 'remote') as 'local' | 'remote',
    loreApiUrl: process.env['LORE_API_URL'] || undefined,
    loreApiKey: process.env['LORE_API_KEY'] || undefined,
    loreDbPath: process.env['LORE_DB_PATH'] || undefined,

    // Audit verification signing
    auditSigningKey: process.env['AGENTLENS_AUDIT_SIGNING_KEY'] || undefined,
  };
}

/**
 * Validate config at startup. Logs warnings and throws on fatal misconfigurations.
 */
export function validateConfig(config: ServerConfig): void {
  if (config.authDisabled) {
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

  if (config.loreMode === 'remote') {
    if (!config.loreApiUrl) {
      throw new Error(
        'FATAL: LORE_ENABLED=true with LORE_MODE=remote requires LORE_API_URL to be set.',
      );
    }
    if (!config.loreApiKey) {
      throw new Error(
        'FATAL: LORE_ENABLED=true with LORE_MODE=remote requires LORE_API_KEY to be set.',
      );
    }
  }
}

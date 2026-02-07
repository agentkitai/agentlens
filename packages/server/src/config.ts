/**
 * Server configuration — reads from environment variables with sensible defaults.
 */

export interface ServerConfig {
  /** Port to listen on (default: 3400) */
  port: number;
  /** CORS allowed origin (default: '*') */
  corsOrigin: string;
  /** Whether auth is disabled — dev mode (default: false) */
  authDisabled: boolean;
  /** SQLite database path (default: './agentlens.db') */
  dbPath: string;
  /** Retention days (0 = keep forever, default: 90) */
  retentionDays: number;
}

/**
 * Read configuration from environment variables.
 */
export function getConfig(): ServerConfig {
  const port = parseInt(process.env['PORT'] ?? '3400', 10);
  return {
    port: isNaN(port) ? 3400 : port,
    corsOrigin: process.env['CORS_ORIGIN'] ?? '*',
    authDisabled: process.env['AUTH_DISABLED'] === 'true',
    dbPath: process.env['DB_PATH'] ?? process.env['DATABASE_PATH'] ?? './agentlens.db',
    retentionDays: (() => {
      const parsed = parseInt(process.env['RETENTION_DAYS'] ?? '90', 10);
      return isNaN(parsed) ? 90 : parsed;
    })(),
  };
}

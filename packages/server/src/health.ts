/**
 * Health check endpoint — extracted from index.ts (cq-001)
 *
 * Inline health check registered directly on the app (no auth required).
 */

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthVariables } from './middleware/auth.js';
import type { SqliteDb } from './db/index.js';
import type { ServerConfig } from './config.js';

/**
 * Register the inline /api/health endpoint on the given app.
 *
 * This is the lightweight "is the server alive?" check that runs before
 * auth middleware.  The richer per-agent health routes live in routes/health.ts.
 */
export function registerInlineHealthCheck(
  app: OpenAPIHono<{ Variables: AuthVariables }>,
  resolvedConfig: ServerConfig,
  config?: {
    db?: SqliteDb;
    pgSql?: import('postgres').Sql;
  },
) {
  app.get('/api/health', async (c) => {
    const result: Record<string, unknown> = { status: 'ok', version: '0.1.0' };

    // DB health check — works for both SQLite and Postgres
    if (config?.pgSql) {
      const { postgresHealthCheck } = await import('./db/index.js');
      result.db = await postgresHealthCheck(config.pgSql);
    } else if (config?.db) {
      // SQLite health check
      const start = performance.now();
      try {
        (config.db as any).run(
          (await import('drizzle-orm')).sql`SELECT 1`,
        );
        result.db = { ok: true, latencyMs: Math.round(performance.now() - start) };
      } catch {
        result.db = { ok: false, latencyMs: Math.round(performance.now() - start) };
      }
    }

    return c.json(result);
  });
}

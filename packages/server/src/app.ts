/**
 * Hono app creation and middleware setup — extracted from index.ts (cq-001)
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IEventStore } from '@agentlensai/core';
import { BearerAuthScheme } from './schemas/common.js';
import { getConfig, type ServerConfig } from './config.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { unifiedAuthMiddleware } from './middleware/unified-auth.js';
import { requireCategory, requireMethodCategory, requireCategoryByMethod } from './middleware/rbac.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { sanitizeErrorMessage, getErrorStatus } from './lib/error-sanitizer.js';
import { buildCorsOptions } from './middleware/cors-config.js';
import { authRateLimit, apiRateLimit } from './middleware/rate-limit.js';
import { apiBodyLimit } from './middleware/body-limit.js';
import { createAuditLogger } from './lib/audit.js';
import { auditMiddleware } from './middleware/audit.js';
import { registerInlineHealthCheck } from './health.js';
import { registerRoutes, type RouteRegistrationConfig } from './routes/registration.js';
import type { SqliteDb } from './db/index.js';
import type { EmbeddingService } from './lib/embeddings/index.js';
import type { EmbeddingWorker } from './lib/embeddings/worker.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('Server');

// ─── Dashboard SPA helpers ───────────────────────────────────

/**
 * Resolve the dashboard dist/ directory path.
 */
function getDashboardRoot(): string | null {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist'),
    process.env['DASHBOARD_PATH'] ?? '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Read the dashboard index.html for SPA fallback (non-API routes).
 */
let cachedIndexHtml: string | null | undefined;

function getDashboardIndexHtml(): string | null {
  if (cachedIndexHtml !== undefined) return cachedIndexHtml;

  const root = getDashboardRoot();
  if (!root) {
    cachedIndexHtml = null;
    return null;
  }

  const indexPath = resolve(root, 'index.html');
  try {
    cachedIndexHtml = readFileSync(indexPath, 'utf-8');
    return cachedIndexHtml;
  } catch {
    cachedIndexHtml = null;
    return null;
  }
}

/**
 * Create a configured Hono app with all routes and middleware.
 *
 * @param store - IEventStore implementation for data access
 * @param config - Optional partial config override (defaults from env)
 */
export async function createApp(
  store: IEventStore,
  config?: Partial<ServerConfig> & {
    db?: SqliteDb;
    apiKeyLookup?: import('./db/api-key-lookup.js').IApiKeyLookup;
    embeddingService?: EmbeddingService | null;
    embeddingWorker?: EmbeddingWorker | null;
    pgSql?: import('postgres').Sql;
    pgDb?: import('./db/connection.postgres.js').PostgresDb;
  },
) {
  const resolvedConfig = { ...getConfig(), ...config };

  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({
          error: 'Validation failed',
          status: 400,
          details: result.error.issues.map((i: any) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        }, 400);
      }
    },
  });

  // Register Bearer auth security scheme for OpenAPI [F13-S1]
  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', BearerAuthScheme);

  // ─── Security headers (position 1 — must be first) ────
  app.use('*', securityHeadersMiddleware());

  // ─── Global error handler ──────────────────────────────
  app.onError((err, c) => {
    const status = getErrorStatus(err);
    if (status >= 500) {
      log.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
    }
    const message = sanitizeErrorMessage(err);
    return c.json(
      { error: message, status },
      status as 500,
    );
  });

  // ─── 404 handler — API routes return JSON, others get SPA fallback ──
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) {
      return c.json({ error: 'Not found', status: 404 }, 404);
    }
    if (/\.\w{1,10}$/.test(path)) {
      return c.json({ error: 'Not found', status: 404 }, 404);
    }
    const indexHtml = getDashboardIndexHtml();
    if (indexHtml) {
      return c.html(indexHtml);
    }
    return c.json({ error: 'Not found', status: 404 }, 404);
  });

  // ─── Middleware on /api/* ──────────────────────────────
  app.use('/api/*', cors(buildCorsOptions({
    corsOrigins: resolvedConfig.corsOrigins ?? resolvedConfig.corsOrigin,
    nodeEnv: process.env['NODE_ENV'],
  })));
  app.use('/api/*', logger());

  // ─── SH-3: Body size limit (1MB default) ────────────────
  app.use('/api/*', apiBodyLimit);

  // ─── Rate limiting: API endpoints ──────────────────────
  app.use('/api/*', apiRateLimit);

  // ─── Health check (no auth) ────────────────────────────
  registerInlineHealthCheck(app, resolvedConfig, config);

  // ─── Rate limiting: auth endpoints ─────────────────────
  app.use('/auth/*', authRateLimit);

  // ─── Auth posture check (Feature-1: secure-by-default) ──
  if (resolvedConfig.authDisabled && process.env['NODE_ENV'] === 'production') {
    log.error('CRITICAL: Running with AUTH_DISABLED=true in production. All API endpoints are unprotected!');
  }

  // ─── Auth middleware on protected routes [F2-S3] ───────
  const db = config?.db;
  if (!db && !resolvedConfig.authDisabled) {
    throw new Error(
      'createApp() requires a `db` option when auth is enabled. ' +
      'Either provide a database or set authDisabled: true.',
    );
  }

  {
    const authLookup = config?.apiKeyLookup ?? db ?? null;
    const authConfig = {
      authDisabled: resolvedConfig.authDisabled,
      jwtSecret: process.env['JWT_SECRET'],
    };

    // ── Unified auth catch-all ──
    app.use('/api/*', unifiedAuthMiddleware(authLookup, authConfig));

    // ── RBAC enforcement per architecture §3.3 ──────────
    const manageGuard = requireCategory('manage');
    app.use('/api/keys/*', manageGuard);
    app.use('/api/keys', manageGuard);
    app.use('/api/audit/*', manageGuard);
    app.use('/api/audit', manageGuard);
    app.use('/api/compliance/*', manageGuard);
    app.use('/api/compliance', manageGuard);
    const configGuard = requireCategoryByMethod({ GET: 'read', PUT: 'manage', PATCH: 'manage' });
    app.use('/api/config/*', configGuard);
    app.use('/api/config', configGuard);
    const guardrailGuard = requireCategoryByMethod({ GET: 'read', POST: 'manage', PUT: 'manage', DELETE: 'manage' });
    app.use('/api/guardrails/*', guardrailGuard);
    app.use('/api/guardrails', guardrailGuard);

    // Default safety net: GET = read, mutations = write
    app.use('/api/*', requireMethodCategory());

    // ── Audit middleware (after auth — has access to auth context) ──
    if (db) {
      const auditLogger = createAuditLogger(db);
      app.use('/api/*', auditMiddleware(auditLogger));
    }
  }

  // ─── Register all routes ──────────────────────────────
  await registerRoutes(app, store, resolvedConfig, config);

  // ─── Dashboard SPA static assets ──────────────────────
  const dashboardRoot = getDashboardRoot();
  if (dashboardRoot) {
    app.use(
      '/*',
      serveStatic({ root: dashboardRoot }),
    );
  }

  return app;
}

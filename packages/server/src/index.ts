/**
 * @agentlensai/server — Hono HTTP API server and event storage
 *
 * Exports:
 * - createApp(store, config?) — factory that returns a configured Hono app
 * - startServer() — standalone entry point that creates DB + starts listening
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IEventStore } from '@agentlensai/core';
import { getConfig, validateConfig, type ServerConfig } from './config.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { unifiedAuthMiddleware, type UnifiedAuthVariables } from './middleware/unified-auth.js';
import { requireCategory, requireMethodCategory, requireCategoryByMethod } from './middleware/rbac.js';
import { otlpAuthRequired as otlpAuthRequiredError, otlpInvalidToken } from './middleware/auth-errors.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { sanitizeErrorMessage, getErrorStatus } from './lib/error-sanitizer.js';
import { buildCorsOptions } from './middleware/cors-config.js';
import { apiKeysRoutes } from './routes/api-keys.js';
import { eventsRoutes } from './routes/events.js';
import { sessionsRoutes } from './routes/sessions.js';
import { agentsRoutes } from './routes/agents.js';
import { statsRoutes } from './routes/stats.js';
import { configRoutes } from './routes/config.js';
import { alertsRoutes } from './routes/alerts.js';
import { ingestRoutes } from './routes/ingest.js';
import { analyticsRoutes } from './routes/analytics.js';
import { streamRoutes } from './routes/stream.js';
import { reflectRoutes } from './routes/reflect.js';
import { recallRoutes } from './routes/recall.js';
import { contextRoutes } from './routes/context.js';
import { optimizeRoutes } from './routes/optimize.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerReplayRoutes } from './routes/replay.js';
import { benchmarkRoutes } from './routes/benchmarks.js';
import { guardrailRoutes } from './routes/guardrails.js';
import { capabilityRoutes } from './routes/capabilities.js';
import { capabilityTopRoutes } from './routes/capabilities-top.js';
import { discoveryRoutes } from './routes/discovery.js';
import { delegationRoutes } from './routes/delegation.js';
import { delegationTopRoutes } from './routes/delegations-top.js';
import { trustRoutes } from './routes/trust.js';
import { LocalPoolTransport } from './services/delegation-service.js';
import { loreProxyRoutes, loreCommunityProxyRoutes } from './routes/lore-proxy.js';
import { createLoreAdapter } from './lib/lore-client.js';
import { meshProxyRoutes } from './routes/mesh-proxy.js';
import { RemoteMeshAdapter } from './lib/mesh-client.js';
import { otlpRoutes } from './routes/otlp.js';
import { authRoutes } from './routes/auth.js';
import { authRateLimit, apiRateLimit } from './middleware/rate-limit.js';
import { apiBodyLimit } from './middleware/body-limit.js';
import { auditRoutes } from './routes/audit.js';
import { auditVerifyRoutes } from './routes/audit-verify.js';
import { complianceRoutes } from './routes/compliance.js';
import { createAuditLogger, cleanupAuditLogs } from './lib/audit.js';
import { auditMiddleware } from './middleware/audit.js';
import { GuardrailEngine } from './lib/guardrails/engine.js';
import { GuardrailStore } from './db/guardrail-store.js';
import { ContentGuardrailEngine } from './lib/guardrails/content-engine.js';
import { setAgentStore } from './lib/guardrails/actions.js';
import { BudgetEngine } from './lib/budget-engine.js';
import { CostAnomalyDetector } from './lib/cost-anomaly-detector.js';
import { costBudgetRoutes } from './routes/cost-budgets.js';
import { createDb, type SqliteDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { SqliteEventStore } from './db/sqlite-store.js';
import { AlertEngine } from './lib/alert-engine.js';
import { eventBus } from './lib/event-bus.js';
import { EmbeddingWorker } from './lib/embeddings/worker.js';
import type { EmbeddingService } from './lib/embeddings/index.js';
import { EmbeddingStore } from './db/embedding-store.js';
import type { IEmbeddingStore } from './db/embedding-store.interface.js';
import { SessionSummaryStore } from './db/session-summary-store.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('Server');

// Re-export everything consumers may need
export { getConfig, validateConfig } from './config.js';
export type { ServerConfig } from './config.js';
export { authMiddleware, hashApiKey } from './middleware/auth.js';
export { buildCorsOptions } from './middleware/cors-config.js';
export type { ApiKeyInfo, AuthVariables } from './middleware/auth.js';
export { apiKeysRoutes } from './routes/api-keys.js';
export { eventsRoutes } from './routes/events.js';
export { sessionsRoutes } from './routes/sessions.js';
export { agentsRoutes } from './routes/agents.js';
export { statsRoutes } from './routes/stats.js';
export { configRoutes } from './routes/config.js';
export { alertsRoutes } from './routes/alerts.js';
export { ingestRoutes, verifyWebhookSignature } from './routes/ingest.js';
export { analyticsRoutes } from './routes/analytics.js';
export { streamRoutes } from './routes/stream.js';
export { reflectRoutes } from './routes/reflect.js';
export { recallRoutes } from './routes/recall.js';
export { optimizeRoutes } from './routes/optimize.js';
export { registerReplayRoutes } from './routes/replay.js';
export { EmbeddingWorker } from './lib/embeddings/worker.js';
export { EmbeddingStore } from './db/embedding-store.js';
export { createSSEStream } from './lib/sse.js';
export { SqliteEventStore } from './db/sqlite-store.js';
export { TenantScopedStore } from './db/tenant-scoped-store.js';
export { AlertEngine } from './lib/alert-engine.js';
export { eventBus } from './lib/event-bus.js';
export { createDb, createTestDb } from './db/index.js';
export type { SqliteDb } from './db/index.js';
export { runMigrations } from './db/migrate.js';
export { SessionSummaryStore } from './db/session-summary-store.js';
export { contextRoutes } from './routes/context.js';
export { auditRoutes } from './routes/audit.js';
export { createAuditLogger, cleanupAuditLogs, maskSensitive } from './lib/audit.js';
export { validateBody, formatZodErrors } from './middleware/validation.js';
export { apiBodyLimit } from './middleware/body-limit.js';
export type { AuditLogger, AuditEntry, ActorType } from './lib/audit.js';
export { auditMiddleware } from './middleware/audit.js';
export { registerHealthRoutes } from './routes/health.js';
export { ContextRetriever } from './lib/context/retrieval.js';
export { loreProxyRoutes, loreCommunityProxyRoutes } from './routes/lore-proxy.js';
export { createLoreAdapter, RemoteLoreAdapter, LocalLoreAdapter, LoreError } from './lib/lore-client.js';
export type { LoreAdapter } from './lib/lore-client.js';
export { meshProxyRoutes } from './routes/mesh-proxy.js';
export { RemoteMeshAdapter, MeshError } from './lib/mesh-client.js';
export type { MeshAdapter } from './lib/mesh-client.js';
export { otlpRoutes } from './routes/otlp.js';
export { guardrailRoutes } from './routes/guardrails.js';
export { GuardrailEngine } from './lib/guardrails/engine.js';
export { GuardrailStore } from './db/guardrail-store.js';
export { BudgetEngine } from './lib/budget-engine.js';
export { CostAnomalyDetector } from './lib/cost-anomaly-detector.js';
export { CostBudgetStore } from './db/cost-budget-store.js';
export { costBudgetRoutes } from './routes/cost-budgets.js';
// ─── Dashboard SPA helpers ───────────────────────────────────

/**
 * Resolve the dashboard dist/ directory path.
 * Looks for the built dashboard relative to this file's package:
 *   ../dashboard/dist/   (monorepo sibling)
 *
 * Returns relative path suitable for serveStatic root, or null if not found.
 */
function getDashboardRoot(): string | null {
  const candidates = [
    // When running from packages/server/dist/ or packages/server/src/
    resolve(dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist'),
    // Fallback: env var override
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
 * Cached after first read.
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
  },
) {
  const resolvedConfig = { ...getConfig(), ...config };

  const app = new Hono<{ Variables: AuthVariables }>();

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
    // Static asset requests (paths with file extensions) should 404,
    // not fall through to SPA index.html
    if (/\.\w{1,10}$/.test(path)) {
      return c.json({ error: 'Not found', status: 404 }, 404);
    }
    // SPA fallback: serve index.html for client-side routing
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

  // ─── Feature flags (no auth — dashboard needs before login) ──
  app.get('/api/config/features', (c) => {
    return c.json({ lore: resolvedConfig.loreEnabled, mesh: resolvedConfig.meshEnabled });
  });

  // ─── SSE stream (authenticates via Bearer header or ?token= query param) ──
  // Mounted before auth middleware — handles its own auth internally for EventSource compat.
  app.route('/api/stream', streamRoutes(config?.apiKeyLookup, resolvedConfig.authDisabled));

  // ─── Webhook ingest (no API key auth — uses HMAC signature verification) ──
  app.route('/api/events/ingest', ingestRoutes(store, {
    agentgateWebhookSecret: process.env['AGENTGATE_WEBHOOK_SECRET'],
    formbridgeWebhookSecret: process.env['FORMBRIDGE_WEBHOOK_SECRET'],
  }));

  // ─── Rate limiting: auth endpoints ─────────────────────
  app.use('/auth/*', authRateLimit);

  // ─── OIDC Auth routes (no API key auth — handles own auth) ──
  {
    const authDb = config?.db;
    if (authDb) {
      const { loadOidcConfig } = await import('agentkit-auth');
      const oidcConfig = loadOidcConfig();
      if (oidcConfig) {
        const jwtSecret = process.env['JWT_SECRET'];
        if (!jwtSecret && process.env['NODE_ENV'] === 'production') {
          throw new Error('JWT_SECRET must be set in production. Refusing to start with default secret.');
        }
        if (!jwtSecret) {
          log.warn('JWT_SECRET not set — using insecure default. Do NOT use in production.');
        }
        app.route('/auth', authRoutes(authDb, {
          oidcConfig,
          authConfig: {
            oidc: null,
            jwt: {
              secret: jwtSecret ?? 'dev-secret-change-me',
              accessTokenTtlSeconds: Number(process.env['JWT_ACCESS_TTL'] ?? 900),
              refreshTokenTtlSeconds: Number(process.env['JWT_REFRESH_TTL'] ?? 604800),
            },
            authDisabled: resolvedConfig.authDisabled,
          },
        }));
      }
    }
  }

  // ─── Fallback auth endpoints when auth is disabled ─────
  if (resolvedConfig.authDisabled) {
    app.get('/auth/me', (c) => c.json({ authMode: 'api-key-only' }, 200));
  }

  // ─── Auth middleware on protected routes [F2-S3] ───────
  // Fail-closed: single catch-all for /api/* with public routes registered above.
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

    // ── Unified auth catch-all (replaces 40+ individual app.use calls) ──
    app.use('/api/*', unifiedAuthMiddleware(authLookup, authConfig));

    // ── RBAC enforcement per architecture §3.3 ──────────
    // Manage-level routes (owner, admin only)
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

    // Default safety net: GET = read (all roles), mutations = write (member+)
    app.use('/api/*', requireMethodCategory());

    // ── Audit middleware (after auth — has access to auth context) ──
    if (db) {
      const auditLogger = createAuditLogger(db);
      app.use('/api/*', auditMiddleware(auditLogger));
    }
  }

  // ─── Routes ────────────────────────────────────────────
  if (db) {
    app.route('/api/keys', apiKeysRoutes(db));
  }
  app.route('/api/events', eventsRoutes(store, {
    embeddingWorker: config?.embeddingWorker ?? null,
    sessionSummaryStore: db ? new SessionSummaryStore(db) : null,
  }));
  // Replay route registered directly on main app BEFORE sessions sub-app
  // (otherwise the sessions sub-app catches /api/sessions/* first)
  registerReplayRoutes(app, store);
  app.route('/api/sessions', sessionsRoutes(store));
  // Health routes registered directly on main app (before generic agents routes)
  registerHealthRoutes(app, store, db);
  if (db) {
    const { app: discApp } = discoveryRoutes(db);
    app.route('/api/agents', discApp);
    app.route('/api/agents', capabilityRoutes(store, db));
    const poolTransport = new LocalPoolTransport();
    const { app: delApp } = delegationRoutes(db, poolTransport);
    app.route('/api/agents', delApp);
    const { app: trustApp } = trustRoutes(db);
    app.route('/api/agents', trustApp);
  }
  app.route('/api/agents', agentsRoutes(store));
  app.route('/api/stats', statsRoutes(store));
  if (db) {
    app.route('/api/config', configRoutes(db));
    app.route('/api/analytics', analyticsRoutes(store, db));
  }
  app.route('/api/alerts', alertsRoutes(store));
  let loreAdapter: import('./lib/lore-client.js').LoreAdapter | null = null;
  if (resolvedConfig.loreEnabled) {
    try {
      loreAdapter = createLoreAdapter(resolvedConfig);
    } catch (err) {
      log.warn(`Lore adapter init failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (loreAdapter) {
    app.route('/api/lessons', loreProxyRoutes(loreAdapter));
  }

  // ─── Reflect / Pattern Analysis ────────────────────────
  app.route('/api/reflect', reflectRoutes(store));

  // ─── Optimize / Cost Recommendations ──────────────────
  app.route('/api/optimize', optimizeRoutes(store));

  // ─── Benchmarks / A/B Testing ─────────────────────────
  if (db) {
    app.route('/api/benchmarks', benchmarkRoutes(store, db));
  }

  // ─── Guardrails / Proactive Guardrails ────────────────
  if (db) {
    const gStore = new GuardrailStore(db);
    const contentEngine = new ContentGuardrailEngine(gStore);
    app.route('/api/guardrails', guardrailRoutes(gStore, contentEngine));
  }

  // ─── Cost Budgets (Feature 5) ─────────────────────────
  if (db) {
    const cBudgetEngine = new BudgetEngine(store, db);
    const budgetStore = cBudgetEngine.getStore();
    app.route('/api/cost-budgets', costBudgetRoutes(budgetStore, store, cBudgetEngine));
  }

  // ─── Recall / Semantic Search ─────────────────────────
  {
    const embeddingService = config?.embeddingService ?? null;
    const embeddingStore = db ? new EmbeddingStore(db) : null;
    app.route('/api/recall', recallRoutes({ embeddingService, embeddingStore, eventStore: store }));

    // ─── Context / Cross-Session Retrieval ──────────────
    if (db) {
      app.route('/api/context', contextRoutes(store, {
        db,
        embeddingService,
        embeddingStore,
      }));
    }
  }

  // ─── Top-level Capabilities & Delegations (dashboard-facing) ──
  if (db) {
    app.route('/api/capabilities', capabilityTopRoutes(store, db));
    app.route('/api/delegations', delegationTopRoutes(db));
    // Discovery top-level (for /api/discovery?taskType=...)
    const { app: discTopApp } = discoveryRoutes(db);
    app.route('/api/discovery', discTopApp);
  }

  // ─── Audit Log (SH-2) ──────────────────────────────────
  if (db) {
    app.route('/api/audit', auditRoutes(db));
    app.route('/api/audit/verify', auditVerifyRoutes(db, resolvedConfig.auditSigningKey));
    app.route('/api/compliance', complianceRoutes(db, resolvedConfig.auditSigningKey, {
      retentionDays: resolvedConfig.retentionDays,
    }));
  }

  // ─── Community Sharing (Stories 4.1–4.3) ────────────────
  // Auth is handled by the unified catch-all above.
  if (loreAdapter) {
    app.route('/api/community', loreCommunityProxyRoutes(loreAdapter));
  }

  // ─── Mesh Proxy (agentkit-mesh) ─────────────────────────
  // Auth is handled by the unified catch-all above.
  if (resolvedConfig.meshEnabled && resolvedConfig.meshUrl) {
    const meshAdapter = new RemoteMeshAdapter(resolvedConfig.meshUrl);
    app.route('/api/mesh', meshProxyRoutes(meshAdapter));
  }

  // ─── OTLP HTTP Receiver [F2-S5] ─────────────────────────
  // Default: no auth (standard OTel convention). Opt-in via env vars.
  if (resolvedConfig.otlpAuthRequired) {
    // Full unified auth on OTLP endpoints
    const authLookup = config?.apiKeyLookup ?? db ?? null;
    app.use('/v1/*', unifiedAuthMiddleware(authLookup, {
      authDisabled: resolvedConfig.authDisabled,
      jwtSecret: process.env['JWT_SECRET'],
    }));
  } else if (resolvedConfig.otlpAuthToken) {
    // Simple bearer token check
    const { createMiddleware } = await import('hono/factory');
    app.use('/v1/*', createMiddleware(async (c, next) => {
      const authHeader = c.req.header('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return otlpAuthRequiredError(c);
      }
      const token = authHeader.slice(7);
      if (token !== resolvedConfig.otlpAuthToken) {
        return otlpInvalidToken(c);
      }
      return next();
    }));
  }
  app.route('/v1', otlpRoutes(store, resolvedConfig));

  // ─── Server Info (Feature 10, Story 10.1) ─────────────
  {
    const features = [
      'sessions', 'agents', 'alerts', 'analytics', 'stats',
      'recall', 'reflect', 'optimize', 'context', 'health',
      'replay', 'benchmarks', 'guardrails', 'discovery', 'delegation',
      'cost-budgets', 'trust', 'lessons',
    ];
    const { serverInfoRoutes } = await import('./routes/server-info.js');
    app.route('/api/server-info', serverInfoRoutes(features));
  }

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

/**
 * Start the server as a standalone process.
 * Creates the database, runs migrations, and starts listening.
 */
export async function startServer() {
  // SH-7: Resolve secrets from env / file / ARN before anything reads process.env
  const { resolveAllSecrets } = await import('./lib/secrets.js');
  await resolveAllSecrets();

  const config = getConfig();
  validateConfig(config);

  // Create and initialize database
  // For Postgres, we need the raw sql client for shutdown & health checks
  let pgSql: import('postgres').Sql | undefined;
  let pgDb: import('./db/connection.postgres.js').PostgresDb | undefined;
  let store: IEventStore;
  let db: SqliteDb;

  // SQLite is always created for auxiliary features (api_keys, audit, guardrails, etc.)
  // Even when PG is the primary event/embedding store
  db = createDb({ databasePath: config.dbPath });
  runMigrations(db);

  if (config.storageBackend === 'postgres') {
    const { createPostgresConnection, verifyPostgresConnection } = await import('./db/connection.postgres.js');
    const conn = createPostgresConnection();
    await verifyPostgresConnection(conn.sql); // fail fast if unreachable
    pgSql = conn.sql;
    pgDb = conn.db;

    const { runPostgresMigrations } = await import('./db/migrate.postgres.js');
    await runPostgresMigrations(pgDb);

    const { PostgresEventStore } = await import('./db/postgres-store.js');
    store = new PostgresEventStore(pgDb);

    // Warn about silent SQLite → PG switch for existing Docker Compose users
    log.warn('STORAGE_BACKEND=postgres is now active. Previous SQLite data at ' +
      `${config.dbPath} is not automatically migrated.`);
    log.info('Database: PostgreSQL');
  } else {
    store = new SqliteEventStore(db);
    log.info(`Database: SQLite (${config.dbPath})`);
  }

  // Create embedding service & worker (optional — fail-safe)
  let embeddingService: EmbeddingService | null = null;
  let embeddingWorker: EmbeddingWorker | null = null;
  if (process.env.DISABLE_EMBEDDINGS) {
    log.info('Embeddings: disabled (DISABLE_EMBEDDINGS set)');
  } else {
    try {
      const { createEmbeddingService } = await import('./lib/embeddings/index.js');
      embeddingService = createEmbeddingService();

      let embeddingStore: IEmbeddingStore;
      if (config.storageBackend === 'postgres' && pgDb) {
        const { PostgresEmbeddingStore } = await import('./db/postgres-embedding-store.js');
        const pgEmbeddingStore = new PostgresEmbeddingStore(pgDb);
        await pgEmbeddingStore.initialize();
        embeddingStore = pgEmbeddingStore;
      } else {
        embeddingStore = new EmbeddingStore(db);
      }

      embeddingWorker = new EmbeddingWorker(embeddingService, embeddingStore);
      embeddingWorker.start();
      log.info(`Embeddings: enabled (${embeddingService.modelName})`);
    } catch (err) {
      log.info(`Embeddings: disabled (${err instanceof Error ? err.message : 'unknown error'})`);
    }
  }

  // Create app with db reference for auth
  // Create API key lookup for auth (uses SQLite for auxiliary features in both modes)
  const { SqliteApiKeyLookup } = await import('./db/api-key-lookup.js');
  const apiKeyLookup = new SqliteApiKeyLookup(db);

  const app = await createApp(store, { ...config, db, apiKeyLookup, embeddingService, embeddingWorker, pgSql });

  // Start listening
  log.info(`AgentLens server starting on port ${config.port}`);
  log.info(`Auth: ${config.authDisabled ? 'DISABLED (dev mode)' : 'enabled'}`);
  log.info(`CORS origin: ${config.corsOrigin}`);

  // Audit log retention cleanup (SH-2)
  {
    const auditRetentionDays = parseInt(process.env['AUDIT_RETENTION_DAYS'] ?? '90', 10);
    if (auditRetentionDays > 0) {
      try {
        const deleted = cleanupAuditLogs(db, auditRetentionDays);
        if (deleted > 0) {
          log.info(`Audit log cleanup: removed ${deleted} entries older than ${auditRetentionDays} days`);
        }
      } catch (err) {
        log.warn(`Audit log cleanup failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Start alert evaluation engine
  const alertEngine = new AlertEngine(store);
  alertEngine.start();

  // Start guardrail evaluation engine (v0.8.0)
  // Wire the agent store so pause_agent/downgrade_model actions can UPDATE the agents table (B1)
  setAgentStore(store as any);
  const guardrailEngine = new GuardrailEngine(store, db);
  guardrailEngine.start();
  log.info('Guardrails: enabled');

  // Start budget engine and anomaly detector (Feature 5)
  const budgetEngine = new BudgetEngine(store, db);
  budgetEngine.start();
  const anomalyDetector = new CostAnomalyDetector(store, budgetEngine.getStore());
  anomalyDetector.start();
  log.info('Cost budgets & anomaly detection: enabled');

  // M-11 FIX: Graceful shutdown for engines, workers, HTTP server, and PG pool
  let httpServer: ReturnType<typeof serve> | undefined;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down...');

    // 1. Stop accepting new requests
    if (httpServer) {
      httpServer.close(() => log.info('HTTP server closed'));
    }

    // 2. Stop engines and workers
    alertEngine.stop();
    guardrailEngine.stop();
    if (embeddingWorker) embeddingWorker.stop();

    // 3. Drain PG pool (5s timeout)
    if (pgSql) {
      try {
        log.info('Draining PostgreSQL connection pool...');
        await Promise.race([
          pgSql.end({ timeout: 5 }),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        log.info('PostgreSQL pool drained');
      } catch (err) {
        log.warn(`PG pool drain error: ${err instanceof Error ? err.message : err}`);
      }
    }

    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  httpServer = serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    log.info(`AgentLens server listening on http://localhost:${info.port}`);
  });

  return app;
}

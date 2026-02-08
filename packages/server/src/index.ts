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
import { getConfig, type ServerConfig } from './config.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
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
import { lessonsRoutes } from './routes/lessons.js';
import { reflectRoutes } from './routes/reflect.js';
import { recallRoutes } from './routes/recall.js';
import { contextRoutes } from './routes/context.js';
import { optimizeRoutes } from './routes/optimize.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerReplayRoutes } from './routes/replay.js';
import { benchmarkRoutes } from './routes/benchmarks.js';
import { guardrailRoutes } from './routes/guardrails.js';
import { GuardrailEngine } from './lib/guardrails/engine.js';
import { GuardrailStore } from './db/guardrail-store.js';
import { setAgentStore } from './lib/guardrails/actions.js';
import { createDb, type SqliteDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { SqliteEventStore } from './db/sqlite-store.js';
import { AlertEngine } from './lib/alert-engine.js';
import { eventBus } from './lib/event-bus.js';
import { EmbeddingWorker } from './lib/embeddings/worker.js';
import type { EmbeddingService } from './lib/embeddings/index.js';
import { EmbeddingStore } from './db/embedding-store.js';
import { SessionSummaryStore } from './db/session-summary-store.js';

// Re-export everything consumers may need
export { getConfig } from './config.js';
export type { ServerConfig } from './config.js';
export { authMiddleware, hashApiKey } from './middleware/auth.js';
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
export { lessonsRoutes } from './routes/lessons.js';
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
export { LessonStore } from './db/lesson-store.js';
export { SessionSummaryStore } from './db/session-summary-store.js';
export { contextRoutes } from './routes/context.js';
export { registerHealthRoutes } from './routes/health.js';
export { ContextRetriever } from './lib/context/retrieval.js';
export { guardrailRoutes } from './routes/guardrails.js';
export { GuardrailEngine } from './lib/guardrails/engine.js';
export { GuardrailStore } from './db/guardrail-store.js';

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
export function createApp(
  store: IEventStore,
  config?: Partial<ServerConfig> & {
    db?: SqliteDb;
    embeddingService?: EmbeddingService | null;
    embeddingWorker?: EmbeddingWorker | null;
  },
) {
  const resolvedConfig = { ...getConfig(), ...config };

  const app = new Hono<{ Variables: AuthVariables }>();

  // ─── Global error handler ──────────────────────────────
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    const status = (err as { status?: number }).status ?? 500;
    return c.json(
      { error: err.message || 'Internal server error', status },
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
  app.use('/api/*', cors({ origin: resolvedConfig.corsOrigin }));
  app.use('/api/*', logger());

  // ─── Health check (no auth) ────────────────────────────
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0' });
  });

  // ─── SSE stream (authenticates via Bearer header or ?token= query param) ──
  // Mounted before auth middleware — handles its own auth internally for EventSource compat.
  app.route('/api/stream', streamRoutes(config?.db, resolvedConfig.authDisabled));

  // ─── Webhook ingest (no API key auth — uses HMAC signature verification) ──
  app.route('/api/events/ingest', ingestRoutes(store, {
    agentgateWebhookSecret: process.env['AGENTGATE_WEBHOOK_SECRET'],
    formbridgeWebhookSecret: process.env['FORMBRIDGE_WEBHOOK_SECRET'],
  }));

  // ─── Auth middleware on protected routes ───────────────
  // We need the db reference for auth key lookup
  const db = config?.db;
  if (!db && !resolvedConfig.authDisabled) {
    throw new Error(
      'createApp() requires a `db` option when auth is enabled. ' +
      'Either provide a database or set authDisabled: true.',
    );
  }
  if (db) {
    app.use('/api/keys/*', authMiddleware(db, resolvedConfig.authDisabled));
    // Protect event endpoints but exclude webhook ingest (uses HMAC auth instead)
    app.use('/api/events/*', async (c, next) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith('/api/events/ingest')) return next();
      return authMiddleware(db, resolvedConfig.authDisabled)(c, next);
    });
    app.use('/api/sessions/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/agents/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/stats/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/config/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/analytics/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/alerts/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/lessons/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/reflect/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/reflect', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/recall/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/recall', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/context/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/context', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/optimize/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/optimize', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/benchmarks/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/benchmarks', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/health/overview', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/health/history', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/guardrails/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/guardrails', authMiddleware(db, resolvedConfig.authDisabled));
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
  app.route('/api/agents', agentsRoutes(store));
  app.route('/api/stats', statsRoutes(store));
  if (db) {
    app.route('/api/config', configRoutes(db));
    app.route('/api/analytics', analyticsRoutes(store, db));
  }
  app.route('/api/alerts', alertsRoutes(store));
  if (db) {
    app.route('/api/lessons', lessonsRoutes(db, { embeddingWorker: config?.embeddingWorker ?? null }));
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
    app.route('/api/guardrails', guardrailRoutes(gStore));
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
  const config = getConfig();

  // Create and initialize database
  const db = createDb({ databasePath: config.dbPath });
  runMigrations(db);
  const store = new SqliteEventStore(db);

  // Create embedding service & worker (optional — fail-safe)
  let embeddingService: EmbeddingService | null = null;
  let embeddingWorker: EmbeddingWorker | null = null;
  try {
    const { createEmbeddingService } = await import('./lib/embeddings/index.js');
    embeddingService = createEmbeddingService();
    const embeddingStore = new EmbeddingStore(db);
    embeddingWorker = new EmbeddingWorker(embeddingService, embeddingStore);
    embeddingWorker.start();
    console.log(`  Embeddings: enabled (${embeddingService.modelName})`);
  } catch (err) {
    console.log(`  Embeddings: disabled (${err instanceof Error ? err.message : 'unknown error'})`);
  }

  // Create app with db reference for auth
  const app = createApp(store, { ...config, db, embeddingService, embeddingWorker });

  // Start listening
  console.log(`AgentLens server starting on port ${config.port}`);
  console.log(`  Auth: ${config.authDisabled ? 'DISABLED (dev mode)' : 'enabled'}`);
  console.log(`  CORS origin: ${config.corsOrigin}`);
  console.log(`  Database: ${config.dbPath}`);

  // Start alert evaluation engine
  const alertEngine = new AlertEngine(store);
  alertEngine.start();

  // Start guardrail evaluation engine (v0.8.0)
  // Wire the agent store so pause_agent/downgrade_model actions can UPDATE the agents table (B1)
  setAgentStore(store);
  const guardrailEngine = new GuardrailEngine(store, db);
  guardrailEngine.start();
  console.log('  Guardrails: enabled');

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`AgentLens server listening on http://localhost:${info.port}`);
  });

  return app;
}

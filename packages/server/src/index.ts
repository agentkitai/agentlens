/**
 * @agentlensai/server — Hono HTTP API server and event storage
 *
 * Thin entry point: re-exports createApp from app.ts and startServer below.
 * The heavy lifting lives in:
 *   - app.ts          — Hono app creation, middleware setup
 *   - routes/registration.ts — route mounting
 *   - health.ts       — inline health check endpoint
 */

import { serve } from '@hono/node-server';
import type { IEventStore } from '@agentlensai/core';
import { getConfig, validateConfig } from './config.js';
import { createDb, type SqliteDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { SqliteEventStore } from './db/sqlite-store.js';
import { AlertEngine } from './lib/alert-engine.js';
import { EmbeddingWorker } from './lib/embeddings/worker.js';
import type { EmbeddingService } from './lib/embeddings/index.js';
import { EmbeddingStore } from './db/embedding-store.js';
import type { IEmbeddingStore } from './db/embedding-store.interface.js';
import { NotificationChannelRepository } from './db/repositories/notification-channel-repository.js';
import { NotificationRouter } from './lib/notifications/router.js';
import { GuardrailEngine } from './lib/guardrails/engine.js';
import { setAgentStore, setNotificationRouter } from './lib/guardrails/actions.js';
import { BudgetEngine } from './lib/budget-engine.js';
import { CostAnomalyDetector } from './lib/cost-anomaly-detector.js';
import { cleanupAuditLogs } from './lib/audit.js';
import { createLogger } from './lib/logger.js';

// Re-export createApp from the new module
export { createApp } from './app.js';

const log = createLogger('Server');

// ─── Re-exports (preserve public API) ──────────────────────

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
export { healthRoutes, registerHealthRoutes } from './routes/health.js';
export { ContextRetriever } from './lib/context/retrieval.js';
export { loreProxyRoutes } from './routes/lore-proxy.js';
export { createLoreAdapter, LoreReadAdapter, LoreError } from './lib/lore-client.js';
export type { LoreMemory, LoreStats, LoreListResponse } from './lib/lore-client.js';
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

// ─── startServer ─────────────────────────────────────────────

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
  let pgSql: import('postgres').Sql | undefined;
  let pgDb: import('./db/connection.postgres.js').PostgresDb | undefined;
  let store: IEventStore;
  let db: SqliteDb;

  // SQLite is always created for auxiliary features
  db = createDb({ databasePath: config.dbPath });
  runMigrations(db);

  if (config.storageBackend === 'postgres') {
    const { createPostgresConnection, verifyPostgresConnection } = await import('./db/connection.postgres.js');
    const conn = createPostgresConnection();
    await verifyPostgresConnection(conn.sql);
    pgSql = conn.sql;
    pgDb = conn.db;

    const { runPostgresMigrations } = await import('./db/migrate.postgres.js');
    await runPostgresMigrations(pgDb);

    const { PostgresEventStore } = await import('./db/postgres-store.js');
    store = new PostgresEventStore(pgDb);

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
  const { SqliteApiKeyLookup } = await import('./db/api-key-lookup.js');
  const apiKeyLookup = new SqliteApiKeyLookup(db);

  const { createApp } = await import('./app.js');
  const app = await createApp(store, { ...config, db, apiKeyLookup, embeddingService, embeddingWorker, pgSql, pgDb });

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
  const notifRepoForEngine = db ? new NotificationChannelRepository(db) : null;
  const notifRouterForEngine = notifRepoForEngine ? new NotificationRouter(notifRepoForEngine) : null;
  const alertEngine = new AlertEngine(store, { notificationRouter: notifRouterForEngine ?? undefined });
  alertEngine.start();

  // Start guardrail evaluation engine (v0.8.0)
  setAgentStore(store as any);
  if (notifRouterForEngine) setNotificationRouter(notifRouterForEngine);
  const guardrailEngine = new GuardrailEngine(store, db);
  guardrailEngine.start();
  log.info('Guardrails: enabled');

  // Start budget engine and anomaly detector (Feature 5)
  const budgetEngine = new BudgetEngine(store, db);
  budgetEngine.start();
  const anomalyDetector = new CostAnomalyDetector(store, budgetEngine.getStore());
  anomalyDetector.start();
  log.info('Cost budgets & anomaly detection: enabled');

  // M-11 FIX: Graceful shutdown
  let httpServer: ReturnType<typeof serve> | undefined;
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down...');

    if (httpServer) {
      httpServer.close(() => log.info('HTTP server closed'));
    }

    alertEngine.stop();
    guardrailEngine.stop();
    if (embeddingWorker) embeddingWorker.stop();

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

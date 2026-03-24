/**
 * Route registration — extracted from index.ts (cq-001)
 *
 * Mounts every route module onto the app in the correct order.
 */

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { ServerConfig } from '../config.js';
import type { SqliteDb } from '../db/index.js';
import type { EmbeddingService } from '../lib/embeddings/index.js';
import type { EmbeddingWorker } from '../lib/embeddings/worker.js';
import type { IEmbeddingStore } from '../db/embedding-store.interface.js';

import { apiKeysRoutes } from './api-keys.js';
import { eventsRoutes } from './events.js';
import { sessionsRoutes } from './sessions.js';
import { agentsRoutes } from './agents.js';
import { statsRoutes } from './stats.js';
import { configRoutes } from './config.js';
import { alertsRoutes } from './alerts.js';
import { notificationRoutes } from './notifications.js';
import { NotificationChannelRepository } from '../db/repositories/notification-channel-repository.js';
import { NotificationRouter } from '../lib/notifications/router.js';
import { ingestRoutes } from './ingest.js';
import { analyticsRoutes } from './analytics.js';
import { streamRoutes } from './stream.js';
import { reflectRoutes } from './reflect.js';
import { recallRoutes } from './recall.js';
import { contextRoutes } from './context.js';
import { optimizeRoutes } from './optimize.js';
import { healthRoutes } from './health.js';
import { diagnoseRoutes } from './diagnose.js';
import { registerReplayRoutes } from './replay.js';
import { benchmarkRoutes } from './benchmarks.js';
import { promptRoutes } from './prompts.js';
import { guardrailRoutes } from './guardrails.js';
import { evalRoutes } from './eval.js';
import { capabilityRoutes } from './capabilities.js';
import { capabilityTopRoutes } from './capabilities-top.js';
import { discoveryRoutes } from './discovery.js';
import { delegationRoutes } from './delegation.js';
import { delegationTopRoutes } from './delegations-top.js';
import { trustRoutes } from './trust.js';
import { LocalPoolTransport } from '../services/delegation-service.js';
import { loreProxyRoutes } from './lore-proxy.js';
import { createLoreAdapter } from '../lib/lore-client.js';
import { meshProxyRoutes } from './mesh-proxy.js';
import { RemoteMeshAdapter } from '../lib/mesh-client.js';
import { otlpRoutes } from './otlp.js';
import { authRoutes } from './auth.js';
import { auditRoutes } from './audit.js';
import { cloudOrgRoutes } from '../cloud/routes/index.js';
import { auditVerifyRoutes } from './audit-verify.js';
import { complianceRoutes } from './compliance.js';
import { costBudgetRoutes } from './cost-budgets.js';
import { GuardrailStore } from '../db/guardrail-store.js';
import { ContentGuardrailEngine } from '../lib/guardrails/content-engine.js';
import { BudgetEngine } from '../lib/budget-engine.js';
import { EmbeddingStore } from '../db/embedding-store.js';
import { SessionSummaryStore } from '../db/session-summary-store.js';
import { otlpAuthRequired as otlpAuthRequiredError, otlpInvalidToken } from '../middleware/auth-errors.js';
import { unifiedAuthMiddleware } from '../middleware/unified-auth.js';
import { createLogger } from '../lib/logger.js';
import { apiReference } from '@scalar/hono-api-reference';

const log = createLogger('Routes');

export interface RouteRegistrationConfig {
  db?: SqliteDb;
  apiKeyLookup?: import('../db/api-key-lookup.js').IApiKeyLookup;
  embeddingService?: EmbeddingService | null;
  embeddingWorker?: EmbeddingWorker | null;
  pgSql?: import('postgres').Sql;
  pgDb?: import('../db/connection.postgres.js').PostgresDb;
}

/**
 * Register all route modules on the given Hono app.
 */
export async function registerRoutes(
  app: OpenAPIHono<{ Variables: AuthVariables }>,
  store: IEventStore,
  resolvedConfig: ServerConfig,
  config?: RouteRegistrationConfig,
) {
  const db = config?.db;

  // ─── Feature flags (no auth — dashboard needs before login) ──
  app.get('/api/config/features', (c) => {
    return c.json({
      lore: resolvedConfig.loreEnabled,
      ...(resolvedConfig.loreEnabled && resolvedConfig.loreApiUrl ? { loreUrl: resolvedConfig.loreApiUrl } : {}),
      mesh: resolvedConfig.meshEnabled,
    });
  });

  // ─── SSE stream (authenticates via Bearer header or ?token= query param) ──
  app.route('/api/stream', streamRoutes(config?.apiKeyLookup, resolvedConfig.authDisabled));

  // ─── Webhook ingest (no API key auth — uses HMAC signature verification) ──
  app.route('/api/events/ingest', ingestRoutes(store, {
    agentgateWebhookSecret: process.env['AGENTGATE_WEBHOOK_SECRET'],
    formbridgeWebhookSecret: process.env['FORMBRIDGE_WEBHOOK_SECRET'],
  }));

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

  // ─── Routes ────────────────────────────────────────────
  if (db) {
    app.route('/api/keys', apiKeysRoutes(db));
  }
  app.route('/api/events', eventsRoutes(store, {
    embeddingWorker: config?.embeddingWorker ?? null,
    sessionSummaryStore: db ? new SessionSummaryStore(db) : null,
  }));
  // Replay route registered directly on main app BEFORE sessions sub-app
  registerReplayRoutes(app, store);
  app.route('/api/sessions', sessionsRoutes(store));
  // Health routes [F13-S2] — factory pattern, mounted at /api
  app.route('/api', healthRoutes(store, db));
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
    app.route('/api/analytics', analyticsRoutes(store, db, config?.pgDb));
  }
  app.route('/api/alerts', alertsRoutes(store));

  // Feature 12: Notification channels
  const notifRepo = db ? new NotificationChannelRepository(db) : null;
  const notifRouter = notifRepo ? new NotificationRouter(notifRepo) : null;
  if (notifRepo && notifRouter) {
    app.route('/api/notifications', notificationRoutes(notifRepo, notifRouter));
  }

  let loreAdapter: import('../lib/lore-client.js').LoreReadAdapter | null = null;
  if (resolvedConfig.loreEnabled) {
    try {
      loreAdapter = createLoreAdapter(resolvedConfig);
    } catch (err) {
      log.warn(`Lore adapter init failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (loreAdapter) {
    app.route('/api/lore', loreProxyRoutes(loreAdapter));
    loreAdapter.checkHealth().then((ok) => {
      if (!ok) log.warn('Lore server unreachable at startup. Memory features may be unavailable.');
    });
  }

  // ─── AI Diagnostics (Feature 18) ───────────────────────
  app.route('/api', diagnoseRoutes(store));

  // ─── Reflect / Pattern Analysis ────────────────────────
  app.route('/api/reflect', reflectRoutes(store));

  // ─── Optimize / Cost Recommendations ──────────────────
  app.route('/api/optimize', optimizeRoutes(store));

  // ─── Benchmarks / A/B Testing ─────────────────────────
  if (db) {
    app.route('/api/benchmarks', benchmarkRoutes(store, db));
    app.route('/api/prompts', promptRoutes(db));
    app.route('/api/eval', evalRoutes(db));
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

  // ─── Cloud org routes with org access validation [F6-fix] ──
  if (config?.pgSql) {
    const cloudDb = {
      async query(sql: string, params?: unknown[]) {
        const result = await config.pgSql!.unsafe(sql, params as any[]);
        return { rows: Array.from(result) };
      },
    };
    app.route('/api/cloud/orgs', cloudOrgRoutes({ db: cloudDb }));
  }

  // ─── Mesh Proxy (agentkit-mesh) ─────────────────────────
  if (resolvedConfig.meshEnabled && resolvedConfig.meshUrl) {
    const meshAdapter = new RemoteMeshAdapter(resolvedConfig.meshUrl);
    app.route('/api/mesh', meshProxyRoutes(meshAdapter));
  }

  // ─── OTLP HTTP Receiver [F2-S5] ─────────────────────────
  if (resolvedConfig.otlpAuthRequired) {
    const authLookup = config?.apiKeyLookup ?? db ?? null;
    app.use('/v1/*', unifiedAuthMiddleware(authLookup, {
      authDisabled: resolvedConfig.authDisabled,
      jwtSecret: process.env['JWT_SECRET'],
    }));
  } else if (resolvedConfig.otlpAuthToken) {
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
      'cost-budgets', 'trust', 'lore',
    ];
    const { serverInfoRoutes } = await import('./server-info.js');
    app.route('/api/server-info', serverInfoRoutes(features));
  }

  // ─── OpenAPI Spec & Documentation [F13-S1] ────────────
  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'AgentLens API',
      version: '0.12.1',
      description: 'Observability, governance, and orchestration for AI agents.',
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    security: [{ Bearer: [] }],
    tags: [
      { name: 'Sessions', description: 'Agent session lifecycle and queries' },
      { name: 'Events', description: 'Event ingestion and retrieval' },
      { name: 'Agents', description: 'Agent management and health' },
      { name: 'Auth', description: 'Authentication and API keys' },
      { name: 'Analytics', description: 'Metrics, costs, and statistics' },
      { name: 'Alerts', description: 'Alert rules and history' },
      { name: 'Intelligence', description: 'Reflect, recall, context, optimize' },
      { name: 'Trust & Governance', description: 'Trust scores, guardrails, cost budgets' },
      { name: 'Multi-Agent', description: 'Discovery, delegation, capabilities, mesh' },
      { name: 'Observability', description: 'Health, benchmarks, audit' },
      { name: 'Platform', description: 'Config, OTLP, streaming, webhooks' },
    ],
  });

  app.get('/api/docs', apiReference({
    url: '/api/openapi.json',
    theme: 'kepler',
  } as any));
}

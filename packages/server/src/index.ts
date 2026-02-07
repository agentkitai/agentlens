/**
 * @agentlens/server — Hono HTTP API server and event storage
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
import type { IEventStore } from '@agentlens/core';
import { getConfig, type ServerConfig } from './config.js';
import { authMiddleware, type AuthVariables } from './middleware/auth.js';
import { apiKeysRoutes } from './routes/api-keys.js';
import { eventsRoutes } from './routes/events.js';
import { sessionsRoutes } from './routes/sessions.js';
import { agentsRoutes } from './routes/agents.js';
import { statsRoutes } from './routes/stats.js';
import { createDb, type SqliteDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { SqliteEventStore } from './db/sqlite-store.js';

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
export { SqliteEventStore } from './db/sqlite-store.js';
export { createDb, createTestDb } from './db/index.js';
export type { SqliteDb } from './db/index.js';
export { runMigrations } from './db/migrate.js';

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
  config?: Partial<ServerConfig> & { db?: SqliteDb },
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
    app.use('/api/events/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/sessions/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/agents/*', authMiddleware(db, resolvedConfig.authDisabled));
    app.use('/api/stats/*', authMiddleware(db, resolvedConfig.authDisabled));
  }

  // ─── Routes ────────────────────────────────────────────
  if (db) {
    app.route('/api/keys', apiKeysRoutes(db));
  }
  app.route('/api/events', eventsRoutes(store));
  app.route('/api/sessions', sessionsRoutes(store));
  app.route('/api/agents', agentsRoutes(store));
  app.route('/api/stats', statsRoutes(store));

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
export function startServer() {
  const config = getConfig();

  // Create and initialize database
  const db = createDb({ databasePath: config.dbPath });
  runMigrations(db);
  const store = new SqliteEventStore(db);

  // Create app with db reference for auth
  const app = createApp(store, { ...config, db });

  // Start listening
  console.log(`AgentLens server starting on port ${config.port}`);
  console.log(`  Auth: ${config.authDisabled ? 'DISABLED (dev mode)' : 'enabled'}`);
  console.log(`  CORS origin: ${config.corsOrigin}`);
  console.log(`  Database: ${config.dbPath}`);

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`AgentLens server listening on http://localhost:${info.port}`);
  });

  return app;
}

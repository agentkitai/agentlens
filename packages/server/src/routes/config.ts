/**
 * Config Endpoints (Story 8.4)
 *
 * GET  /api/config — get current configuration
 * PUT  /api/config — update configuration values
 *
 * Configuration values are stored in a simple key-value table.
 * Falls back to environment defaults when no override exists.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { getConfig } from '../config.js';

/** Schema for config update request */
const configUpdateSchema = z.object({
  retentionDays: z.number().int().min(0).max(3650).optional(),
  agentGateUrl: z.string().max(2048).optional(),
  agentGateSecret: z.string().max(512).optional(),
  formBridgeUrl: z.string().max(2048).optional(),
  formBridgeSecret: z.string().max(512).optional(),
});

export type ConfigValues = z.infer<typeof configUpdateSchema>;

/**
 * Ensure the config_kv table exists (simple key-value store).
 */
function ensureConfigTable(db: SqliteDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS config_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

export function getConfigValue(db: SqliteDb, key: string): string | null {
  const row = db.get<{ value: string }>(
    sql`SELECT value FROM config_kv WHERE key = ${key}`,
  );
  return row?.value ?? null;
}

function setConfigValue(db: SqliteDb, key: string, value: string): void {
  db.run(
    sql`INSERT INTO config_kv (key, value) VALUES (${key}, ${value}) ON CONFLICT(key) DO UPDATE SET value = ${value}`,
  );
}

function getAllConfig(db: SqliteDb): ConfigValues {
  const serverConfig = getConfig();
  return {
    retentionDays: (() => {
      const v = getConfigValue(db, 'retentionDays');
      return v !== null ? parseInt(v, 10) : serverConfig.retentionDays;
    })(),
    agentGateUrl: getConfigValue(db, 'agentGateUrl') ?? '',
    agentGateSecret: getConfigValue(db, 'agentGateSecret') ?? '',
    formBridgeUrl: getConfigValue(db, 'formBridgeUrl') ?? '',
    formBridgeSecret: getConfigValue(db, 'formBridgeSecret') ?? '',
  };
}

export function configRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  ensureConfigTable(db);

  // GET /api/config — current config
  app.get('/', (c) => {
    const config = getAllConfig(db);
    // Mask secrets in response
    return c.json({
      retentionDays: config.retentionDays,
      agentGateUrl: config.agentGateUrl,
      agentGateSecret: config.agentGateSecret ? '••••••••' : '',
      formBridgeUrl: config.formBridgeUrl,
      formBridgeSecret: config.formBridgeSecret ? '••••••••' : '',
    });
  });

  // PUT /api/config — update config values
  app.put('/', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = configUpdateSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: parseResult.error.issues,
      }, 400);
    }

    const updates = parseResult.data;

    if (updates.retentionDays !== undefined) {
      setConfigValue(db, 'retentionDays', String(updates.retentionDays));
    }
    if (updates.agentGateUrl !== undefined) {
      setConfigValue(db, 'agentGateUrl', updates.agentGateUrl);
    }
    if (updates.agentGateSecret !== undefined) {
      setConfigValue(db, 'agentGateSecret', updates.agentGateSecret);
    }
    if (updates.formBridgeUrl !== undefined) {
      setConfigValue(db, 'formBridgeUrl', updates.formBridgeUrl);
    }
    if (updates.formBridgeSecret !== undefined) {
      setConfigValue(db, 'formBridgeSecret', updates.formBridgeSecret);
    }

    return c.json({ ok: true });
  });

  return app;
}

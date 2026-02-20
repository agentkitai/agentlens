/**
 * Backend-agnostic API key lookup for auth middleware.
 * Works with both SQLite (sync) and PostgreSQL (async).
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import { apiKeys as sqliteApiKeys } from './schema.sqlite.js';

export interface ApiKeyRow {
  id: string;
  keyHash: string;
  name: string;
  scopes: string | string[];
  tenantId: string;
  revokedAt: number | null;
  expiresAt: number | null;
}

export interface IApiKeyLookup {
  findByHash(keyHash: string): Promise<ApiKeyRow | null>;
  updateLastUsed(id: string): Promise<void>;
}

export class SqliteApiKeyLookup implements IApiKeyLookup {
  constructor(private readonly db: SqliteDb) {}

  async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const row = this.db
      .select()
      .from(sqliteApiKeys)
      .where(and(eq(sqliteApiKeys.keyHash, keyHash), isNull(sqliteApiKeys.revokedAt)))
      .get();
    if (!row) return null;
    return {
      id: row.id,
      keyHash: row.keyHash,
      name: row.name,
      scopes: row.scopes,
      tenantId: row.tenantId,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
    };
  }

  async updateLastUsed(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    try {
      this.db.update(sqliteApiKeys).set({ lastUsedAt: now }).where(eq(sqliteApiKeys.id, id)).run();
    } catch { /* non-critical */ }
  }
}

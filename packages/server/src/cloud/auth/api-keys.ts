/**
 * API Key CRUD Service (S-2.3)
 *
 * Create/list/revoke API keys. Keys follow `al_live_<random32>` / `al_test_<random32>` format.
 * Store scrypt hash only — show full key once at creation.
 * Tier limits: Free=2, Pro=10, Team=50.
 */

import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords.js';
import type { MigrationClient } from '../migrate.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type ApiKeyEnvironment = 'production' | 'staging' | 'development' | 'test';

export interface CreateApiKeyInput {
  orgId: string;
  name: string;
  environment: ApiKeyEnvironment;
  createdBy: string; // user ID
  scopes?: string[];
  rateLimitOverride?: number | null;
}

export interface ApiKeyRecord {
  id: string;
  org_id: string;
  key_prefix: string;
  name: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  rate_limit_override: number | null;
  created_by: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateApiKeyResult {
  /** Full key — shown ONCE at creation */
  fullKey: string;
  record: ApiKeyRecord;
}

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const TIER_KEY_LIMITS: Record<string, number> = {
  free: 2,
  pro: 10,
  team: 50,
  enterprise: 200,
};

const KEY_PREFIX_LIVE = 'al_live_';
const KEY_PREFIX_TEST = 'al_test_';
const KEY_RANDOM_BYTES = 24; // 24 bytes → 32 base64url chars

// ═══════════════════════════════════════════
// Key Generation
// ═══════════════════════════════════════════

/**
 * Generate a full API key: `al_live_<random32>` or `al_test_<random32>`.
 * The "prefix" stored for lookup is the first 12 chars (e.g. `al_live_abcd`).
 */
export function generateApiKey(environment: ApiKeyEnvironment): { fullKey: string; prefix: string } {
  const isTest = environment === 'test' || environment === 'development';
  const base = isTest ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
  const random = randomBytes(KEY_RANDOM_BYTES).toString('base64url');
  const fullKey = `${base}${random}`;
  // Prefix = first 16 chars for uniqueness (e.g. `al_live_abcdefgh`)
  const prefix = fullKey.slice(0, 16);
  return { fullKey, prefix };
}

// ═══════════════════════════════════════════
// API Key Service
// ═══════════════════════════════════════════

export class ApiKeyService {
  constructor(private db: MigrationClient) {}

  /**
   * Create a new API key. Returns full key (show once) + record.
   */
  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    // Check tier limit
    await this.enforceTierLimit(input.orgId);

    const { fullKey, prefix } = generateApiKey(input.environment);
    const keyHash = await hashPassword(fullKey);

    const result = await this.db.query(
      `INSERT INTO api_keys (org_id, key_prefix, key_hash, name, environment, scopes, rate_limit_override, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, org_id, key_prefix, name, environment, scopes, rate_limit_override, created_by, last_used_at, revoked_at, created_at`,
      [
        input.orgId,
        prefix,
        keyHash,
        input.name,
        input.environment,
        JSON.stringify(input.scopes ?? ['ingest', 'query']),
        input.rateLimitOverride ?? null,
        input.createdBy,
      ],
    );

    const record = (result.rows as ApiKeyRecord[])[0];
    // Parse scopes from JSONB string if needed
    if (typeof record.scopes === 'string') {
      record.scopes = JSON.parse(record.scopes as unknown as string);
    }

    return { fullKey, record };
  }

  /**
   * List API keys for an org. Returns prefix + metadata only (no hash, no full key).
   */
  async list(orgId: string): Promise<ApiKeyRecord[]> {
    const result = await this.db.query(
      `SELECT id, org_id, key_prefix, name, environment, scopes, rate_limit_override, created_by, last_used_at, revoked_at, created_at
       FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    return (result.rows as ApiKeyRecord[]).map((r) => {
      if (typeof r.scopes === 'string') r.scopes = JSON.parse(r.scopes as unknown as string);
      return r;
    });
  }

  /**
   * List only active (non-revoked) keys for an org.
   */
  async listActive(orgId: string): Promise<ApiKeyRecord[]> {
    const result = await this.db.query(
      `SELECT id, org_id, key_prefix, name, environment, scopes, rate_limit_override, created_by, last_used_at, revoked_at, created_at
       FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [orgId],
    );
    return (result.rows as ApiKeyRecord[]).map((r) => {
      if (typeof r.scopes === 'string') r.scopes = JSON.parse(r.scopes as unknown as string);
      return r;
    });
  }

  /**
   * Revoke an API key. Sets revoked_at timestamp.
   */
  async revoke(orgId: string, keyId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL`,
      [keyId, orgId],
    );
    return (result as any).rowCount > 0;
  }

  /**
   * Look up a key by prefix. Used by auth middleware.
   */
  async findByPrefix(prefix: string): Promise<(ApiKeyRecord & { key_hash: string }) | null> {
    const result = await this.db.query(
      `SELECT id, org_id, key_prefix, key_hash, name, environment, scopes, rate_limit_override, created_by, last_used_at, revoked_at, created_at
       FROM api_keys WHERE key_prefix = $1`,
      [prefix],
    );
    const row = (result.rows as any[])[0];
    if (!row) return null;
    if (typeof row.scopes === 'string') row.scopes = JSON.parse(row.scopes);
    return row;
  }

  /**
   * Update last_used_at (non-blocking, fire-and-forget).
   */
  updateLastUsed(keyId: string): void {
    this.db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [keyId]).catch(() => {
      // Fire and forget — don't block request
    });
  }

  /**
   * Verify a full API key against a stored hash.
   */
  async verifyKey(fullKey: string, storedHash: string): Promise<boolean> {
    return verifyPassword(fullKey, storedHash);
  }

  /**
   * Count active keys for an org.
   */
  async countActive(orgId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*)::int as count FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL`,
      [orgId],
    );
    return (result.rows as any[])[0].count;
  }

  /**
   * Enforce tier-based key limits.
   */
  private async enforceTierLimit(orgId: string): Promise<void> {
    // Get org plan
    const orgResult = await this.db.query(`SELECT plan FROM orgs WHERE id = $1`, [orgId]);
    const org = (orgResult.rows as any[])[0];
    if (!org) throw new ApiKeyError('org_not_found', 'Organization not found');

    const limit = TIER_KEY_LIMITS[org.plan] ?? TIER_KEY_LIMITS.free;
    const count = await this.countActive(orgId);

    if (count >= limit) {
      throw new ApiKeyError(
        'key_limit_reached',
        `API key limit reached for ${org.plan} plan (${limit} keys). Upgrade to create more.`,
      );
    }
  }
}

export class ApiKeyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

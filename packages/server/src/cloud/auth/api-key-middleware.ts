/**
 * API Key Authentication Middleware (S-2.4)
 *
 * Extracts `Authorization: Bearer al_...`, looks up key by prefix,
 * verifies hash, attaches org_id to request context.
 * Cache-friendly: in-memory Map with 60s TTL (Redis-replaceable).
 * `last_used_at` updated non-blocking. Full key never logged.
 */

import { ApiKeyService } from './api-keys.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface ApiKeyAuthContext {
  orgId: string;
  keyId: string;
  scopes: string[];
  rateLimitOverride: number | null;
  environment: string;
}

export interface ApiKeyAuthRequest {
  headers: { authorization?: string; [k: string]: string | undefined };
}

export interface CacheEntry {
  orgId: string;
  keyId: string;
  keyHash: string;
  scopes: string[];
  rateLimitOverride: number | null;
  environment: string;
  revoked: boolean;
  cachedAt: number;
}

export interface ApiKeyCache {
  get(prefix: string): CacheEntry | undefined;
  set(prefix: string, entry: CacheEntry): void;
  delete(prefix: string): void;
}

// ═══════════════════════════════════════════
// In-Memory Cache (Redis-replaceable)
// ═══════════════════════════════════════════

export class InMemoryApiKeyCache implements ApiKeyCache {
  private cache = new Map<string, CacheEntry>();

  constructor(private ttlMs: number = 60_000) {}

  get(prefix: string): CacheEntry | undefined {
    const entry = this.cache.get(prefix);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(prefix);
      return undefined;
    }
    return entry;
  }

  set(prefix: string, entry: CacheEntry): void {
    this.cache.set(prefix, entry);
  }

  delete(prefix: string): void {
    this.cache.delete(prefix);
  }

  /** For testing: get raw size */
  get size(): number {
    return this.cache.size;
  }
}

// ═══════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════

export class ApiKeyAuthMiddleware {
  private cache: ApiKeyCache;

  constructor(
    private keyService: ApiKeyService,
    cache?: ApiKeyCache,
  ) {
    this.cache = cache ?? new InMemoryApiKeyCache(60_000);
  }

  /**
   * Authenticate an API key from Authorization header.
   * Returns auth context or throws.
   */
  async authenticate(authHeader: string | undefined): Promise<ApiKeyAuthContext> {
    // 1. Extract bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiKeyAuthError(401, 'Missing or invalid Authorization header');
    }

    const fullKey = authHeader.slice(7); // strip "Bearer "

    // 2. Validate key format
    if (!fullKey.startsWith('al_live_') && !fullKey.startsWith('al_test_')) {
      throw new ApiKeyAuthError(401, 'Invalid API key format');
    }

    const prefix = fullKey.slice(0, 16);

    // 3. Check cache
    const cached = this.cache.get(prefix);
    if (cached) {
      if (cached.revoked) {
        throw new ApiKeyAuthError(401, 'Invalid or revoked API key');
      }

      // Verify hash even on cache hit (the cache stores hash, we verify full key)
      const valid = await this.keyService.verifyKey(fullKey, cached.keyHash);
      if (!valid) {
        throw new ApiKeyAuthError(401, 'Invalid or revoked API key');
      }

      // Update last_used_at non-blocking
      this.keyService.updateLastUsed(cached.keyId);

      return {
        orgId: cached.orgId,
        keyId: cached.keyId,
        scopes: cached.scopes,
        rateLimitOverride: cached.rateLimitOverride,
        environment: cached.environment,
      };
    }

    // 4. Cache miss → DB lookup
    const keyRecord = await this.keyService.findByPrefix(prefix);
    if (!keyRecord) {
      throw new ApiKeyAuthError(401, 'Invalid or revoked API key');
    }

    // 5. Check revocation
    if (keyRecord.revoked_at) {
      // Cache the revoked state
      this.cache.set(prefix, {
        orgId: keyRecord.org_id,
        keyId: keyRecord.id,
        keyHash: keyRecord.key_hash,
        scopes: keyRecord.scopes,
        rateLimitOverride: keyRecord.rate_limit_override,
        environment: keyRecord.environment,
        revoked: true,
        cachedAt: Date.now(),
      });
      throw new ApiKeyAuthError(401, 'Invalid or revoked API key');
    }

    // 6. Verify hash
    const valid = await this.keyService.verifyKey(fullKey, keyRecord.key_hash);
    if (!valid) {
      throw new ApiKeyAuthError(401, 'Invalid or revoked API key');
    }

    // 7. Cache the result
    this.cache.set(prefix, {
      orgId: keyRecord.org_id,
      keyId: keyRecord.id,
      keyHash: keyRecord.key_hash,
      scopes: keyRecord.scopes,
      rateLimitOverride: keyRecord.rate_limit_override,
      environment: keyRecord.environment,
      revoked: false,
      cachedAt: Date.now(),
    });

    // 8. Update last_used_at non-blocking
    this.keyService.updateLastUsed(keyRecord.id);

    return {
      orgId: keyRecord.org_id,
      keyId: keyRecord.id,
      scopes: keyRecord.scopes,
      rateLimitOverride: keyRecord.rate_limit_override,
      environment: keyRecord.environment,
    };
  }

  /**
   * Invalidate cache for a key prefix (called on revocation).
   */
  invalidateCache(prefix: string): void {
    this.cache.delete(prefix);
  }
}

export class ApiKeyAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiKeyAuthError';
  }
}

/**
 * Embedding Store — storage and retrieval of vector embeddings (Story 2.2)
 *
 * Handles CRUD operations for embeddings including:
 * - Content-hash deduplication
 * - In-JS cosine similarity search (SQLite doesn't support vector ops)
 * - Tenant isolation
 */

import { createHash, randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import { embeddings } from './schema.sqlite.js';
import { cosineSimilarity } from '../lib/embeddings/math.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('EmbeddingStore');

/** Maximum candidates loaded into memory for similarity search */
const MAX_CANDIDATES = 10_000;

/** Compute SHA-256 content hash of text */
function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Serialize Float32Array to Buffer for SQLite BLOB storage */
function serializeEmbedding(embedding: Float32Array): Buffer {
  // Slice to copy — avoids view mutation if source buffer is reused
  return Buffer.from(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
}

/** Deserialize Buffer from SQLite BLOB to Float32Array */
function deserializeEmbedding(blob: Buffer): Float32Array {
  // Copy to fresh aligned buffer — Buffer from SQLite may have non-4-byte-aligned offset
  const copy = new Uint8Array(blob).buffer;
  return new Float32Array(copy);
}

/** Options for similarity search */
export interface SimilaritySearchOptions {
  /** Filter by source type ('event', 'session', 'lesson') */
  sourceType?: string;
  /** Filter by creation time — from (ISO 8601) */
  from?: string;
  /** Filter by creation time — to (ISO 8601) */
  to?: string;
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Minimum similarity score to include (default: 0.0) */
  minScore?: number;
}

/** A single similarity search result */
export interface SimilarityResult {
  id: string;
  sourceType: string;
  sourceId: string;
  score: number;
  text: string;
  embeddingModel: string;
  createdAt: string;
}

/** Stored embedding record (without the raw vector) */
export interface StoredEmbedding {
  id: string;
  tenantId: string;
  sourceType: string;
  sourceId: string;
  contentHash: string;
  textContent: string;
  embedding: Float32Array;
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
}

export class EmbeddingStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Store an embedding with source-level deduplication.
   * If an embedding with the same (tenant, source_type, source_id) already exists,
   * it's updated rather than duplicated. Different sources with the same content
   * are stored as separate rows to preserve source metadata.
   */
  store(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    textContent: string,
    embedding: Float32Array,
    model: string,
    dimensions: number,
  ): string {
    const hash = contentHash(textContent);
    const now = new Date().toISOString();

    // Check for existing embedding from the same source
    const existing = this.db
      .select({ id: embeddings.id })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      )
      .get();

    if (existing) {
      // Update existing — content may have changed
      this.db
        .update(embeddings)
        .set({
          contentHash: hash,
          textContent,
          embedding: serializeEmbedding(embedding),
          embeddingModel: model,
          dimensions,
        })
        .where(eq(embeddings.id, existing.id))
        .run();
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .insert(embeddings)
      .values({
        id,
        tenantId,
        sourceType,
        sourceId,
        contentHash: hash,
        textContent,
        embedding: serializeEmbedding(embedding),
        embeddingModel: model,
        dimensions,
        createdAt: now,
      })
      .run();

    return id;
  }

  /**
   * Get embeddings for a specific source.
   */
  getBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): StoredEmbedding | null {
    const row = this.db
      .select()
      .from(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      )
      .get();

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      contentHash: row.contentHash,
      textContent: row.textContent,
      embedding: deserializeEmbedding(row.embedding),
      embeddingModel: row.embeddingModel,
      dimensions: row.dimensions,
      createdAt: row.createdAt,
    };
  }

  /**
   * Similarity search: load candidate embeddings filtered by tenant/sourceType/time,
   * compute cosine similarity in JS, sort by score, filter by minScore, return top N.
   */
  similaritySearch(
    tenantId: string,
    queryVector: Float32Array,
    opts: SimilaritySearchOptions = {},
  ): SimilarityResult[] {
    const { sourceType, from, to, limit = 10, minScore = 0.0 } = opts;

    // Build all conditions upfront
    const conditions = [eq(embeddings.tenantId, tenantId)];
    if (sourceType) {
      conditions.push(eq(embeddings.sourceType, sourceType));
    }
    if (from) {
      conditions.push(sql`${embeddings.createdAt} >= ${from}`);
    }
    if (to) {
      conditions.push(sql`${embeddings.createdAt} <= ${to}`);
    }

    const rows = this.db
      .select()
      .from(embeddings)
      .where(and(...conditions))
      .limit(MAX_CANDIDATES)
      .all();

    if (rows.length >= MAX_CANDIDATES) {
      log.warn(
        `similaritySearch hit MAX_CANDIDATES limit (${MAX_CANDIDATES}) ` +
        `for tenant=${tenantId}. Results may be incomplete.`,
      );
    }

    // Compute cosine similarity for each candidate
    const results: SimilarityResult[] = [];
    for (const row of rows) {
      const embVector = deserializeEmbedding(row.embedding);
      const score = cosineSimilarity(queryVector, embVector);
      if (score >= minScore) {
        results.push({
          id: row.id,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          score,
          text: row.textContent,
          embeddingModel: row.embeddingModel,
          createdAt: row.createdAt,
        });
      }
    }

    // Sort by score descending and take top N
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Delete embedding(s) for a specific source.
   */
  delete(tenantId: string, sourceType: string, sourceId: string): number {
    const result = this.db
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      )
      .run();

    return result.changes;
  }

  /**
   * Count embeddings for a tenant.
   */
  count(tenantId: string): number {
    const result = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(embeddings)
      .where(eq(embeddings.tenantId, tenantId))
      .get();

    return result?.count ?? 0;
  }
}

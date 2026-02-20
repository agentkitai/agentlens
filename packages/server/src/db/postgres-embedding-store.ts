/**
 * PostgreSQL Embedding Store — uses pgvector for native similarity search.
 *
 * Falls back to bytea + in-memory cosine similarity if pgvector is not available.
 */

import { createHash, randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresDb } from './connection.postgres.js';
import { embeddings } from './schema.postgres.js';
import { cosineSimilarity } from '../lib/embeddings/math.js';
import { createLogger } from '../lib/logger.js';
import type { IEmbeddingStore } from './embedding-store.interface.js';
import type { SimilaritySearchOptions, SimilarityResult, StoredEmbedding } from './embedding-store.js';

const log = createLogger('PostgresEmbeddingStore');

/** Maximum candidates for fallback in-memory search */
const MAX_CANDIDATES = 10_000;

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
}

function deserializeEmbedding(blob: Buffer): Float32Array {
  const copy = new Uint8Array(blob).buffer;
  return new Float32Array(copy);
}

export class PostgresEmbeddingStore implements IEmbeddingStore {
  private pgvectorAvailable = false;

  constructor(private readonly db: PostgresDb) {}

  /** Check if pgvector column exists at startup. */
  async initialize(): Promise<void> {
    try {
      const result = await this.db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'embeddings' AND column_name = 'embedding_vector'
      `);
      this.pgvectorAvailable = [...result].length > 0;
      if (this.pgvectorAvailable) {
        log.info('pgvector: available (embedding_vector column found)');
      } else {
        log.warn('pgvector: NOT available — falling back to bytea + in-memory cosine similarity');
      }
    } catch (err) {
      log.warn(`pgvector detection failed: ${err instanceof Error ? err.message : err}`);
      this.pgvectorAvailable = false;
    }
  }

  async store(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    textContent: string,
    embedding: Float32Array,
    model: string,
    dimensions: number,
  ): Promise<string> {
    const hash = contentHash(textContent);
    const now = new Date().toISOString();
    const embBuf = serializeEmbedding(embedding);

    const existing = await this.db
      .select({ id: embeddings.id })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const id = existing[0]!.id;
      if (this.pgvectorAvailable) {
        const vectorStr = `[${Array.from(embedding).join(',')}]`;
        await this.db.execute(sql`
          UPDATE embeddings SET
            content_hash = ${hash},
            text_content = ${textContent},
            embedding = ${embBuf},
            embedding_vector = ${vectorStr}::vector,
            embedding_model = ${model},
            dimensions = ${dimensions}
          WHERE id = ${id}
        `);
      } else {
        await this.db
          .update(embeddings)
          .set({
            contentHash: hash,
            textContent,
            embedding: embBuf,
            embeddingModel: model,
            dimensions,
          })
          .where(eq(embeddings.id, id));
      }
      return id;
    }

    const id = randomUUID();
    if (this.pgvectorAvailable) {
      const vectorStr = `[${Array.from(embedding).join(',')}]`;
      await this.db.execute(sql`
        INSERT INTO embeddings (id, tenant_id, source_type, source_id, content_hash,
          text_content, embedding, embedding_vector, embedding_model, dimensions, created_at)
        VALUES (${id}, ${tenantId}, ${sourceType}, ${sourceId}, ${hash},
          ${textContent}, ${embBuf}, ${vectorStr}::vector,
          ${model}, ${dimensions}, ${now})
      `);
    } else {
      await this.db.insert(embeddings).values({
        id,
        tenantId,
        sourceType,
        sourceId,
        contentHash: hash,
        textContent,
        embedding: embBuf,
        embeddingModel: model,
        dimensions,
        createdAt: now,
      });
    }

    return id;
  }

  async getBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<StoredEmbedding | null> {
    const [row] = await this.db
      .select()
      .from(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      )
      .limit(1);

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

  async similaritySearch(
    tenantId: string,
    queryVector: Float32Array,
    opts: SimilaritySearchOptions = {},
  ): Promise<SimilarityResult[]> {
    const { sourceType, from, to, limit = 10, minScore = 0.0 } = opts;

    if (this.pgvectorAvailable) {
      return this.pgvectorSearch(tenantId, queryVector, { sourceType, from, to, limit, minScore });
    }
    return this.fallbackSearch(tenantId, queryVector, { sourceType, from, to, limit, minScore });
  }

  private async pgvectorSearch(
    tenantId: string,
    queryVector: Float32Array,
    opts: { sourceType?: string; from?: string; to?: string; limit: number; minScore: number },
  ): Promise<SimilarityResult[]> {
    const vectorStr = `[${Array.from(queryVector).join(',')}]`;

    const rows = await this.db.execute(sql`
      SELECT
        id, source_type, source_id, text_content, embedding_model, created_at,
        1 - (embedding_vector <=> ${vectorStr}::vector) as score
      FROM embeddings
      WHERE tenant_id = ${tenantId}
        AND embedding_vector IS NOT NULL
        ${opts.sourceType ? sql`AND source_type = ${opts.sourceType}` : sql``}
        ${opts.from ? sql`AND created_at >= ${opts.from}` : sql``}
        ${opts.to ? sql`AND created_at <= ${opts.to}` : sql``}
        AND 1 - (embedding_vector <=> ${vectorStr}::vector) >= ${opts.minScore}
      ORDER BY embedding_vector <=> ${vectorStr}::vector ASC
      LIMIT ${opts.limit}
    `);

    return [...rows].map(r => ({
      id: r.id as string,
      sourceType: r.source_type as string,
      sourceId: r.source_id as string,
      score: Number(r.score),
      text: r.text_content as string,
      embeddingModel: r.embedding_model as string,
      createdAt: r.created_at as string,
    }));
  }

  private async fallbackSearch(
    tenantId: string,
    queryVector: Float32Array,
    opts: { sourceType?: string; from?: string; to?: string; limit: number; minScore: number },
  ): Promise<SimilarityResult[]> {
    const conditions = [eq(embeddings.tenantId, tenantId)];
    if (opts.sourceType) conditions.push(eq(embeddings.sourceType, opts.sourceType));
    if (opts.from) conditions.push(sql`${embeddings.createdAt} >= ${opts.from}`);
    if (opts.to) conditions.push(sql`${embeddings.createdAt} <= ${opts.to}`);

    const rows = await this.db
      .select()
      .from(embeddings)
      .where(and(...conditions))
      .limit(MAX_CANDIDATES);

    if (rows.length >= MAX_CANDIDATES) {
      log.warn(`similaritySearch hit MAX_CANDIDATES limit (${MAX_CANDIDATES}) for tenant=${tenantId}`);
    }

    const results: SimilarityResult[] = [];
    for (const row of rows) {
      const embVector = deserializeEmbedding(row.embedding);
      const score = cosineSimilarity(queryVector, embVector);
      if (score >= opts.minScore) {
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

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, opts.limit);
  }

  async delete(tenantId: string, sourceType: string, sourceId: string): Promise<number> {
    const result = await this.db
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.tenantId, tenantId),
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId),
        ),
      );

    return (result as any).rowCount ?? 0;
  }

  async count(tenantId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(embeddings)
      .where(eq(embeddings.tenantId, tenantId));

    return Number(result?.count ?? 0);
  }
}

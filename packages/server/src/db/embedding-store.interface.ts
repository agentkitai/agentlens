/**
 * IEmbeddingStore — shared interface for SQLite and PostgreSQL embedding stores.
 *
 * All methods return Promise-compatible values (sync returns are valid Promises).
 */

import type { SimilaritySearchOptions, SimilarityResult, StoredEmbedding } from './embedding-store.js';

export interface IEmbeddingStore {
  /** Store an embedding with source-level deduplication. Returns the embedding ID. */
  store(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    textContent: string,
    embedding: Float32Array,
    model: string,
    dimensions: number,
  ): string | Promise<string>;

  /** Get an embedding by source identifiers. */
  getBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): StoredEmbedding | null | Promise<StoredEmbedding | null>;

  /** Similarity search over embeddings. */
  similaritySearch(
    tenantId: string,
    queryVector: Float32Array,
    opts?: SimilaritySearchOptions,
  ): SimilarityResult[] | Promise<SimilarityResult[]>;

  /** Delete embedding(s) for a specific source. Returns count of deleted rows. */
  delete(tenantId: string, sourceType: string, sourceId: string): number | Promise<number>;

  /** Count embeddings for a tenant. */
  count(tenantId: string): number | Promise<number>;
}

/**
 * Embedding service types (Story 2.1)
 */

/** A typed embedding vector */
export type EmbeddingVector = Float32Array;

/** Supported embedding backends */
export type EmbeddingBackend = 'local' | 'openai';

/** Configuration for the embedding service */
export interface EmbeddingServiceConfig {
  /** Backend to use: 'local' (Xenova/transformers.js) or 'openai' */
  backend: EmbeddingBackend;
  /** Model name override (default depends on backend) */
  modelName?: string;
  /** OpenAI API key (required for 'openai' backend) */
  openaiApiKey?: string;
}

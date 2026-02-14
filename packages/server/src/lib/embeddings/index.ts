/**
 * Embedding Service — interface and factory (Story 2.1)
 *
 * Local embeddings removed (delegated to Lore). Only OpenAI backend remains.
 */

import type { EmbeddingServiceConfig } from './types.js';
import { createOpenAIEmbeddingService } from './openai.js';

export type { EmbeddingVector, EmbeddingBackend, EmbeddingServiceConfig } from './types.js';
export { cosineSimilarity } from './math.js';

/**
 * Embedding service interface — embed text into vector space.
 */
export interface EmbeddingService {
  /** Embed a single text string */
  embed(text: string): Promise<Float32Array>;

  /** Embed a batch of texts */
  embedBatch(texts: string[]): Promise<Float32Array[]>;

  /** Dimensionality of the output vectors */
  readonly dimensions: number;

  /** Name of the model used */
  readonly modelName: string;
}

/**
 * Create an embedding service from config or environment variables.
 *
 * Note: Local ONNX embeddings have been removed. Use Lore for semantic search,
 * or set AGENTLENS_EMBEDDING_BACKEND=openai with an OPENAI_API_KEY.
 *
 * Environment variables:
 * - AGENTLENS_EMBEDDING_BACKEND: 'openai' (default: 'openai')
 * - AGENTLENS_EMBEDDING_MODEL: model name override
 * - OPENAI_API_KEY: required
 */
export function createEmbeddingService(config?: Partial<EmbeddingServiceConfig>): EmbeddingService {
  const modelName = config?.modelName ?? process.env['AGENTLENS_EMBEDDING_MODEL'];
  return createOpenAIEmbeddingService(config?.openaiApiKey, modelName);
}

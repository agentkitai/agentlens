/**
 * Embedding Service — interface and factory (Story 2.1)
 *
 * Supports local (Xenova/transformers.js ONNX) and OpenAI backends.
 */

import type { EmbeddingServiceConfig } from './types.js';
import { createLocalEmbeddingService } from './local.js';
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
 * Environment variables:
 * - AGENTLENS_EMBEDDING_BACKEND: 'local' | 'openai' (default: 'local')
 * - AGENTLENS_EMBEDDING_MODEL: model name override
 * - OPENAI_API_KEY: required for 'openai' backend
 */
export function createEmbeddingService(config?: Partial<EmbeddingServiceConfig>): EmbeddingService {
  const backend =
    config?.backend ??
    (process.env['AGENTLENS_EMBEDDING_BACKEND'] as 'local' | 'openai' | undefined) ??
    'local';

  const modelName = config?.modelName ?? process.env['AGENTLENS_EMBEDDING_MODEL'];

  switch (backend) {
    case 'local':
      return createLocalEmbeddingService(modelName);
    case 'openai':
      return createOpenAIEmbeddingService(config?.openaiApiKey, modelName);
    default:
      throw new Error(`Unknown embedding backend: ${backend as string}. Use 'local' or 'openai'.`);
  }
}

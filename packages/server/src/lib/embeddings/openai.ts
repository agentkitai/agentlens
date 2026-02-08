/**
 * OpenAI embedding service (Story 2.1)
 *
 * Uses text-embedding-3-small (1536 dimensions) by default.
 * Simple fetch-based client — no SDK dependency.
 */

import type { EmbeddingService } from './index.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Create an OpenAI embedding service.
 *
 * @param apiKey - OpenAI API key (falls back to OPENAI_API_KEY env var)
 * @param modelName - Model to use (default: text-embedding-3-small)
 */
export function createOpenAIEmbeddingService(
  apiKey?: string,
  modelName?: string,
): EmbeddingService {
  const key = apiKey ?? process.env['OPENAI_API_KEY'];
  const model = modelName ?? DEFAULT_MODEL;

  if (!key) {
    throw new Error(
      'OpenAI embedding backend requires an API key. ' +
        'Set OPENAI_API_KEY environment variable or pass apiKey to config.',
    );
  }

  async function callOpenAI(input: string | string[]): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        model,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI embeddings API error (${response.status}): ${errorBody}`);
    }

    const json = (await response.json()) as OpenAIEmbeddingResponse;
    // Sort by index to ensure order matches input
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  return {
    dimensions: DEFAULT_DIMENSIONS,
    modelName: model,

    async embed(text: string): Promise<Float32Array> {
      const [embedding] = await callOpenAI(text);
      return new Float32Array(embedding!);
    },

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const embeddings = await callOpenAI(texts);
      return embeddings.map((e) => new Float32Array(e));
    },
  };
}

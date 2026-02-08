/**
 * Local embedding service using @xenova/transformers (ONNX) (Story 2.1)
 *
 * Uses all-MiniLM-L6-v2 model (384 dimensions) by default.
 * Model is loaded once and cached for subsequent calls.
 */

import type { EmbeddingService } from './index.js';

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMENSIONS = 384;

/**
 * Create a local embedding service backed by @xenova/transformers.
 *
 * The @xenova/transformers package is dynamically imported, so it's
 * not a hard dependency. If not installed, a clear error is thrown.
 */
export function createLocalEmbeddingService(modelName?: string): EmbeddingService {
  const model = modelName ?? DEFAULT_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pipelinePromise: Promise<any> | null = null;

  async function getPipeline() {
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        try {
          // Dynamic import — @xenova/transformers may not be installed
          // Use a variable to prevent TypeScript/bundlers from resolving at compile time
          const moduleName = '@xenova/transformers';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // @ts-expect-error — dynamic module specifier to avoid compile-time resolution
          const mod: any = await import(moduleName);
          const { pipeline } = mod;
          return await pipeline('feature-extraction', model);
        } catch (err: unknown) {
          pipelinePromise = null; // Reset so user can retry after install
          if (
            err instanceof Error &&
            (err.message.includes('Cannot find module') ||
              err.message.includes('Cannot find package') ||
              err.message.includes('ERR_MODULE_NOT_FOUND'))
          ) {
            throw new Error(
              'Local embedding backend requires @xenova/transformers. ' +
                'Install it with: pnpm add @xenova/transformers',
            );
          }
          throw err;
        }
      })();
    }
    return pipelinePromise;
  }

  return {
    dimensions: DEFAULT_DIMENSIONS,
    modelName: model,

    async embed(text: string): Promise<Float32Array> {
      const pipe = await getPipeline();
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return new Float32Array(output.data);
    },

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      const pipe = await getPipeline();
      const results: Float32Array[] = [];
      for (const text of texts) {
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        results.push(new Float32Array(output.data));
      }
      return results;
    },
  };
}

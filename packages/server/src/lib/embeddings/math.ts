/**
 * Vector math utilities for embeddings (Story 2.1)
 */

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value between -1 and 1, where 1 means identical direction,
 * 0 means orthogonal, and -1 means opposite direction.
 *
 * @throws Error if vectors have different lengths or are zero-length
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) {
    throw new Error('Cannot compute cosine similarity of zero-length vectors');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0; // zero vector(s)
  }

  return dotProduct / denominator;
}

/**
 * Tests for embedding service factory (Story 2.1)
 *
 * Note: Local ONNX embeddings removed — Lore handles semantic search.
 * Only OpenAI backend remains.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createEmbeddingService } from '../index.js';

describe('createEmbeddingService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('OpenAI service', () => {
    it('defaults to OpenAI backend', () => {
      const service = createEmbeddingService({ openaiApiKey: 'sk-test' });
      expect(service.modelName).toBe('text-embedding-3-small');
      expect(service.dimensions).toBe(1536);
    });

    it('throws when no API key is provided', () => {
      delete process.env['OPENAI_API_KEY'];
      expect(() => createEmbeddingService()).toThrow('requires an API key');
    });

    it('uses custom model name from config', () => {
      const service = createEmbeddingService({
        openaiApiKey: 'sk-test',
        modelName: 'text-embedding-3-large',
      });
      expect(service.modelName).toBe('text-embedding-3-large');
    });

    it('respects AGENTLENS_EMBEDDING_MODEL env var', () => {
      process.env['AGENTLENS_EMBEDDING_MODEL'] = 'text-embedding-3-large';
      const service = createEmbeddingService({ openaiApiKey: 'sk-test' });
      expect(service.modelName).toBe('text-embedding-3-large');
    });

    it('respects OPENAI_API_KEY env var', () => {
      process.env['OPENAI_API_KEY'] = 'sk-env-key';
      const service = createEmbeddingService();
      expect(service.dimensions).toBe(1536);
    });
  });
});

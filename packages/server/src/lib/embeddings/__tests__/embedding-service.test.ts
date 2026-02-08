/**
 * Tests for embedding service factory (Story 2.1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmbeddingService } from '../index.js';

describe('createEmbeddingService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('factory routing', () => {
    it('defaults to local backend', () => {
      delete process.env['AGENTLENS_EMBEDDING_BACKEND'];
      const service = createEmbeddingService();
      expect(service.modelName).toBe('Xenova/all-MiniLM-L6-v2');
      expect(service.dimensions).toBe(384);
    });

    it('respects AGENTLENS_EMBEDDING_BACKEND=local env var', () => {
      process.env['AGENTLENS_EMBEDDING_BACKEND'] = 'local';
      const service = createEmbeddingService();
      expect(service.dimensions).toBe(384);
    });

    it('creates OpenAI service when backend=openai', () => {
      const service = createEmbeddingService({
        backend: 'openai',
        openaiApiKey: 'sk-test-key',
      });
      expect(service.modelName).toBe('text-embedding-3-small');
      expect(service.dimensions).toBe(1536);
    });

    it('respects AGENTLENS_EMBEDDING_BACKEND=openai env var', () => {
      process.env['AGENTLENS_EMBEDDING_BACKEND'] = 'openai';
      process.env['OPENAI_API_KEY'] = 'sk-test-key';
      const service = createEmbeddingService();
      expect(service.dimensions).toBe(1536);
    });

    it('config backend overrides env var', () => {
      process.env['AGENTLENS_EMBEDDING_BACKEND'] = 'openai';
      process.env['OPENAI_API_KEY'] = 'sk-test';
      const service = createEmbeddingService({ backend: 'local' });
      expect(service.dimensions).toBe(384);
    });

    it('throws for unknown backend', () => {
      expect(() =>
        createEmbeddingService({ backend: 'unknown' as 'local' }),
      ).toThrow('Unknown embedding backend');
    });
  });

  describe('OpenAI service', () => {
    it('throws when no API key is provided', () => {
      delete process.env['OPENAI_API_KEY'];
      expect(() =>
        createEmbeddingService({ backend: 'openai' }),
      ).toThrow('requires an API key');
    });

    it('uses custom model name', () => {
      const service = createEmbeddingService({
        backend: 'openai',
        openaiApiKey: 'sk-test',
        modelName: 'text-embedding-3-large',
      });
      expect(service.modelName).toBe('text-embedding-3-large');
    });
  });

  describe('local service', () => {
    it('uses custom model name', () => {
      const service = createEmbeddingService({
        backend: 'local',
        modelName: 'custom-model',
      });
      expect(service.modelName).toBe('custom-model');
    });

    it('embed() throws clear error when @xenova/transformers is not installed', async () => {
      const service = createEmbeddingService({ backend: 'local' });
      // The dynamic import will fail since @xenova/transformers isn't installed
      await expect(service.embed('test')).rejects.toThrow();
    });

    it('embedBatch() throws clear error when @xenova/transformers is not installed', async () => {
      const service = createEmbeddingService({ backend: 'local' });
      await expect(service.embedBatch(['test'])).rejects.toThrow();
    });
  });

  describe('model name from env', () => {
    it('respects AGENTLENS_EMBEDDING_MODEL env var for local backend', () => {
      process.env['AGENTLENS_EMBEDDING_MODEL'] = 'my-custom-model';
      const service = createEmbeddingService({ backend: 'local' });
      expect(service.modelName).toBe('my-custom-model');
    });

    it('respects AGENTLENS_EMBEDDING_MODEL env var for openai backend', () => {
      process.env['AGENTLENS_EMBEDDING_MODEL'] = 'text-embedding-3-large';
      const service = createEmbeddingService({
        backend: 'openai',
        openaiApiKey: 'sk-test',
      });
      expect(service.modelName).toBe('text-embedding-3-large');
    });
  });
});

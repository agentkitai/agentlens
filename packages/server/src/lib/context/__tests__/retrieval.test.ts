/**
 * Tests for ContextRetriever (Story 5.2)
 *
 * Tests context retrieval with mocked stores, including
 * semantic search path and text-search fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextRetriever } from '../retrieval.js';
import type { EmbeddingStore, SimilarityResult } from '../../../db/embedding-store.js';
import type { EmbeddingService } from '../../embeddings/index.js';
import type { SessionSummaryStore, SessionSummaryRecord } from '../../../db/session-summary-store.js';
import type { IEventStore } from '@agentlensai/core';
import type { Lesson } from '@agentlensai/core';

// ─── Mock factories ────────────────────────────────────────

function createMockEmbeddingService(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
    embedBatch: vi.fn().mockResolvedValue([]),
    dimensions: 3,
    modelName: 'test-model',
  };
}

function createMockEmbeddingStore(sessionResults: SimilarityResult[] = [], lessonResults: SimilarityResult[] = []): EmbeddingStore {
  return {
    similaritySearch: vi.fn((tenantId: string, queryVector: Float32Array, opts: { sourceType?: string }) => {
      if (opts?.sourceType === 'session') return sessionResults;
      if (opts?.sourceType === 'lesson') return lessonResults;
      return [...sessionResults, ...lessonResults];
    }),
    store: vi.fn().mockReturnValue('emb-1'),
    getBySource: vi.fn().mockReturnValue(null),
    delete: vi.fn().mockReturnValue(0),
    count: vi.fn().mockReturnValue(0),
  } as unknown as EmbeddingStore;
}

function createMockSessionSummaryStore(summaries: Map<string, SessionSummaryRecord> = new Map()): SessionSummaryStore {
  return {
    get: vi.fn((tenantId: string, sessionId: string) => summaries.get(sessionId) ?? null),
    getByTenant: vi.fn(() => Array.from(summaries.values())),
    search: vi.fn((tenantId: string, query: string) => {
      return Array.from(summaries.values()).filter(
        (s) => s.summary.includes(query) || s.topics.some((t: string) => t.includes(query)),
      );
    }),
    save: vi.fn(),
  } as unknown as SessionSummaryStore;
}

function createMockLessonStore(lessons: Lesson[] = []) {
  return {
    get: vi.fn((tenantId: string, id: string) => lessons.find((l) => l.id === id) ?? null),
    list: vi.fn((_tenantId: string, query?: { search?: string }) => {
      if (query?.search) {
        const q = query.search.toLowerCase();
        return lessons.filter(
          (l) => l.title.toLowerCase().includes(q) || l.content.toLowerCase().includes(q),
        );
      }
      return lessons;
    }),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    count: vi.fn().mockReturnValue(0),
  };
}

function createMockEventStore(sessions: Map<string, { id: string; agentId: string; startedAt: string; endedAt?: string }> = new Map()): IEventStore {
  return {
    getSession: vi.fn(async (id: string) => {
      const s = sessions.get(id);
      if (!s) return null;
      return {
        ...s,
        agentName: s.agentId,
        status: 'completed' as const,
        eventCount: 10,
        toolCallCount: 3,
        errorCount: 0,
        totalCostUsd: 0.01,
        llmCallCount: 2,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        tags: [],
        tenantId: 'tenant-a',
      };
    }),
    getSessionTimeline: vi.fn(async () => []),
    insertEvents: vi.fn(),
    queryEvents: vi.fn(),
    getEvent: vi.fn(),
    getLastEventHash: vi.fn(),
    countEvents: vi.fn(),
    upsertSession: vi.fn(),
    querySessions: vi.fn(),
    upsertAgent: vi.fn(),
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    getAnalytics: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    deleteAlertRule: vi.fn(),
    listAlertRules: vi.fn(),
    getAlertRule: vi.fn(),
    insertAlertHistory: vi.fn(),
    listAlertHistory: vi.fn(),
    applyRetention: vi.fn(),
    getStats: vi.fn(),
  } as unknown as IEventStore;
}

describe('ContextRetriever', () => {
  describe('with semantic search (embeddings available)', () => {
    it('returns sessions and lessons from semantic search', async () => {
      const sessionSummaries = new Map<string, SessionSummaryRecord>([
        ['ses-1', {
          sessionId: 'ses-1',
          tenantId: 'tenant-a',
          summary: 'Agent deployed to production',
          topics: ['deploy', 'production'],
          toolSequence: ['build', 'deploy'],
          errorSummary: null,
          outcome: 'success',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      ]);

      const lessons: Lesson[] = [{
        id: 'les-1',
        tenantId: 'tenant-a',
        title: 'Always verify deploy',
        content: 'Check health endpoint after deploying',
        category: 'operations',
        importance: 'high',
        accessCount: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        context: {},
      }];

      const sessionResults: SimilarityResult[] = [{
        id: 'emb-1',
        sourceType: 'session',
        sourceId: 'ses-1',
        score: 0.85,
        text: 'Agent deployed to production',
        embeddingModel: 'test-model',
        createdAt: new Date().toISOString(),
      }];

      const lessonResults: SimilarityResult[] = [{
        id: 'emb-2',
        sourceType: 'lesson',
        sourceId: 'les-1',
        score: 0.78,
        text: 'Always verify deploy',
        embeddingModel: 'test-model',
        createdAt: new Date().toISOString(),
      }];

      const sessions = new Map([
        ['ses-1', { id: 'ses-1', agentId: 'agent-1', startedAt: '2024-01-01T00:00:00Z', endedAt: '2024-01-01T01:00:00Z' }],
      ]);

      const retriever = new ContextRetriever(
        createMockEmbeddingStore(sessionResults, lessonResults),
        createMockEmbeddingService(),
        createMockSessionSummaryStore(sessionSummaries),
        createMockLessonStore(lessons),
        createMockEventStore(sessions),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'deployment' });

      expect(result.topic).toBe('deployment');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses-1');
      expect(result.sessions[0].summary).toContain('deployed');
      expect(result.sessions[0].relevanceScore).toBeGreaterThan(0);
      expect(result.sessions[0].startedAt).toBe('2024-01-01T00:00:00Z');

      expect(result.lessons).toHaveLength(1);
      expect(result.lessons[0].id).toBe('les-1');
      expect(result.lessons[0].title).toBe('Always verify deploy');
      expect(result.lessons[0].relevanceScore).toBeGreaterThan(0);
    });

    it('filters by agentId', async () => {
      const sessionResults: SimilarityResult[] = [
        {
          id: 'emb-1', sourceType: 'session', sourceId: 'ses-1',
          score: 0.9, text: 'Session 1', embeddingModel: 'test', createdAt: new Date().toISOString(),
        },
        {
          id: 'emb-2', sourceType: 'session', sourceId: 'ses-2',
          score: 0.8, text: 'Session 2', embeddingModel: 'test', createdAt: new Date().toISOString(),
        },
      ];

      const sessions = new Map([
        ['ses-1', { id: 'ses-1', agentId: 'agent-1', startedAt: '2024-01-01T00:00:00Z' }],
        ['ses-2', { id: 'ses-2', agentId: 'agent-2', startedAt: '2024-01-02T00:00:00Z' }],
      ]);

      const retriever = new ContextRetriever(
        createMockEmbeddingStore(sessionResults, []),
        createMockEmbeddingService(),
        createMockSessionSummaryStore(),
        createMockLessonStore(),
        createMockEventStore(sessions),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'test', agentId: 'agent-1' });
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses-1');
    });

    it('respects limit parameter', async () => {
      const sessionResults: SimilarityResult[] = [];
      const sessions = new Map<string, { id: string; agentId: string; startedAt: string }>();
      for (let i = 0; i < 10; i++) {
        sessionResults.push({
          id: `emb-${i}`, sourceType: 'session', sourceId: `ses-${i}`,
          score: 0.9 - i * 0.05, text: `Session ${i}`, embeddingModel: 'test',
          createdAt: new Date().toISOString(),
        });
        sessions.set(`ses-${i}`, { id: `ses-${i}`, agentId: 'agent-1', startedAt: '2024-01-01T00:00:00Z' });
      }

      const retriever = new ContextRetriever(
        createMockEmbeddingStore(sessionResults, []),
        createMockEmbeddingService(),
        createMockSessionSummaryStore(),
        createMockLessonStore(),
        createMockEventStore(sessions),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'test', limit: 3 });
      expect(result.sessions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('with text search fallback (no embeddings)', () => {
    it('falls back to text search when no embedding service', async () => {
      const summaries = new Map<string, SessionSummaryRecord>([
        ['ses-1', {
          sessionId: 'ses-1', tenantId: 'tenant-a',
          summary: 'Agent fixed a database migration error',
          topics: ['database', 'migration'],
          toolSequence: ['dbMigrate'], errorSummary: null, outcome: 'success',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      ]);

      const lessons: Lesson[] = [{
        id: 'les-1', tenantId: 'tenant-a',
        title: 'Database migration tips',
        content: 'Always backup before migrating',
        category: 'database', importance: 'normal',
        accessCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        context: {},
      }];

      const retriever = new ContextRetriever(
        null, // no embedding store
        null, // no embedding service
        createMockSessionSummaryStore(summaries),
        createMockLessonStore(lessons),
        createMockEventStore(),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'database' });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('ses-1');
      expect(result.sessions[0].relevanceScore).toBeGreaterThan(0);

      expect(result.lessons).toHaveLength(1);
      expect(result.lessons[0].title).toContain('Database');
    });

    it('returns empty results when nothing matches', async () => {
      const retriever = new ContextRetriever(
        null,
        null,
        createMockSessionSummaryStore(),
        createMockLessonStore(),
        createMockEventStore(),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'nonexistent' });

      expect(result.sessions).toEqual([]);
      expect(result.lessons).toEqual([]);
      expect(result.totalSessions).toBe(0);
      expect(result.topic).toBe('nonexistent');
    });

    it('falls back to text search when embedding service throws', async () => {
      const summaries = new Map<string, SessionSummaryRecord>([
        ['ses-1', {
          sessionId: 'ses-1', tenantId: 'tenant-a',
          summary: 'Agent processed files',
          topics: ['files'],
          toolSequence: ['readFile'], errorSummary: null, outcome: 'success',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      ]);

      const failingEmbeddingService = {
        embed: vi.fn().mockRejectedValue(new Error('Service unavailable')),
        embedBatch: vi.fn().mockRejectedValue(new Error('Service unavailable')),
        dimensions: 3,
        modelName: 'test-model',
      };

      const retriever = new ContextRetriever(
        createMockEmbeddingStore(),
        failingEmbeddingService,
        createMockSessionSummaryStore(summaries),
        createMockLessonStore(),
        createMockEventStore(),
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'files' });
      expect(result.sessions).toHaveLength(1);
    });
  });

  describe('enrichSessionWithEvents', () => {
    it('includes key events from timeline', async () => {
      const summaries = new Map<string, SessionSummaryRecord>([
        ['ses-1', {
          sessionId: 'ses-1', tenantId: 'tenant-a',
          summary: 'Agent session',
          topics: [], toolSequence: [], errorSummary: null, outcome: 'success',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      ]);

      const sessions = new Map([
        ['ses-1', { id: 'ses-1', agentId: 'agent-1', startedAt: '2024-01-01T00:00:00Z', endedAt: '2024-01-01T01:00:00Z' }],
      ]);

      const mockEventStore = createMockEventStore(sessions);
      (mockEventStore.getSessionTimeline as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ev-1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1',
          agentId: 'agent-1', eventType: 'tool_call', severity: 'info',
          payload: { toolName: 'readFile', callId: 'c1', arguments: {} },
          metadata: {}, prevHash: null, hash: 'h1', tenantId: 'tenant-a',
        },
        {
          id: 'ev-2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1',
          agentId: 'agent-1', eventType: 'tool_error', severity: 'error',
          payload: { toolName: 'writeFile', callId: 'c2', error: 'Permission denied', durationMs: 100 },
          metadata: {}, prevHash: 'h1', hash: 'h2', tenantId: 'tenant-a',
        },
      ]);

      const sessionResults: SimilarityResult[] = [{
        id: 'emb-1', sourceType: 'session', sourceId: 'ses-1',
        score: 0.9, text: 'Agent session', embeddingModel: 'test',
        createdAt: new Date().toISOString(),
      }];

      const retriever = new ContextRetriever(
        createMockEmbeddingStore(sessionResults, []),
        createMockEmbeddingService(),
        createMockSessionSummaryStore(summaries),
        createMockLessonStore(),
        mockEventStore,
      );

      const result = await retriever.retrieve('tenant-a', { topic: 'test' });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].keyEvents.length).toBeGreaterThan(0);
      // Should include both tool_call and tool_error
      const eventTypes = result.sessions[0].keyEvents.map((e) => e.eventType);
      expect(eventTypes).toContain('tool_call');
      expect(eventTypes).toContain('tool_error');
    });
  });
});

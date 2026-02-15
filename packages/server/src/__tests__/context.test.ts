/**
 * Tests for GET /api/context endpoint (Story 5.4)
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { EmbeddingService } from '../lib/embeddings/index.js';

function createMockEmbeddingService(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
    embedBatch: vi.fn().mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])]),
    dimensions: 3,
    modelName: 'test-model',
  };
}

describe('GET /api/context (Story 5.4)', () => {
  it('returns 400 when topic parameter is missing', async () => {
    const { app, apiKey } = await createTestApp();
    const res = await app.request('/api/context', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required query parameter: topic');
  });

  it('returns 200 with empty results when no data exists', async () => {
    const { app, apiKey } = await createTestApp();
    const res = await app.request('/api/context?topic=deployment', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: unknown[]; lessons: unknown[]; topic: string; totalSessions: number };
    expect(body.topic).toBe('deployment');
    expect(body.sessions).toEqual([]);
    expect(body.lessons).toEqual([]);
    expect(body.totalSessions).toBe(0);
  });

  it('returns context with session summaries when data exists', async () => {
    const { db, app, apiKey } = await createTestApp();
    const { SessionSummaryStore } = await import('../db/session-summary-store.js');
    const summaryStore = new SessionSummaryStore(db);

    // Create a session summary
    summaryStore.save(
      'default',
      'ses-test-1',
      'Agent deployed to production using CI/CD pipeline',
      ['deploy', 'production', 'CI/CD'],
      ['build', 'test', 'deploy'],
      null,
      'success',
    );

    const res = await app.request('/api/context?topic=deploy', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ sessionId: string; summary: string }>; topic: string; totalSessions: number };
    expect(body.topic).toBe('deploy');
    // Text search fallback should find the summary
    expect(body.totalSessions).toBeGreaterThanOrEqual(1);
    expect(body.sessions[0].summary).toContain('deploy');
  });

  it('returns empty lessons array (lessons moved to Lore service)', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/context?topic=Deployment', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { lessons: unknown[] };
    expect(body.lessons).toHaveLength(0);
  });

  it('respects limit parameter', async () => {
    const { db, app, apiKey } = await createTestApp();
    const { SessionSummaryStore } = await import('../db/session-summary-store.js');
    const summaryStore = new SessionSummaryStore(db);

    // Create multiple summaries
    for (let i = 0; i < 5; i++) {
      summaryStore.save(
        'default',
        `ses-${i}`,
        `Agent session ${i} with deployment tasks`,
        ['deploy'],
        [],
        null,
        'success',
      );
    }

    const res = await app.request('/api/context?topic=deploy&limit=2', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: unknown[]; totalSessions: number };
    expect(body.totalSessions).toBeLessThanOrEqual(2);
  });

  it('passes through agentId filter', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/context?topic=test&agentId=agent-1', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topic).toBe('test');
  });

  it('requires authentication', async () => {
    const { app } = await createTestApp({ authDisabled: false });
    const res = await app.request('/api/context?topic=test');
    expect(res.status).toBe(401);
  });

  it('returns results with correct structure', async () => {
    const { db, app, apiKey } = await createTestApp();
    const { SessionSummaryStore } = await import('../db/session-summary-store.js');
    const summaryStore = new SessionSummaryStore(db);

    summaryStore.save('default', 'ses-ctx-1', 'Agent handled errors gracefully', ['error_handling'], ['try_catch'], 'minor timeout', 'partial');

    const res = await app.request('/api/context?topic=error', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{
        sessionId: string;
        summary: string;
        relevanceScore: number;
        startedAt: string;
        keyEvents: unknown[];
      }>;
      lessons: Array<{
        id: string;
        title: string;
        content: string;
        category: string;
        relevanceScore: number;
      }>;
      topic: string;
      totalSessions: number;
    };

    expect(body.topic).toBe('error');
    expect(body).toHaveProperty('sessions');
    expect(body).toHaveProperty('lessons');
    expect(body).toHaveProperty('totalSessions');

    if (body.sessions.length > 0) {
      const s = body.sessions[0];
      expect(s).toHaveProperty('sessionId');
      expect(s).toHaveProperty('summary');
      expect(s).toHaveProperty('relevanceScore');
      expect(s).toHaveProperty('startedAt');
      expect(s).toHaveProperty('keyEvents');
    }

    if (body.lessons.length > 0) {
      const l = body.lessons[0];
      expect(l).toHaveProperty('id');
      expect(l).toHaveProperty('title');
      expect(l).toHaveProperty('content');
      expect(l).toHaveProperty('category');
      expect(l).toHaveProperty('relevanceScore');
    }
  });
});

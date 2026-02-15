/**
 * SDK Integration Tests (S11)
 *
 * Boot an in-memory AgentLens server on a random port and exercise the TS SDK
 * against it end-to-end over real HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestEnv, type TestEnv } from './helpers.js';
import { AuthenticationError } from '@agentlensai/sdk';

describe('SDK Integration Tests', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await setupTestEnv();
  });

  afterEach(() => {
    env.close();
  });

  // ─── Health ────────────────────────────────────────────

  describe('Health endpoint', () => {
    it('returns ok status', async () => {
      const health = await env.client.health();
      expect(health.status).toBe('ok');
      expect(health.version).toBeDefined();
    });
  });

  // ─── Create → Query → Verify ──────────────────────────

  describe('Event lifecycle', () => {
    it('creates events and queries them back', async () => {
      await env.client.logLlmCall('sess-int-001', 'agent-int-001', {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello world' }],
        completion: 'Hi there!',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0.01,
        latencyMs: 200,
      });

      const result = await env.client.queryEvents({ sessionId: 'sess-int-001' });
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events.some((e) => e.sessionId === 'sess-int-001')).toBe(true);
    });

    it('retrieves a single event by ID', async () => {
      await env.client.logLlmCall('sess-int-002', 'agent-int-002', {
        provider: 'anthropic',
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Test' }],
        completion: 'Response',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        costUsd: 0.005,
        latencyMs: 100,
      });

      const result = await env.client.queryEvents({ sessionId: 'sess-int-002' });
      expect(result.events.length).toBeGreaterThanOrEqual(1);

      const event = await env.client.getEvent(result.events[0]!.id);
      expect(event.id).toBe(result.events[0]!.id);
      expect(event.sessionId).toBe('sess-int-002');
    });
  });

  // ─── Auth failure ──────────────────────────────────────

  describe('Authentication', () => {
    it('rejects requests with invalid API key', async () => {
      await expect(env.badClient.queryEvents()).rejects.toThrow(AuthenticationError);
    });
  });

  // ─── Batch / volume ───────────────────────────────────

  describe('Batch ingestion', () => {
    it('handles many concurrent LLM call logs', async () => {
      // Send 50 LLM calls concurrently (each creates 2 events = 100 events)
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          env.client.logLlmCall(`sess-batch-${i}`, 'agent-batch', {
            provider: 'openai',
            model: 'gpt-4',
            messages: [{ role: 'user', content: `msg ${i}` }],
            completion: `resp ${i}`,
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            costUsd: 0.005,
        latencyMs: 100,
          }),
        );
      }
      await Promise.all(promises);

      // Verify we can query them
      const result = await env.client.queryEvents({ agentId: 'agent-batch', limit: 200 });
      // Each logLlmCall creates 2 events (llm_call + llm_response)
      expect(result.events.length).toBeGreaterThanOrEqual(50);
    });
  });

  // ─── Sessions ─────────────────────────────────────────

  describe('Sessions', () => {
    it('lists sessions after event ingestion', async () => {
      await env.client.logLlmCall('sess-list-001', 'agent-list', {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        completion: 'Hi',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        costUsd: 0.001,
        latencyMs: 50,
      });

      const sessions = await env.client.getSessions({ agentId: 'agent-list' });
      expect(sessions.sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.sessions.some((s) => s.id === 'sess-list-001')).toBe(true);
    });
  });
});

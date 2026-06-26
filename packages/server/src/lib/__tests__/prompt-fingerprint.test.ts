/**
 * Prompt auto-discovery (#55 Thread 2, box 126) — recordPromptFingerprints.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentkitai/agentlens-core';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { PromptStore, computePromptHash } from '../../db/prompt-store.js';
import { recordPromptFingerprints } from '../prompt-fingerprint.js';

function llmCall(payload: Record<string, unknown>, agentId = 'agt_a', tenantId = 'default'): AgentLensEvent {
  return {
    id: `e-${Math.round(payload._n as number ?? 0)}`,
    timestamp: '2026-01-01T00:00:01.000Z',
    sessionId: 's1', agentId, eventType: 'llm_call', severity: 'info',
    payload, metadata: {}, prevHash: null, hash: 'h', tenantId,
  } as AgentLensEvent;
}

describe('recordPromptFingerprints', () => {
  let db: any;
  let store: PromptStore;
  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new PromptStore(db);
  });

  it('fingerprints the system prompt and dedups by content hash', () => {
    const sys = 'You are a helpful assistant. Follow the policy strictly.';
    recordPromptFingerprints(store, [
      llmCall({ systemPrompt: sys, messages: [{ role: 'user', content: 'hi' }] }),
      llmCall({ systemPrompt: sys, messages: [{ role: 'user', content: 'different user text' }] }),
    ]);
    const fps = store.getFingerprints('default');
    expect(fps).toHaveLength(1); // same system prompt → one fingerprint
    expect(fps[0]!.contentHash).toBe(computePromptHash(sys));
    expect(fps[0]!.callCount).toBe(2); // seen twice
    expect(fps[0]!.sampleContent).toBe(sys);
  });

  it('falls back to a leading system message when systemPrompt is absent', () => {
    recordPromptFingerprints(store, [
      llmCall({ messages: [{ role: 'system', content: 'SYS-VIA-MESSAGE' }, { role: 'user', content: 'q' }] }),
    ]);
    const fps = store.getFingerprints('default');
    expect(fps).toHaveLength(1);
    expect(fps[0]!.contentHash).toBe(computePromptHash('SYS-VIA-MESSAGE'));
  });

  it('skips non-llm_call events and llm_calls with no system prompt', () => {
    recordPromptFingerprints(store, [
      { ...llmCall({ systemPrompt: 'x' }), eventType: 'tool_call' } as AgentLensEvent,
      llmCall({ messages: [{ role: 'user', content: 'no system here' }] }),
      llmCall({}),
    ]);
    expect(store.getFingerprints('default')).toHaveLength(0);
  });

  it('separates fingerprints per agent and per tenant', () => {
    const sys = 'shared system prompt';
    recordPromptFingerprints(store, [
      llmCall({ systemPrompt: sys }, 'agt_a', 'default'),
      llmCall({ systemPrompt: sys }, 'agt_b', 'default'),
      llmCall({ systemPrompt: sys }, 'agt_a', 'tenant-b'),
    ]);
    expect(store.getFingerprints('default')).toHaveLength(2); // agt_a + agt_b
    expect(store.getFingerprints('default', 'agt_a')).toHaveLength(1);
    expect(store.getFingerprints('tenant-b')).toHaveLength(1);
  });

  it('extracts text from multimodal (array) system message content', () => {
    recordPromptFingerprints(store, [
      llmCall({ messages: [
        { role: 'system', content: [{ type: 'text', text: 'BLOCK ONE' }, { type: 'image', source: {} }, { type: 'text', text: 'BLOCK TWO' }] },
        { role: 'user', content: 'q' },
      ] }),
    ]);
    const fps = store.getFingerprints('default');
    expect(fps).toHaveLength(1);
    expect(fps[0]!.contentHash).toBe(computePromptHash('BLOCK ONE\nBLOCK TWO'));
  });

  it('dedups a batch sharing one system prompt into a single upsert with the full count', () => {
    const sys = 'big batch system prompt';
    const batch = Array.from({ length: 1000 }, () => llmCall({ systemPrompt: sys, messages: [{ role: 'user', content: 'x' }] }));
    recordPromptFingerprints(store, batch);
    const fps = store.getFingerprints('default');
    expect(fps).toHaveLength(1);
    expect(fps[0]!.callCount).toBe(1000); // one row, count reflects every call
  });

  it('no-ops when promptStore is null, even for a non-empty batch', () => {
    expect(() => recordPromptFingerprints(null, [
      llmCall({ systemPrompt: 'x' }), llmCall({ systemPrompt: 'y' }),
    ])).not.toThrow();
  });
});

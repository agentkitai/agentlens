import { describe, it, expect } from 'vitest';
import {
  ingestEventSchema,
  llmCallPayloadSchema,
  llmResponsePayloadSchema,
  llmMessageSchema,
  eventTypeSchema,
} from '../schemas.js';
import { createEvent, truncatePayload } from '../events.js';
import { computeEventHash, verifyChain } from '../hash.js';
import { EVENT_TYPES } from '../types.js';
import type {
  LlmCallPayload,
  LlmResponsePayload,
  LlmMessage,
  EventPayload,
} from '../types.js';
import type { HashableEvent, ChainEvent } from '../hash.js';
import { MAX_PAYLOAD_SIZE } from '../constants.js';

// ─── Test fixtures ───────────────────────────────────────────────────

const validLlmCallPayload: LlmCallPayload = {
  callId: 'call_abc123',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  messages: [
    { role: 'user', content: 'Hello, how are you?' },
  ],
};

const validLlmResponsePayload: LlmResponsePayload = {
  callId: 'call_abc123',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  completion: 'I am doing well, thank you!',
  finishReason: 'stop',
  usage: {
    inputTokens: 10,
    outputTokens: 8,
    totalTokens: 18,
  },
  costUsd: 0.001,
  latencyMs: 1200,
};

// ─── Story 1.1: EventType updates ───────────────────────────────────

describe('Story 1.1: LLM event types in types.ts', () => {
  it('should include llm_call in EVENT_TYPES array', () => {
    expect(EVENT_TYPES).toContain('llm_call');
  });

  it('should include llm_response in EVENT_TYPES array', () => {
    expect(EVENT_TYPES).toContain('llm_response');
  });
});

// ─── Story 1.2: Zod schema validation ──────────────────────────────

describe('Story 1.2: LLM Zod validation schemas', () => {
  describe('eventTypeSchema with LLM types', () => {
    it('should accept llm_call as a valid event type', () => {
      const result = eventTypeSchema.safeParse('llm_call');
      expect(result.success).toBe(true);
    });

    it('should accept llm_response as a valid event type', () => {
      const result = eventTypeSchema.safeParse('llm_response');
      expect(result.success).toBe(true);
    });
  });

  describe('llmMessageSchema', () => {
    it('should accept a simple user message with string content', () => {
      const result = llmMessageSchema.safeParse({
        role: 'user',
        content: 'Hello world',
      });
      expect(result.success).toBe(true);
    });

    it('should accept a message with array content (multimodal)', () => {
      const result = llmMessageSchema.safeParse({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', url: 'https://example.com/image.png' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept an assistant message with toolCalls', () => {
      const result = llmMessageSchema.safeParse({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc_1', name: 'search', arguments: { query: 'test' } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a tool message with toolCallId', () => {
      const result = llmMessageSchema.safeParse({
        role: 'tool',
        content: '{"result": "found"}',
        toolCallId: 'tc_1',
      });
      expect(result.success).toBe(true);
    });

    it('should reject a message with invalid role', () => {
      const result = llmMessageSchema.safeParse({
        role: 'function',
        content: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('llmCallPayloadSchema', () => {
    it('should accept a valid minimal llm_call payload', () => {
      const result = llmCallPayloadSchema.safeParse(validLlmCallPayload);
      expect(result.success).toBe(true);
    });

    it('should accept a full llm_call payload with all optional fields', () => {
      const full: LlmCallPayload = {
        callId: 'call_full',
        provider: 'openai',
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        systemPrompt: 'You are a helpful assistant.',
        parameters: {
          temperature: 0.7,
          maxTokens: 1000,
          topP: 0.9,
          stopSequences: ['\n\n'],
          customParam: 'allowed',
        },
        tools: [
          {
            name: 'calculator',
            description: 'Performs calculations',
            parameters: { type: 'object', properties: { expression: { type: 'string' } } },
          },
        ],
        redacted: false,
      };
      const result = llmCallPayloadSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it('should reject llm_call with empty callId', () => {
      const result = llmCallPayloadSchema.safeParse({
        ...validLlmCallPayload,
        callId: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject llm_call with empty messages array', () => {
      const result = llmCallPayloadSchema.safeParse({
        ...validLlmCallPayload,
        messages: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject llm_call with missing provider', () => {
      const { provider, ...rest } = validLlmCallPayload;
      const result = llmCallPayloadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject llm_call with missing model', () => {
      const { model, ...rest } = validLlmCallPayload;
      const result = llmCallPayloadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  describe('llmResponsePayloadSchema', () => {
    it('should accept a valid llm_response payload', () => {
      const result = llmResponsePayloadSchema.safeParse(validLlmResponsePayload);
      expect(result.success).toBe(true);
    });

    it('should accept llm_response with null completion (tool_use)', () => {
      const result = llmResponsePayloadSchema.safeParse({
        ...validLlmResponsePayload,
        completion: null,
        finishReason: 'tool_use',
        toolCalls: [
          { id: 'tc_1', name: 'search', arguments: { query: 'test' } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept llm_response with optional cache/thinking tokens', () => {
      const result = llmResponsePayloadSchema.safeParse({
        ...validLlmResponsePayload,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          thinkingTokens: 20,
          cacheReadTokens: 80,
          cacheWriteTokens: 100,
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject llm_response with missing usage', () => {
      const { usage, ...rest } = validLlmResponsePayload;
      const result = llmResponsePayloadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject llm_response with missing finishReason', () => {
      const { finishReason, ...rest } = validLlmResponsePayload;
      const result = llmResponsePayloadSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject llm_response with empty callId', () => {
      const result = llmResponsePayloadSchema.safeParse({
        ...validLlmResponsePayload,
        callId: '',
      });
      expect(result.success).toBe(false);
    });

    it('should accept any string finishReason (extensible)', () => {
      const result = llmResponsePayloadSchema.safeParse({
        ...validLlmResponsePayload,
        finishReason: 'custom_reason',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ingestEventSchema with LLM payloads', () => {
    it('should accept a valid llm_call ingest event', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_call',
        payload: validLlmCallPayload,
      };
      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept a valid llm_response ingest event', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_response',
        payload: validLlmResponsePayload,
      };
      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject llm_call ingest with invalid payload (missing messages)', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_call',
        payload: {
          callId: 'call_1',
          provider: 'anthropic',
          model: 'claude-3',
        },
      };
      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messagesError = result.error.issues.find(
          (i) => i.path[0] === 'payload' && i.path[1] === 'messages',
        );
        expect(messagesError).toBeDefined();
      }
    });

    it('should reject llm_response ingest with invalid payload (missing usage)', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_response',
        payload: {
          callId: 'call_1',
          provider: 'anthropic',
          model: 'claude-3',
          completion: 'hello',
          finishReason: 'stop',
          costUsd: 0.01,
          latencyMs: 500,
        },
      };
      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const usageError = result.error.issues.find(
          (i) => i.path[0] === 'payload' && i.path[1] === 'usage',
        );
        expect(usageError).toBeDefined();
      }
    });
  });
});

// ─── Story 1.3: Event creation, hash chain, truncation ──────────────

describe('Story 1.3: LLM event creation and hash chain', () => {
  describe('createEvent with LLM payloads', () => {
    it('should create a valid llm_call event', () => {
      const event = createEvent({
        sessionId: 'sess_llm',
        agentId: 'agent_llm',
        eventType: 'llm_call',
        payload: validLlmCallPayload,
      });

      expect(event.eventType).toBe('llm_call');
      expect(event.id).toMatch(/^[0-9A-Z]{26}$/);
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(event.prevHash).toBeNull();
      expect((event.payload as LlmCallPayload).callId).toBe('call_abc123');
      expect((event.payload as LlmCallPayload).provider).toBe('anthropic');
    });

    it('should create a valid llm_response event', () => {
      const event = createEvent({
        sessionId: 'sess_llm',
        agentId: 'agent_llm',
        eventType: 'llm_response',
        payload: validLlmResponsePayload,
      });

      expect(event.eventType).toBe('llm_response');
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      expect((event.payload as LlmResponsePayload).costUsd).toBe(0.001);
      expect((event.payload as LlmResponsePayload).latencyMs).toBe(1200);
    });

    it('should create a paired llm_call → llm_response chain', () => {
      const callEvent = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_call',
        payload: validLlmCallPayload,
      });

      const responseEvent = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_response',
        payload: validLlmResponsePayload,
        prevHash: callEvent.hash,
      });

      expect(responseEvent.prevHash).toBe(callEvent.hash);
      expect(responseEvent.hash).not.toBe(callEvent.hash);
    });
  });

  describe('hash chain verification with LLM events', () => {
    function toChainEvent(event: HashableEvent): ChainEvent {
      return { ...event, hash: computeEventHash(event) };
    }

    it('should verify a valid chain: session_started → llm_call → llm_response → session_ended', () => {
      const e1: HashableEvent = {
        id: '01A0001',
        timestamp: '2026-02-08T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        severity: 'info',
        payload: { agentName: 'TestAgent' },
        metadata: {},
        prevHash: null,
      };
      const ce1 = toChainEvent(e1);

      const e2: HashableEvent = {
        id: '01A0002',
        timestamp: '2026-02-08T10:00:01Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_call',
        severity: 'info',
        payload: validLlmCallPayload,
        metadata: {},
        prevHash: ce1.hash,
      };
      const ce2 = toChainEvent(e2);

      const e3: HashableEvent = {
        id: '01A0003',
        timestamp: '2026-02-08T10:00:02Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_response',
        severity: 'info',
        payload: validLlmResponsePayload,
        metadata: {},
        prevHash: ce2.hash,
      };
      const ce3 = toChainEvent(e3);

      const e4: HashableEvent = {
        id: '01A0004',
        timestamp: '2026-02-08T10:00:03Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_ended',
        severity: 'info',
        payload: { reason: 'completed' as const },
        metadata: {},
        prevHash: ce3.hash,
      };
      const ce4 = toChainEvent(e4);

      const result = verifyChain([ce1, ce2, ce3, ce4]);
      expect(result.valid).toBe(true);
    });

    it('should detect tampered llm_call payload in a chain', () => {
      const e1: HashableEvent = {
        id: '01B0001',
        timestamp: '2026-02-08T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'llm_call',
        severity: 'info',
        payload: validLlmCallPayload,
        metadata: {},
        prevHash: null,
      };
      const ce1 = toChainEvent(e1);

      // Tamper: change model name but keep old hash
      const tampered: ChainEvent = {
        ...ce1,
        payload: { ...validLlmCallPayload, model: 'HACKED-model' },
      };

      const result = verifyChain([tampered]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(0);
      expect(result.reason).toContain('hash mismatch');
    });
  });

  describe('payload truncation for large LLM prompts', () => {
    it('should truncate llm_call payload with very large prompt content', () => {
      const largeContent = 'x'.repeat(MAX_PAYLOAD_SIZE + 1000);
      const largePayload: EventPayload = {
        callId: 'call_large',
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: largeContent },
        ],
      } as EventPayload;

      const result = truncatePayload(largePayload);
      const resultAny = result as Record<string, unknown>;
      // Should be truncated
      expect((resultAny as { data?: { _truncated?: boolean } }).data?._truncated).toBe(true);
    });

    it('should not truncate llm_call payload under size limit', () => {
      const smallPayload: EventPayload = validLlmCallPayload as EventPayload;
      const result = truncatePayload(smallPayload);
      expect(result).toEqual(smallPayload);
    });

    it('should create an event with truncated large LLM payload', () => {
      const largeContent = 'A'.repeat(MAX_PAYLOAD_SIZE + 5000);
      const largePayload: LlmCallPayload = {
        callId: 'call_trunc',
        provider: 'openai',
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: largeContent },
        ],
      };

      const event = createEvent({
        sessionId: 'sess_trunc',
        agentId: 'agent_trunc',
        eventType: 'llm_call',
        payload: largePayload as EventPayload,
      });

      // Event should still be created successfully with a valid hash
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
      // Payload should be truncated
      const payloadData = (event.payload as unknown as { data?: { _truncated?: boolean } }).data;
      expect(payloadData?._truncated).toBe(true);
    });
  });

  describe('re-exports from index barrel', () => {
    it('should export LLM schemas and types from @agentlensai/core', async () => {
      const core = await import('../index.js');
      expect(core.llmCallPayloadSchema).toBeDefined();
      expect(core.llmResponsePayloadSchema).toBeDefined();
      expect(core.llmMessageSchema).toBeDefined();
      expect(core.EVENT_TYPES).toContain('llm_call');
      expect(core.EVENT_TYPES).toContain('llm_response');
    });
  });
});

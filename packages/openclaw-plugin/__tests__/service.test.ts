/**
 * OpenClaw Plugin — Unit tests for pure utility functions.
 *
 * NOTE: The plugin's main service (createAgentLensRelayService) is tightly coupled
 * to the openclaw/plugin-sdk runtime (onDiagnosticEvent, globalThis.fetch wrapping).
 * Full integration testing requires the OpenClaw host environment.
 * These tests cover the extractable pure logic only.
 */
import { describe, it, expect } from 'vitest';
import { estimateCost, resolveAgentId, extractToolCalls } from '../service.js';

describe('OpenClaw Plugin Service', () => {
  describe('estimateCost', () => {
    it('calculates cost for known model', () => {
      const cost = estimateCost('claude-sonnet-4', 1000, 500, 0, 0);
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('returns 0 for unknown model', () => {
      expect(estimateCost('gpt-4', 1000, 500, 0, 0)).toBe(0);
    });

    it('handles cache tokens correctly', () => {
      const cost = estimateCost('claude-opus-4-6', 1000, 500, 400, 0);
      expect(cost).toBeGreaterThan(0);
      // uncachedInput = max(0, 1000-400-0) = 600
      // (600*15 + 500*75 + 400*1.5) / 1e6 = 47100/1e6
      expect(cost).toBeCloseTo(0.0471, 4);
    });
  });

  describe('resolveAgentId', () => {
    it('extracts agent ID from session key', () => {
      expect(resolveAgentId('agent:bmad-dev:subagent:uuid')).toBe('bmad-dev');
    });

    it('extracts agent ID from main session', () => {
      expect(resolveAgentId('agent:main:main')).toBe('main');
    });

    it('returns default for undefined', () => {
      // Default is process.env.AGENTLENS_AGENT_ID || 'openclaw-brad'
      expect(resolveAgentId(undefined)).toBe('openclaw-brad');
    });

    it('returns default for non-matching pattern', () => {
      expect(resolveAgentId('random-string')).toBe('openclaw-brad');
    });
  });

  describe('extractToolCalls', () => {
    it('extracts tool calls from SSE stream', () => {
      const body = [
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"read_file","id":"tc_1"}}',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta"}}',
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"write_file","id":"tc_2"}}',
      ].join('\n');
      const tools = extractToolCalls(body);
      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({ toolName: 'read_file', toolCallId: 'tc_1' });
      expect(tools[1]).toEqual({ toolName: 'write_file', toolCallId: 'tc_2' });
    });

    it('returns empty array for no tool calls', () => {
      const body = 'data: {"type":"message_start"}\ndata: {"type":"content_block_start","content_block":{"type":"text"}}';
      expect(extractToolCalls(body)).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
      const body = 'data: {invalid json}\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"test","id":"1"}}';
      const tools = extractToolCalls(body);
      expect(tools).toHaveLength(1);
    });
  });
});

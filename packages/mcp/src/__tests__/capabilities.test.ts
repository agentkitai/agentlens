/**
 * Tests for auto-discovery capabilities module (Feature 10, Story 10.2)
 */

import { describe, it, expect } from 'vitest';
import { shouldRegisterTool, TOOL_FEATURE_MAP, type ToolRegistrationOptions } from '../capabilities.js';

const ALL_FEATURES = [
  'sessions', 'agents', 'alerts', 'analytics', 'stats',
  'recall', 'reflect', 'optimize', 'context', 'health',
  'replay', 'benchmarks', 'guardrails', 'discovery', 'delegation',
  'cost-budgets', 'trust', 'lessons', 'prompts',
];

function opts(overrides: Partial<ToolRegistrationOptions> = {}): ToolRegistrationOptions {
  return {
    serverInfo: { version: '0.12.1', features: ALL_FEATURES },
    allowlist: null,
    denylist: null,
    ...overrides,
  };
}

describe('TOOL_FEATURE_MAP', () => {
  it('covers 25 tools (15 existing + 10 new)', () => {
    expect(Object.keys(TOOL_FEATURE_MAP)).toHaveLength(24);
  });

  it('core ingest tools have empty feature requirements', () => {
    expect(TOOL_FEATURE_MAP.agentlens_session_start).toEqual([]);
    expect(TOOL_FEATURE_MAP.agentlens_log_event).toEqual([]);
    expect(TOOL_FEATURE_MAP.agentlens_session_end).toEqual([]);
    expect(TOOL_FEATURE_MAP.agentlens_query_events).toEqual([]);
    expect(TOOL_FEATURE_MAP.agentlens_log_llm_call).toEqual([]);
  });
});

describe('shouldRegisterTool', () => {
  // All features available
  it('registers all tools when all features available', () => {
    for (const toolName of Object.keys(TOOL_FEATURE_MAP)) {
      const result = shouldRegisterTool(toolName, opts());
      expect(result.register).toBe(true);
    }
  });

  // Partial features
  it('skips tools when required features are missing', () => {
    const result = shouldRegisterTool('agentlens_analytics', opts({
      serverInfo: { version: '0.12.1', features: ['sessions', 'agents'] },
    }));
    expect(result.register).toBe(false);
    expect(result.reason).toBe('server missing features: analytics');
  });

  it('registers core tools even when features are limited', () => {
    const result = shouldRegisterTool('agentlens_session_start', opts({
      serverInfo: { version: '0.12.1', features: [] },
    }));
    expect(result.register).toBe(true);
  });

  // Null serverInfo (graceful fallback)
  it('registers all tools when serverInfo is null', () => {
    for (const toolName of Object.keys(TOOL_FEATURE_MAP)) {
      const result = shouldRegisterTool(toolName, opts({ serverInfo: null }));
      expect(result.register).toBe(true);
    }
  });

  // Allowlist
  it('blocks tools not in allowlist', () => {
    const result = shouldRegisterTool('agentlens_analytics', opts({
      allowlist: ['session_start', 'recall'],
    }));
    expect(result.register).toBe(false);
    expect(result.reason).toBe('not in allowlist');
  });

  it('allows tools in allowlist by full name', () => {
    const result = shouldRegisterTool('agentlens_recall', opts({
      allowlist: ['agentlens_recall'],
    }));
    expect(result.register).toBe(true);
  });

  it('allows tools in allowlist by short name', () => {
    const result = shouldRegisterTool('agentlens_recall', opts({
      allowlist: ['recall'],
    }));
    expect(result.register).toBe(true);
  });

  // Denylist
  it('blocks tools in denylist', () => {
    const result = shouldRegisterTool('agentlens_benchmark', opts({
      denylist: ['benchmark'],
    }));
    expect(result.register).toBe(false);
    expect(result.reason).toBe('in denylist');
  });

  it('blocks tools in denylist by full name', () => {
    const result = shouldRegisterTool('agentlens_benchmark', opts({
      denylist: ['agentlens_benchmark'],
    }));
    expect(result.register).toBe(false);
    expect(result.reason).toBe('in denylist');
  });

  it('allows tools not in denylist', () => {
    const result = shouldRegisterTool('agentlens_recall', opts({
      denylist: ['benchmark'],
    }));
    expect(result.register).toBe(true);
  });

  // Allowlist + denylist combo
  it('allowlist takes priority over denylist', () => {
    // Tool in allowlist but also in denylist
    const result = shouldRegisterTool('agentlens_recall', opts({
      allowlist: ['recall'],
      denylist: ['recall'],
    }));
    // Allowlist check passes, then denylist blocks it
    expect(result.register).toBe(false);
    expect(result.reason).toBe('in denylist');
  });

  it('tool not in allowlist is blocked even if not in denylist', () => {
    const result = shouldRegisterTool('agentlens_analytics', opts({
      allowlist: ['recall'],
      denylist: ['benchmark'],
    }));
    expect(result.register).toBe(false);
    expect(result.reason).toBe('not in allowlist');
  });

  // Unknown tool name
  it('registers unknown tools when no allowlist and serverInfo is null', () => {
    const result = shouldRegisterTool('agentlens_unknown', opts({ serverInfo: null }));
    expect(result.register).toBe(true);
  });
});

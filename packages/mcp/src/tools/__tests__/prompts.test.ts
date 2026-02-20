/**
 * Tests for agentlens_prompts MCP Tool (Feature 19, Story 8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerPromptsTool } from '../prompts.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_prompts', () => {
  let transport: AgentLensTransport;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    transport = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
    const origTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      toolHandler = args[args.length - 1] as typeof toolHandler;
      return origTool(...(args as Parameters<typeof origTool>));
    });
    registerPromptsTool(server, transport);
  });

  // ── list ──

  it('lists prompts', async () => {
    vi.spyOn(transport, 'listPrompts').mockResolvedValue(mockResponse({ templates: [], total: 0 }));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBeUndefined();
    expect(transport.listPrompts).toHaveBeenCalled();
  });

  it('passes category and search to list', async () => {
    vi.spyOn(transport, 'listPrompts').mockResolvedValue(mockResponse({ templates: [], total: 0 }));
    await toolHandler({ action: 'list', category: 'system', search: 'hello' });
    expect(transport.listPrompts).toHaveBeenCalledWith({ category: 'system', search: 'hello' });
  });

  // ── get ──

  it('gets a prompt by templateId', async () => {
    vi.spyOn(transport, 'getPrompt').mockResolvedValue(mockResponse({ template: { id: 't1' }, versions: [] }));
    const result = await toolHandler({ action: 'get', templateId: 't1' });
    expect(result.isError).toBeUndefined();
    expect(transport.getPrompt).toHaveBeenCalledWith('t1');
  });

  it('requires templateId for get', async () => {
    const result = await toolHandler({ action: 'get' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('templateId');
  });

  // ── create ──

  it('creates a prompt', async () => {
    vi.spyOn(transport, 'createPrompt').mockResolvedValue(mockResponse({ template: { id: 't1' }, version: {} }));
    const result = await toolHandler({ action: 'create', name: 'Test', content: 'Hello {{name}}', category: 'system' });
    expect(result.isError).toBeUndefined();
    expect(transport.createPrompt).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test', content: 'Hello {{name}}', category: 'system' }));
  });

  it('requires name and content for create', async () => {
    const result = await toolHandler({ action: 'create', name: 'Test' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('name and content');
  });

  it('rejects invalid variables JSON', async () => {
    const result = await toolHandler({ action: 'create', name: 'Test', content: 'hi', variables: 'not-json' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('valid JSON');
  });

  // ── update ──

  it('updates a prompt (creates new version)', async () => {
    vi.spyOn(transport, 'createPromptVersion').mockResolvedValue(mockResponse({ version: { id: 'v2' } }));
    const result = await toolHandler({ action: 'update', templateId: 't1', content: 'New content', changelog: 'fix' });
    expect(result.isError).toBeUndefined();
    expect(transport.createPromptVersion).toHaveBeenCalledWith('t1', { content: 'New content', changelog: 'fix' });
  });

  it('requires templateId and content for update', async () => {
    const result = await toolHandler({ action: 'update', templateId: 't1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('templateId and content');
  });

  // ── analytics ──

  it('gets analytics', async () => {
    vi.spyOn(transport, 'getPromptAnalytics').mockResolvedValue(mockResponse({ analytics: [] }));
    const result = await toolHandler({ action: 'analytics', templateId: 't1', from: '2026-01-01', to: '2026-02-01' });
    expect(result.isError).toBeUndefined();
    expect(transport.getPromptAnalytics).toHaveBeenCalledWith('t1', { from: '2026-01-01', to: '2026-02-01' });
  });

  it('requires templateId for analytics', async () => {
    const result = await toolHandler({ action: 'analytics' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('templateId');
  });

  // ── fingerprints ──

  it('lists fingerprints', async () => {
    vi.spyOn(transport, 'getPromptFingerprints').mockResolvedValue(mockResponse({ fingerprints: [] }));
    const result = await toolHandler({ action: 'fingerprints' });
    expect(result.isError).toBeUndefined();
  });

  it('passes agentId to fingerprints', async () => {
    vi.spyOn(transport, 'getPromptFingerprints').mockResolvedValue(mockResponse({ fingerprints: [] }));
    await toolHandler({ action: 'fingerprints', agentId: 'a1' });
    expect(transport.getPromptFingerprints).toHaveBeenCalledWith({ agentId: 'a1' });
  });

  // ── error handling ──

  it('handles API errors', async () => {
    vi.spyOn(transport, 'listPrompts').mockResolvedValue(mockResponse('Server error', false, 500));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBe(true);
  });

  it('handles unknown action', async () => {
    const result = await toolHandler({ action: 'unknown' as any });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown action');
  });
});

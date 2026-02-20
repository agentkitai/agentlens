/**
 * Tests for agentlens_lessons MCP Tool (Feature 10, Story 10.11)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerLessonsTool } from '../lessons.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_lessons', () => {
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
    registerLessonsTool(server, transport);
  });

  it('lists lessons', async () => {
    vi.spyOn(transport, 'getLessons').mockResolvedValue(mockResponse({ lessons: [] }));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBeUndefined();
  });

  it('creates lesson', async () => {
    vi.spyOn(transport, 'createLesson').mockResolvedValue(mockResponse({ id: 'l1' }));
    const result = await toolHandler({ action: 'create', title: 'Test', body: 'Content' });
    expect(result.isError).toBeUndefined();
  });

  it('validates create requires title', async () => {
    const result = await toolHandler({ action: 'create', body: 'Content' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('title');
  });

  it('validates create requires body', async () => {
    const result = await toolHandler({ action: 'create', title: 'Test' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('body');
  });

  it('gets lesson detail', async () => {
    vi.spyOn(transport, 'getLesson').mockResolvedValue(mockResponse({ id: 'l1', title: 'Test' }));
    const result = await toolHandler({ action: 'detail', lessonId: 'l1' });
    expect(result.isError).toBeUndefined();
  });

  it('validates detail requires lessonId', async () => {
    const result = await toolHandler({ action: 'detail' });
    expect(result.isError).toBe(true);
  });

  it('updates lesson', async () => {
    vi.spyOn(transport, 'updateLesson').mockResolvedValue(mockResponse({ id: 'l1' }));
    const result = await toolHandler({ action: 'update', lessonId: 'l1', title: 'New' });
    expect(result.isError).toBeUndefined();
  });

  it('deletes lesson', async () => {
    vi.spyOn(transport, 'deleteLesson').mockResolvedValue(mockResponse(null));
    const result = await toolHandler({ action: 'delete', lessonId: 'l1' });
    expect(result.isError).toBeUndefined();
  });
});

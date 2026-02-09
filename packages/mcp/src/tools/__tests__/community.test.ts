/**
 * Tests for agentlens_community MCP Tool (Story 7.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerCommunityTool } from '../community.js';

// Helper to create a mock transport
function createMockTransport() {
  const transport = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
  return transport;
}

// Helper to create a mock Response
function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

// We test the tool registration and handler logic by extracting the handler
describe('agentlens_community MCP Tool', () => {
  let server: McpServer;
  let transport: AgentLensTransport;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    transport = createMockTransport();

    // Capture the handler when tool() is called
    const origTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      // The handler is the last argument
      const handler = args[args.length - 1] as typeof toolHandler;
      toolHandler = handler;
      return origTool(...(args as Parameters<typeof origTool>));
    });

    registerCommunityTool(server, transport);
  });

  // ─── Share Action ─────────────────────────────────────

  describe('share action', () => {
    it('should require lessonId', async () => {
      const result = await toolHandler({ action: 'share' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('lessonId is required');
    });

    it('should share a lesson successfully', async () => {
      vi.spyOn(transport, 'communityShare').mockResolvedValue(
        mockResponse({ status: 'shared', anonymousLessonId: 'anon-123' }),
      );

      const result = await toolHandler({ action: 'share', lessonId: 'lesson-1' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('shared successfully');
      expect(result.content[0].text).toContain('anon-123');
    });

    it('should pass category when provided', async () => {
      const spy = vi.spyOn(transport, 'communityShare').mockResolvedValue(
        mockResponse({ status: 'shared', anonymousLessonId: 'anon-456' }),
      );

      await toolHandler({ action: 'share', lessonId: 'lesson-1', category: 'error-patterns' });
      expect(spy).toHaveBeenCalledWith({ lessonId: 'lesson-1', category: 'error-patterns' });
    });

    it('should handle disabled status', async () => {
      vi.spyOn(transport, 'communityShare').mockResolvedValue(
        mockResponse({ status: 'disabled', reason: 'Tenant sharing is disabled' }),
      );

      const result = await toolHandler({ action: 'share', lessonId: 'lesson-1' });
      expect(result.content[0].text).toContain('disabled');
      expect(result.content[0].text).toContain('Tenant sharing is disabled');
    });

    it('should handle API errors', async () => {
      vi.spyOn(transport, 'communityShare').mockResolvedValue(
        mockResponse('Server error', false, 500),
      );

      const result = await toolHandler({ action: 'share', lessonId: 'lesson-1' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error sharing lesson');
    });

    it('should handle network errors', async () => {
      vi.spyOn(transport, 'communityShare').mockRejectedValue(new Error('Network error'));

      const result = await toolHandler({ action: 'share', lessonId: 'lesson-1' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  // ─── Search Action ────────────────────────────────────

  describe('search action', () => {
    it('should require query', async () => {
      const result = await toolHandler({ action: 'search' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('query is required');
    });

    it('should search and return results', async () => {
      vi.spyOn(transport, 'communitySearch').mockResolvedValue(
        mockResponse({
          lessons: [
            { id: 'l1', title: 'Rate Limiting', category: 'error-patterns', reputationScore: 85, content: 'Use exponential backoff' },
          ],
          total: 1,
        }),
      );

      const result = await toolHandler({ action: 'search', query: 'rate limiting' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Found 1');
      expect(result.content[0].text).toContain('Rate Limiting');
      expect(result.content[0].text).toContain('rep: 85');
    });

    it('should handle empty results', async () => {
      vi.spyOn(transport, 'communitySearch').mockResolvedValue(
        mockResponse({ lessons: [], total: 0 }),
      );

      const result = await toolHandler({ action: 'search', query: 'nonexistent' });
      expect(result.content[0].text).toContain('No community lessons found');
    });

    it('should pass all search params', async () => {
      const spy = vi.spyOn(transport, 'communitySearch').mockResolvedValue(
        mockResponse({ lessons: [], total: 0 }),
      );

      await toolHandler({ action: 'search', query: 'test', category: 'general', minReputation: 50, limit: 5 });
      expect(spy).toHaveBeenCalledWith({
        query: 'test',
        category: 'general',
        minReputation: '50',
        limit: '5',
      });
    });

    it('should handle API errors on search', async () => {
      vi.spyOn(transport, 'communitySearch').mockResolvedValue(
        mockResponse('error', false, 500),
      );

      const result = await toolHandler({ action: 'search', query: 'test' });
      expect(result.isError).toBe(true);
    });

    it('should truncate long content in results', async () => {
      vi.spyOn(transport, 'communitySearch').mockResolvedValue(
        mockResponse({
          lessons: [
            { id: 'l1', title: 'Long', category: 'general', reputationScore: 50, content: 'x'.repeat(200) },
          ],
          total: 1,
        }),
      );

      const result = await toolHandler({ action: 'search', query: 'test' });
      expect(result.content[0].text).toContain('...');
    });
  });

  // ─── Rate Action ──────────────────────────────────────

  describe('rate action', () => {
    it('should require lessonId', async () => {
      const result = await toolHandler({ action: 'rate', delta: 1 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('lessonId is required');
    });

    it('should require delta', async () => {
      const result = await toolHandler({ action: 'rate', lessonId: 'l1' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('delta is required');
    });

    it('should reject invalid delta', async () => {
      const result = await toolHandler({ action: 'rate', lessonId: 'l1', delta: 5 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be +1 or -1');
    });

    it('should upvote successfully', async () => {
      vi.spyOn(transport, 'communityRate').mockResolvedValue(
        mockResponse({ status: 'rated', reputationScore: 55 }),
      );

      const result = await toolHandler({ action: 'rate', lessonId: 'l1', delta: 1 });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('👍');
      expect(result.content[0].text).toContain('55');
    });

    it('should downvote successfully', async () => {
      vi.spyOn(transport, 'communityRate').mockResolvedValue(
        mockResponse({ status: 'rated', reputationScore: 45 }),
      );

      const result = await toolHandler({ action: 'rate', lessonId: 'l1', delta: -1 });
      expect(result.content[0].text).toContain('👎');
      expect(result.content[0].text).toContain('45');
    });

    it('should handle rate API errors', async () => {
      vi.spyOn(transport, 'communityRate').mockResolvedValue(
        mockResponse('error', false, 429),
      );

      const result = await toolHandler({ action: 'rate', lessonId: 'l1', delta: 1 });
      expect(result.isError).toBe(true);
    });
  });

  // ─── Unknown Action ───────────────────────────────────

  it('should handle unknown action', async () => {
    const result = await toolHandler({ action: 'unknown' as any });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown action');
  });
});

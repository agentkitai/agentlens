/**
 * agentlens_community MCP Tool (Story 7.1)
 *
 * Community sharing operations via a single tool with an `action` parameter.
 * Actions: share, search, rate
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerCommunityTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_community',
    `Interact with the AgentLens community pool — share lessons, search community knowledge, or rate shared lessons.

**When to use:** To share a useful lesson with the community (share), to find community knowledge on a topic (search), or to rate the quality of a shared lesson (rate).

**Actions:**
- share: Share a lesson with the community pool
- search: Search the community pool for shared lessons
- rate: Rate a shared lesson (+1 upvote, -1 downvote)

**Example:** agentlens_community({ action: "search", query: "rate limiting best practices", category: "error-patterns", limit: 5 })`,
    {
      action: z.enum(['share', 'search', 'rate']).describe(
        'Operation to perform: share (share a lesson), search (search community), rate (rate a lesson)',
      ),
      // Fields for share
      lessonId: z.string().optional().describe('Lesson ID to share or rate (required for share and rate)'),
      // Fields for share/search
      category: z.string().optional().describe('Category filter (e.g., model-performance, error-patterns, tool-usage, cost-optimization, prompt-engineering, general)'),
      // Fields for search
      query: z.string().optional().describe('Search query text (required for search)'),
      minReputation: z.number().optional().describe('Minimum reputation score filter (for search)'),
      limit: z.number().optional().describe('Max results to return (default: 10, max: 50)'),
      // Fields for rate
      delta: z.number().optional().describe('Rating delta: +1 for upvote, -1 for downvote (required for rate)'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'share':
            return await handleShare(transport, args);
          case 'search':
            return await handleSearch(transport, args);
          case 'rate':
            return await handleRate(transport, args);
          default:
            return {
              content: [{ type: 'text' as const, text: `Unknown action: ${args.action}` }],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error in agentlens_community: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleShare(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.lessonId || typeof args.lessonId !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: lessonId is required for share action' }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = { lessonId: args.lessonId };
  if (args.category !== undefined) body.category = args.category;

  const response = await transport.communityShare(body);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error sharing lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const result = await response.json();
  const data = result as { status: string; anonymousLessonId?: string; reason?: string };

  if (data.status === 'shared') {
    return {
      content: [{ type: 'text' as const, text: `Lesson shared successfully. Anonymous ID: ${data.anonymousLessonId}` }],
    };
  }

  return {
    content: [{ type: 'text' as const, text: `Share result: ${data.status}${data.reason ? ` — ${data.reason}` : ''}` }],
  };
}

async function handleSearch(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.query || typeof args.query !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: query is required for search action' }],
      isError: true,
    };
  }

  const params: Record<string, string> = { query: args.query };
  if (args.category) params.category = String(args.category);
  if (args.minReputation !== undefined) params.minReputation = String(args.minReputation);
  if (args.limit !== undefined) params.limit = String(args.limit);

  const response = await transport.communitySearch(params);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error searching community: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as {
    lessons: Array<{ id: string; title: string; category: string; reputationScore: number; content: string }>;
    total: number;
  };

  if (data.lessons.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No community lessons found matching "${args.query}".` }],
    };
  }

  const summaries = data.lessons.map(
    (l) => `[${l.id}] (${l.category}, rep: ${l.reputationScore}) ${l.title}\n  ${l.content.slice(0, 120)}${l.content.length > 120 ? '...' : ''}`,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: `Found ${data.total} community lesson(s) matching "${args.query}":\n${summaries.join('\n')}`,
      },
    ],
  };
}

async function handleRate(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.lessonId || typeof args.lessonId !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: lessonId is required for rate action' }],
      isError: true,
    };
  }
  if (args.delta === undefined || typeof args.delta !== 'number') {
    return {
      content: [{ type: 'text' as const, text: 'Error: delta is required for rate action (+1 or -1)' }],
      isError: true,
    };
  }
  if (args.delta !== 1 && args.delta !== -1) {
    return {
      content: [{ type: 'text' as const, text: 'Error: delta must be +1 or -1' }],
      isError: true,
    };
  }

  const response = await transport.communityRate({
    lessonId: args.lessonId,
    delta: args.delta,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error rating lesson: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as { status: string; reputationScore?: number };
  return {
    content: [
      {
        type: 'text' as const,
        text: `Lesson ${args.lessonId} rated (${args.delta > 0 ? '👍' : '👎'}). New reputation: ${data.reputationScore ?? 'unknown'}`,
      },
    ],
  };
}

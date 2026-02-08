/**
 * agentlens_context MCP Tool (Story 7.7)
 *
 * Cross-session context retrieval — get related sessions and lessons for a topic.
 * Calls GET /api/context on the AgentLens server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerContextTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_context',
    `Retrieve cross-session context for a topic — related session summaries and lessons ranked by relevance.

**When to use:** At the start of a session to load relevant history, when building a system prompt with past experience, when starting work on a topic the agent has handled before, or to audit what happened with a specific topic.

**What it returns:** Related sessions (with summaries, key events, and relevance scores) and related lessons, all ranked by relevance to the topic. Includes an overall summary.

**Example:** agentlens_context({ topic: "database migrations", limit: 5 }) → returns past sessions about DB migrations with key events, plus any lessons learned about migrations.`,
    {
      topic: z.string().describe('Topic to retrieve context for (natural language)'),
      userId: z.string().optional().describe('Filter by user ID'),
      agentId: z.string().optional().describe('Filter by agent ID'),
      from: z.string().optional().describe('Start date filter (ISO 8601)'),
      to: z.string().optional().describe('End date filter (ISO 8601)'),
      limit: z.number().optional().describe('Maximum number of sessions to include (default: 5)'),
    },
    async ({ topic, userId, agentId, from, to, limit }) => {
      try {
        const data = (await transport.getContext({
          topic,
          userId,
          agentId,
          from,
          to,
          limit,
        })) as {
          topic: string;
          sessions: Array<{
            sessionId: string;
            summary?: string;
            relevanceScore: number;
            keyEvents: Array<{ eventType: string; summary: string }>;
          }>;
          lessons: Array<{
            title: string;
            content: string;
            category: string;
            relevanceScore: number;
          }>;
          summary?: string;
        };

        if (data.sessions.length === 0 && data.lessons.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No relevant context found for "${topic}".`,
              },
            ],
          };
        }

        // Format context for the agent
        const parts: string[] = [];
        parts.push(`Context for "${topic}":`);

        if (data.summary) {
          parts.push(`\nSummary: ${data.summary}`);
        }

        if (data.sessions.length > 0) {
          parts.push(`\nRelated Sessions (${data.sessions.length}):`);
          for (const session of data.sessions) {
            const score = (session.relevanceScore * 100).toFixed(1);
            parts.push(`\n  [${score}%] Session ${session.sessionId}`);
            if (session.summary) {
              parts.push(`    ${session.summary}`);
            }
            if (session.keyEvents?.length > 0) {
              for (const event of session.keyEvents.slice(0, 3)) {
                parts.push(`    - [${event.eventType}] ${event.summary}`);
              }
            }
          }
        }

        if (data.lessons.length > 0) {
          parts.push(`\nRelated Lessons (${data.lessons.length}):`);
          for (const lesson of data.lessons) {
            const score = (lesson.relevanceScore * 100).toFixed(1);
            parts.push(`\n  [${score}%] ${lesson.title} (${lesson.category})`);
            parts.push(`    ${lesson.content.slice(0, 200)}${lesson.content.length > 200 ? '...' : ''}`);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: parts.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error retrieving context: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

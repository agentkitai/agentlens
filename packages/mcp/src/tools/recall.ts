/**
 * agentlens_recall MCP Tool (Story 2.5)
 *
 * Semantic recall — search agent memory using natural language queries.
 * Calls GET /api/recall on the AgentLens server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerRecallTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_recall',
    'Semantic search over agent memory — find past events, sessions, and lessons by meaning. Use this to recall previous experiences, errors, tool usage patterns, and learned lessons.',
    {
      query: z.string().describe('Natural language search query'),
      scope: z
        .enum(['events', 'sessions', 'lessons', 'all'])
        .optional()
        .describe('Scope to search in (default: all)'),
      agentId: z.string().optional().describe('Filter by agent ID'),
      from: z.string().optional().describe('Filter results created after this ISO 8601 timestamp'),
      to: z.string().optional().describe('Filter results created before this ISO 8601 timestamp'),
      limit: z.number().optional().describe('Maximum number of results (default: 10, max: 100)'),
      minScore: z
        .number()
        .optional()
        .describe('Minimum similarity score 0-1 (default: 0, higher = more relevant)'),
    },
    async ({ query, scope, agentId, from, to, limit, minScore }) => {
      try {
        const response = await transport.recall({
          query,
          scope,
          agentId,
          from,
          to,
          limit,
          minScore,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error in recall: Server returned ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as {
          results: Array<{
            sourceType: string;
            sourceId: string;
            score: number;
            text: string;
            metadata?: Record<string, unknown>;
          }>;
          query: string;
          totalResults: number;
        };

        if (data.results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No results found for "${query}".`,
              },
            ],
          };
        }

        // Format results for the agent
        const formatted = data.results.map((r, i) => {
          const score = (r.score * 100).toFixed(1);
          return `${i + 1}. [${r.sourceType}] (${score}% match) ${r.text}`;
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${data.totalResults} result(s) for "${query}":\n\n${formatted.join('\n\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error in recall: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

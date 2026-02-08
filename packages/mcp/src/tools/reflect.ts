/**
 * agentlens_reflect MCP Tool (Story 4.5)
 *
 * Provides pattern analysis via the reflect endpoint.
 * Tool name: agentlens_reflect
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerReflectTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_reflect',
    `Analyze behavioral patterns from agent sessions — error patterns, tool sequences, cost analysis, and performance trends.

**When to use:** To identify recurring errors and their root causes (error_patterns), to understand cost drivers and optimize model usage (cost_analysis), to discover common tool usage chains and their success rates (tool_sequences), or to track performance over time (performance_trends).

**What it returns:** A list of structured insights with type, summary, data, and confidence score, plus metadata about how many sessions/events were analyzed. Each analysis type returns different data shapes.

**Example:** agentlens_reflect({ analysis: "error_patterns", agentId: "my-agent", from: "2026-01-01" }) → returns recurring error patterns with counts, first/last seen, and affected sessions.`,
    {
      analysis: z
        .enum([
          'error_patterns',
          'tool_sequences',
          'cost_analysis',
          'performance_trends',
        ])
        .describe(
          'Type of analysis to run: error_patterns (recurring errors), tool_sequences (common tool usage patterns), cost_analysis (cost breakdown and trends), performance_trends (success rate and duration trends)',
        ),
      agentId: z.string().optional().describe('Filter analysis to a specific agent'),
      from: z.string().optional().describe('Start of time range (ISO 8601)'),
      to: z.string().optional().describe('End of time range (ISO 8601)'),
      params: z.record(z.unknown()).optional().describe('Additional parameters (e.g., { model: "gpt-4o" } for cost_analysis)'),
      limit: z.number().optional().describe('Maximum number of results to return (default: 20)'),
    },
    async ({ analysis, agentId, from, to, params, limit }) => {
      try {
        const result = await transport.reflect({
          analysis,
          agentId,
          from,
          to,
          params,
          limit,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error running ${analysis} analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

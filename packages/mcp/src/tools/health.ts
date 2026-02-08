/**
 * agentlens_health MCP Tool (Story 1.5)
 *
 * Check the health score of the current agent.
 * Returns overall score (0-100), trend, and dimension breakdown.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

/** Type for the health score response from the API */
interface HealthScoreResponse {
  agentId: string;
  overallScore: number;
  trend: 'improving' | 'stable' | 'degrading';
  trendDelta: number;
  dimensions: Array<{
    name: string;
    score: number;
    weight: number;
    rawValue: number;
    description: string;
  }>;
  window: { from: string; to: string };
  sessionCount: number;
  computedAt: string;
}

/** Dimension display names */
const DIMENSION_LABELS: Record<string, string> = {
  error_rate: 'Error Rate',
  cost_efficiency: 'Cost Efficiency',
  tool_success: 'Tool Success',
  latency: 'Latency',
  completion_rate: 'Completion Rate',
};

/** Trend arrows */
const TREND_ARROWS: Record<string, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

export function formatHealthScore(data: HealthScoreResponse): string {
  const arrow = TREND_ARROWS[data.trend] ?? '→';
  const deltaStr = data.trendDelta >= 0 ? `+${data.trendDelta}pts` : `${data.trendDelta}pts`;
  const parts: string[] = [];

  parts.push(`Health Score: ${Math.round(data.overallScore)}/100 (${arrow} ${data.trend}, ${deltaStr})`);
  parts.push('');
  parts.push('Dimensions:');

  for (const dim of data.dimensions) {
    const label = DIMENSION_LABELS[dim.name] ?? dim.name;
    const padded = `${label}:`.padEnd(18);
    parts.push(`  ${padded}${Math.round(dim.score)}/100 (weight: ${dim.weight.toFixed(2)})`);
  }

  // Format window dates (just the date portion)
  const fromDate = data.window.from.slice(0, 10);
  const toDate = data.window.to.slice(0, 10);
  parts.push('');
  parts.push(`Window: ${fromDate} to ${toDate} (${data.sessionCount} sessions)`);

  return parts.join('\n');
}

export function registerHealthTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_health',
    `Check the health score of the current agent. Returns overall score (0-100), trend, and dimension breakdown.

**When to use:** To assess the current health and performance of the agent, to check if error rates or latency are degrading, or to get a quick overview of agent reliability metrics.

**What it returns:** An overall health score (0-100), a trend indicator (improving/stable/degrading), and a breakdown by five dimensions: error rate, cost efficiency, tool success, latency, and completion rate.

**Example:** agentlens_health({ window: 7 }) → returns health score with dimension breakdown for the last 7 days.`,
    {
      window: z
        .number()
        .optional()
        .describe('Rolling window in days (default: 7)'),
    },
    async ({ window }) => {
      try {
        const agentId = transport.getFirstActiveAgent();

        if (!agentId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No active session found. Start a session with agentlens_session_start first, then check health.',
              },
            ],
            isError: true,
          };
        }

        const data = (await transport.getHealth(
          agentId,
          window ?? 7,
        )) as HealthScoreResponse;

        return {
          content: [
            {
              type: 'text' as const,
              text: formatHealthScore(data),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // Check for 404 (no sessions)
        if (message.includes('404')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No sessions found for this agent in the specified window. Health scores require at least one completed session.',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error checking health: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

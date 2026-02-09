/**
 * agentlens_discover MCP Tool (Story 7.1)
 *
 * Discover agent capabilities via the discovery protocol.
 * Actions: discover
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerDiscoverTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_discover',
    `Discover available agent capabilities in the network.

**When to use:** Before delegating a task, to find agents that can handle a specific task type. Returns ranked results with trust scores, estimated cost, and latency.

**Example:** agentlens_discover({ action: "discover", taskType: "code-review", minTrustScore: 70, limit: 5 })`,
    {
      action: z.enum(['discover']).describe('Operation to perform: discover'),
      taskType: z.string().describe('Task type to search for (e.g., translation, summarization, code-review, data-extraction, classification, generation, analysis, transformation, custom)'),
      minTrustScore: z.number().optional().describe('Minimum trust score percentile (0-100)'),
      maxCost: z.number().optional().describe('Maximum estimated cost in USD'),
      maxLatency: z.number().optional().describe('Maximum estimated latency in milliseconds'),
      limit: z.number().optional().describe('Max results to return (default: 10, max: 20)'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'discover':
            return await handleDiscover(transport, args);
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
              text: `Error in agentlens_discover: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleDiscover(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.taskType || typeof args.taskType !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: taskType is required for discover action' }],
      isError: true,
    };
  }

  const params: Record<string, string> = { taskType: args.taskType };
  if (args.minTrustScore !== undefined) params.minTrustScore = String(args.minTrustScore);
  if (args.maxCost !== undefined) params.maxCostUsd = String(args.maxCost);
  if (args.maxLatency !== undefined) params.maxLatencyMs = String(args.maxLatency);
  if (args.limit !== undefined) params.limit = String(args.limit);

  const response = await transport.discover(params);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error discovering capabilities: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as {
    results: Array<{
      anonymousAgentId: string;
      taskType: string;
      trustScorePercentile: number;
      provisional: boolean;
      estimatedLatencyMs?: number;
      estimatedCostUsd?: number;
      qualityMetrics: { successRate?: number; completedTasks?: number };
    }>;
  };

  if (!data.results || data.results.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No agents found for task type "${args.taskType}".` }],
    };
  }

  const summaries = data.results.map((r, i) => {
    const parts = [
      `${i + 1}. Agent: ${r.anonymousAgentId}`,
      `   Trust: ${r.trustScorePercentile}%${r.provisional ? ' (provisional)' : ''}`,
    ];
    if (r.estimatedCostUsd !== undefined) parts.push(`   Est. Cost: $${r.estimatedCostUsd.toFixed(4)}`);
    if (r.estimatedLatencyMs !== undefined) parts.push(`   Est. Latency: ${r.estimatedLatencyMs}ms`);
    if (r.qualityMetrics.successRate !== undefined) parts.push(`   Success Rate: ${(r.qualityMetrics.successRate * 100).toFixed(1)}%`);
    return parts.join('\n');
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: `Found ${data.results.length} agent(s) for "${args.taskType}":\n\n${summaries.join('\n\n')}`,
      },
    ],
  };
}

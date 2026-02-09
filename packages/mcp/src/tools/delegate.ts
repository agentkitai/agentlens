/**
 * agentlens_delegate MCP Tool (Story 7.1)
 *
 * Delegate tasks to other agents in the network.
 * Actions: delegate
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

export function registerDelegateTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_delegate',
    `Delegate a task to another agent in the AgentLens network.

**When to use:** When you've discovered an agent capable of handling a specific task (via agentlens_discover) and want to delegate work to it.

**Example:** agentlens_delegate({ action: "delegate", targetAgentId: "anon-abc123", taskType: "translation", input: { text: "Hello", targetLang: "es" } })`,
    {
      action: z.enum(['delegate']).describe('Operation to perform: delegate'),
      targetAgentId: z.string().describe('Anonymous agent ID (from discovery results)'),
      taskType: z.string().describe('Task type to delegate'),
      input: z.unknown().describe('Input data for the delegated task'),
      fallbackEnabled: z.boolean().optional().describe('Enable fallback to alternative agents on failure (default: false)'),
      maxRetries: z.number().optional().describe('Maximum retry attempts with alternative agents (default: 3, max: 10)'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'delegate':
            return await handleDelegate(transport, args);
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
              text: `Error in agentlens_delegate: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleDelegate(
  transport: AgentLensTransport,
  args: Record<string, unknown>,
) {
  if (!args.targetAgentId || typeof args.targetAgentId !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: targetAgentId is required for delegate action' }],
      isError: true,
    };
  }
  if (!args.taskType || typeof args.taskType !== 'string') {
    return {
      content: [{ type: 'text' as const, text: 'Error: taskType is required for delegate action' }],
      isError: true,
    };
  }
  if (args.input === undefined) {
    return {
      content: [{ type: 'text' as const, text: 'Error: input is required for delegate action' }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = {
    targetAnonymousId: args.targetAgentId,
    taskType: args.taskType,
    input: args.input,
  };
  if (args.fallbackEnabled !== undefined) body.fallbackEnabled = args.fallbackEnabled;
  if (args.maxRetries !== undefined) body.maxRetries = args.maxRetries;
  if (args.timeoutMs !== undefined) body.timeoutMs = args.timeoutMs;

  const response = await transport.delegate(body);
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    return {
      content: [{ type: 'text' as const, text: `Error delegating task: ${response.status}: ${text}` }],
      isError: true,
    };
  }

  const data = await response.json() as {
    requestId: string;
    status: string;
    output?: unknown;
    executionTimeMs?: number;
    retriesUsed?: number;
  };

  if (data.status === 'success') {
    const parts = [`Delegation successful (ID: ${data.requestId})`];
    if (data.executionTimeMs !== undefined) parts.push(`Execution time: ${data.executionTimeMs}ms`);
    if (data.retriesUsed) parts.push(`Retries used: ${data.retriesUsed}`);
    parts.push(`Output: ${JSON.stringify(data.output)}`);
    return {
      content: [{ type: 'text' as const, text: parts.join('\n') }],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Delegation ${data.status} (ID: ${data.requestId})${data.output ? `\nDetails: ${JSON.stringify(data.output)}` : ''}`,
      },
    ],
  };
}

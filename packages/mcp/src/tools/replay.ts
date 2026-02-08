/**
 * agentlens_replay MCP Tool (Story 4.1)
 *
 * Replay a past session as a structured, human-readable timeline.
 * Returns session summary + numbered, timestamped steps with event type icons.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

/** Replay response from the API */
export interface ReplayResponse {
  sessionId: string;
  agentId: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  totalCostUsd?: number;
  eventCounts: Record<string, number>;
  steps: ReplayStep[];
}

export interface ReplayStep {
  index: number;
  timestamp: string;
  eventType: string;
  severity: string;
  summary: string;
  durationMs?: number;
  costUsd?: number;
  error?: string;
  paired?: boolean;
}

/** Event type → icon mapping */
const EVENT_ICONS: Record<string, string> = {
  session_started: '🟢',
  session_ended: '🔴',
  llm_call: '🤖',
  llm_response: '💬',
  tool_call: '🔧',
  tool_response: '📦',
  error: '⚠️',
  decision: '🧭',
  observation: '👁️',
  custom: '📝',
};

function getIcon(eventType: string): string {
  return EVENT_ICONS[eventType] ?? '📌';
}

/**
 * Format a duration in ms to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format the replay header (session summary).
 */
export function formatReplayHeader(data: ReplayResponse): string {
  const lines: string[] = [];

  lines.push(`📼 Session Replay: ${data.sessionId}`);
  lines.push('');
  lines.push(`Agent: ${data.agentId}`);
  lines.push(`Status: ${data.status}`);
  lines.push(`Started: ${data.startedAt}`);
  if (data.endedAt) {
    lines.push(`Ended: ${data.endedAt}`);
  }
  if (data.durationMs !== undefined) {
    lines.push(`Duration: ${formatDuration(data.durationMs)}`);
  }
  if (data.totalCostUsd !== undefined) {
    lines.push(`Total Cost: $${data.totalCostUsd.toFixed(4)}`);
  }

  // Event counts summary
  const counts = Object.entries(data.eventCounts);
  if (counts.length > 0) {
    const countStr = counts.map(([type, count]) => `${type}: ${count}`).join(', ');
    lines.push(`Events: ${countStr}`);
  }

  return lines.join('\n');
}

/**
 * Format a single replay step.
 */
export function formatReplayStep(step: ReplayStep, costSoFar?: number, errorCount?: number): string {
  const icon = step.error ? '⚠️' : getIcon(step.eventType);
  const time = step.timestamp.slice(11, 19); // HH:MM:SS
  let line = `${step.index}. [${time}] ${icon} ${step.eventType}`;

  if (step.durationMs !== undefined) {
    line += ` (${formatDuration(step.durationMs)})`;
  }

  line += `\n   ${step.summary}`;

  if (step.error) {
    line += `\n   ⚠️ Error: ${step.error}`;
  }

  if (step.costUsd !== undefined && step.costUsd > 0) {
    line += `\n   💰 $${step.costUsd.toFixed(4)}`;
  }

  // Context annotations
  const annotations: string[] = [];
  if (costSoFar !== undefined && costSoFar > 0) {
    annotations.push(`cost-so-far: $${costSoFar.toFixed(4)}`);
  }
  if (errorCount !== undefined && errorCount > 0) {
    annotations.push(`errors: ${errorCount}`);
  }
  if (annotations.length > 0) {
    line += `\n   [${annotations.join(' | ')}]`;
  }

  return line;
}

/**
 * Format the full replay output.
 */
export function formatReplay(data: ReplayResponse, summaryOnly: boolean): string {
  const header = formatReplayHeader(data);

  if (summaryOnly) {
    return header;
  }

  if (data.steps.length === 0) {
    return header + '\n\n(No steps to display)';
  }

  const stepLines: string[] = [];
  let costSoFar = 0;
  let errorCount = 0;

  for (const step of data.steps) {
    if (step.costUsd) costSoFar += step.costUsd;
    if (step.error) errorCount++;

    stepLines.push(formatReplayStep(step, costSoFar, errorCount));
  }

  return header + '\n\n' + stepLines.join('\n\n');
}

export function registerReplayTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_replay',
    `Replay a past session as a structured, human-readable timeline.

**When to use:** To review what happened in a previous session — understand failures, decision patterns, timing, or cost accumulation. Great for debugging or post-mortem analysis.

**What it returns:** A session header (agent, status, duration, cost, event counts) followed by numbered, timestamped steps with event type icons and context annotations.

**Parameters:**
- sessionId (required): The session to replay
- fromStep/toStep: Replay a specific step range
- eventTypes: Comma-separated filter (e.g., "llm_call,tool_call")
- summaryOnly: Set true to get just the summary header (fast for large sessions)

**Example:** agentlens_replay({ sessionId: "ses_abc123", summaryOnly: true }) → returns session summary without steps.`,
    {
      sessionId: z.string().describe('Session ID to replay'),
      fromStep: z.number().int().optional().describe('Start step number (0-based)'),
      toStep: z.number().int().optional().describe('End step number (inclusive)'),
      eventTypes: z
        .string()
        .optional()
        .describe('Comma-separated event types to filter (e.g., "llm_call,tool_call")'),
      summaryOnly: z
        .boolean()
        .optional()
        .describe('Return only the summary header (no steps). Default: false'),
    },
    async ({ sessionId, fromStep, toStep, eventTypes, summaryOnly }) => {
      try {
        const data = (await transport.replay(sessionId, {
          fromStep,
          toStep,
          eventTypes,
        })) as ReplayResponse;

        const text = formatReplay(data, summaryOnly ?? false);

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        if (message.includes('404')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session not found: ${sessionId}. Check the session ID and try again.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error replaying session: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * @agentlensai/mcp — Tool Definitions and Handlers (Stories 5.2–5.5, 3.1)
 *
 * Defines and registers the 5 MCP tools on an McpServer instance:
 *  - agentlens_session_start
 *  - agentlens_log_event
 *  - agentlens_session_end
 *  - agentlens_query_events
 *  - agentlens_log_llm_call
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from './transport.js';
import { registerContextTool } from './tools/context.js';
import { registerOptimizeTool } from './tools/optimize.js';
import { registerRecallTool } from './tools/recall.js';
import { registerReflectTool } from './tools/reflect.js';
import { registerHealthTool } from './tools/health.js';
import { registerReplayTool } from './tools/replay.js';
import { registerBenchmarkTool } from './tools/benchmark.js';
import { registerGuardrailsTool } from './tools/guardrails.js';
import { registerDiscoverTool } from './tools/discover.js';
import { registerDelegateTool } from './tools/delegate.js';

// ─── Tool Registration ─────────────────────────────────────────────

/**
 * Register all AgentLens tools on the given MCP server.
 */
export function registerTools(server: McpServer, transport: AgentLensTransport): void {
  registerSessionStart(server, transport);
  registerLogEvent(server, transport);
  registerSessionEnd(server, transport);
  registerQueryEvents(server, transport);
  registerLogLlmCall(server, transport);
  registerRecallTool(server, transport);
  registerReflectTool(server, transport);
  registerOptimizeTool(server, transport);
  registerContextTool(server, transport);
  registerHealthTool(server, transport);
  registerReplayTool(server, transport);
  registerBenchmarkTool(server, transport);
  registerGuardrailsTool(server, transport);
  registerDiscoverTool(server, transport);
  registerDelegateTool(server, transport);
}

// ─── 5.2: agentlens_session_start ──────────────────────────────────

function registerSessionStart(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_session_start',
    'Start a new AgentLens monitoring session. Returns a sessionId to use for subsequent events.',
    {
      agentId: z.string().describe('Unique identifier for the agent'),
      agentName: z.string().optional().describe('Human-readable agent name'),
      tags: z.array(z.string()).optional().describe('Tags for categorizing this session'),
    },
    async ({ agentId, agentName, tags }) => {
      try {
        const sessionId = generateSessionId();
        const event = {
          sessionId,
          agentId,
          eventType: 'session_started' as const,
          severity: 'info' as const,
          payload: {
            agentName,
            tags,
          } as Record<string, unknown>,
          metadata: {},
          timestamp: new Date().toISOString(),
        };

        const response = await transport.sendEventImmediate(event);

        if (!response.ok) {
          const body = await response.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error starting session: Server returned ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        // Store agentId for this session so log_event and session_end can use it
        transport.setSessionAgent(sessionId, agentId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ sessionId }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error starting session: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── 5.3: agentlens_log_event ──────────────────────────────────────

function registerLogEvent(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_log_event',
    'Log an event to an active AgentLens session.',
    {
      sessionId: z.string().describe('Session ID from agentlens_session_start'),
      eventType: z.string().describe('Event type (e.g., tool_call, tool_response, custom)'),
      payload: z
        .record(z.string(), z.unknown())
        .describe('Event payload — structure depends on eventType'),
      severity: z
        .enum(['debug', 'info', 'warn', 'error', 'critical'])
        .optional()
        .describe('Severity level (default: info)'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Arbitrary metadata (tags, labels, correlation IDs)'),
    },
    async ({ sessionId, eventType, payload, severity, metadata }) => {
      try {
        const event = {
          sessionId,
          agentId: transport.getSessionAgent(sessionId),
          eventType,
          severity: severity ?? 'info',
          payload,
          metadata: metadata ?? {},
          timestamp: new Date().toISOString(),
        };

        const response = await transport.sendEventImmediate(event);

        if (!response.ok) {
          const body = await response.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error logging event: Server returned ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Event logged: ${eventType} (severity: ${severity ?? 'info'})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error logging event: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── 5.4: agentlens_session_end ────────────────────────────────────

function registerSessionEnd(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_session_end',
    'End an active AgentLens monitoring session.',
    {
      sessionId: z.string().describe('Session ID to end'),
      reason: z
        .enum(['completed', 'error', 'timeout', 'manual'])
        .describe('Reason for ending the session'),
      summary: z.string().optional().describe('Optional summary of the session'),
    },
    async ({ sessionId, reason, summary }) => {
      try {
        const event = {
          sessionId,
          agentId: transport.getSessionAgent(sessionId),
          eventType: 'session_ended' as const,
          severity: reason === 'error' ? ('error' as const) : ('info' as const),
          payload: {
            reason,
            summary,
          } as Record<string, unknown>,
          metadata: {},
          timestamp: new Date().toISOString(),
        };

        // Flush any buffered events first, then send the end event
        await transport.flush();
        const response = await transport.sendEventImmediate(event);

        if (!response.ok) {
          const body = await response.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error ending session: Server returned ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        // Clean up the session-agent mapping
        transport.clearSessionAgent(sessionId);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Session ${sessionId} ended (reason: ${reason})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error ending session: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── 5.5: agentlens_query_events ───────────────────────────────────

function registerQueryEvents(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_query_events',
    'Query events from an AgentLens session.',
    {
      sessionId: z.string().describe('Session ID to query events from'),
      limit: z.number().optional().describe('Maximum number of events to return (default: 50)'),
      eventType: z.string().optional().describe('Filter by event type'),
    },
    async ({ sessionId, limit, eventType }) => {
      try {
        const response = await transport.queryEvents({
          sessionId,
          limit: limit ?? 50,
          eventType,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error querying events: Server returned ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as {
          events?: Array<{
            eventType: string;
            timestamp: string;
            severity: string;
            payload: Record<string, unknown>;
          }>;
        };
        const events = data.events ?? [];

        // Summarize events for the agent
        const summaries = events.map(
          (e: {
            eventType: string;
            timestamp: string;
            severity: string;
            payload: Record<string, unknown>;
          }) => {
            const payloadPreview = JSON.stringify(e.payload).slice(0, 100);
            return `[${e.timestamp}] ${e.eventType} (${e.severity}): ${payloadPreview}`;
          },
        );

        return {
          content: [
            {
              type: 'text' as const,
              text:
                events.length === 0
                  ? 'No events found for this session.'
                  : `Found ${events.length} event(s):\n${summaries.join('\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error querying events: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── 3.1: agentlens_log_llm_call ───────────────────────────────────

const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  toolCallId: z.string().optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
});

const llmToolDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const llmToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

function registerLogLlmCall(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_log_llm_call',
    'Log a complete LLM call (request + response) to an active AgentLens session. Emits paired llm_call and llm_response events.',
    {
      sessionId: z.string().describe('Session ID from agentlens_session_start'),
      provider: z.string().describe('LLM provider name (e.g., "anthropic", "openai", "google")'),
      model: z.string().describe('Model identifier (e.g., "claude-opus-4-6", "gpt-4o")'),
      messages: z.array(llmMessageSchema).describe('The prompt messages sent to the model'),
      systemPrompt: z.string().optional().describe('System prompt (if separate from messages)'),
      completion: z.string().nullable().describe('The completion content returned by the model'),
      toolCalls: z
        .array(llmToolCallSchema)
        .optional()
        .describe('Tool calls requested by the model'),
      finishReason: z
        .string()
        .describe('Stop reason (e.g., "stop", "length", "tool_use", "content_filter", "error")'),
      usage: z
        .object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          totalTokens: z.number(),
        })
        .describe('Token usage counts'),
      costUsd: z.number().describe('Cost of this call in USD'),
      latencyMs: z.number().describe('Latency in milliseconds'),
      parameters: z.record(z.string(), z.unknown()).optional().describe('Model parameters (temperature, maxTokens, etc.)'),
      tools: z.array(llmToolDefSchema).optional().describe('Tool/function definitions provided to the model'),
    },
    async ({
      sessionId,
      provider,
      model,
      messages,
      systemPrompt,
      completion,
      toolCalls,
      finishReason,
      usage,
      costUsd,
      latencyMs,
      parameters,
      tools,
    }) => {
      try {
        const callId = randomUUID();
        const timestamp = new Date().toISOString();
        const agentId = transport.getSessionAgent(sessionId);

        // Build llm_call event (request details)
        const llmCallEvent = {
          sessionId,
          agentId,
          eventType: 'llm_call' as const,
          severity: 'info' as const,
          payload: {
            callId,
            provider,
            model,
            messages,
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
            ...(parameters !== undefined ? { parameters } : {}),
            ...(tools !== undefined ? { tools } : {}),
          } as Record<string, unknown>,
          metadata: {},
          timestamp,
        };

        // Build llm_response event (response details)
        const llmResponseEvent = {
          sessionId,
          agentId,
          eventType: 'llm_response' as const,
          severity: 'info' as const,
          payload: {
            callId,
            provider,
            model,
            completion,
            ...(toolCalls !== undefined ? { toolCalls } : {}),
            finishReason,
            usage,
            costUsd,
            latencyMs,
          } as Record<string, unknown>,
          metadata: {},
          timestamp,
        };

        // Send both events via the transport
        const callResponse = await transport.sendEventImmediate(llmCallEvent);
        if (!callResponse.ok) {
          const body = await callResponse.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error logging LLM call: Server returned ${callResponse.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        const responseResponse = await transport.sendEventImmediate(llmResponseEvent);
        if (!responseResponse.ok) {
          const body = await responseResponse.text().catch(() => 'Unknown error');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error logging LLM response: Server returned ${responseResponse.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ callId, eventsLogged: 2 }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error logging LLM call: ${error instanceof Error ? error.message : 'Server unreachable'}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Generate a simple session ID (timestamp + random suffix).
 * The server may replace this with a ULID on ingest.
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `ses_${timestamp}_${random}`;
}

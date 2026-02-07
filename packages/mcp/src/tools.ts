/**
 * @agentlens/mcp — Tool Definitions and Handlers (Stories 5.2–5.5)
 *
 * Defines and registers the 4 MCP tools on an McpServer instance:
 *  - agentlens_session_start
 *  - agentlens_log_event
 *  - agentlens_session_end
 *  - agentlens_query_events
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from './transport.js';

// ─── Tool Registration ─────────────────────────────────────────────

/**
 * Register all AgentLens tools on the given MCP server.
 */
export function registerTools(server: McpServer, transport: AgentLensTransport): void {
  registerSessionStart(server, transport);
  registerLogEvent(server, transport);
  registerSessionEnd(server, transport);
  registerQueryEvents(server, transport);
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
        .record(z.unknown())
        .describe('Event payload — structure depends on eventType'),
      severity: z
        .enum(['debug', 'info', 'warn', 'error', 'critical'])
        .optional()
        .describe('Severity level (default: info)'),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Arbitrary metadata (tags, labels, correlation IDs)'),
    },
    async ({ sessionId, eventType, payload, severity, metadata }) => {
      try {
        const event = {
          sessionId,
          agentId: '', // Server will infer from session
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
          agentId: '', // Server will infer from session
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

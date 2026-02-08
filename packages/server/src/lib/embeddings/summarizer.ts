/**
 * Event & Session Summarizer (Story 2.3)
 *
 * Produces concise text summaries suitable for embedding.
 * - summarizeEvent(): returns embedding text for events worth embedding, or null to skip
 * - summarizeSession(): produces a heuristic session summary
 */

import type {
  AgentLensEvent,
  Session,
  ToolCallPayload,
  ToolErrorPayload,
  LlmCallPayload,
  LlmResponsePayload,
  CostTrackedPayload,
  SessionEndedPayload,
} from '@agentlensai/core';

/**
 * Truncate a string to `maxLen` characters, adding "…" if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * Safely extract a string from an unknown value, with fallback.
 */
function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/**
 * Summarize a single event into text suitable for embedding.
 * Returns null if the event should be skipped (not worth embedding).
 */
export function summarizeEvent(event: AgentLensEvent): string | null {
  const payload = event.payload as Record<string, unknown>;

  switch (event.eventType) {
    case 'tool_error': {
      const p = payload as unknown as ToolErrorPayload;
      const toolName = safeString(p.toolName, 'unknown');
      const error = safeString(p.error, 'unknown error');
      return `tool_error: ${toolName} - ${truncate(error, 300)}`;
    }

    case 'tool_call': {
      const p = payload as unknown as ToolCallPayload;
      const toolName = safeString(p.toolName, 'unknown');
      const args = truncate(safeString(p.arguments, '{}'), 200);
      return `tool_call: ${toolName}(${args})`;
    }

    case 'llm_call': {
      const p = payload as unknown as LlmCallPayload;
      const model = safeString(p.model, 'unknown');
      // Find the first user message
      let userMsg = '';
      if (Array.isArray(p.messages)) {
        const userMessage = p.messages.find((m) => m.role === 'user');
        if (userMessage) {
          const content = userMessage.content;
          if (typeof content === 'string') {
            userMsg = content;
          } else if (Array.isArray(content)) {
            const textPart = content.find((c) => c.type === 'text');
            userMsg = textPart?.text ?? '';
          }
        }
      }
      return `llm_call: ${model} - ${truncate(userMsg, 200)}`;
    }

    case 'llm_response': {
      const p = payload as unknown as LlmResponsePayload;
      const model = safeString(p.model, 'unknown');
      const completion = safeString(p.completion, '');
      return `llm_response: ${model} - ${truncate(completion, 200)}`;
    }

    default: {
      // Embed events with error or critical severity regardless of type
      if (event.severity === 'error' || event.severity === 'critical') {
        const summary = truncate(safeString(payload, '{}'), 300);
        return `${event.eventType}: ${summary}`;
      }
      // Skip everything else
      return null;
    }
  }
}

// ─── Session Summarization ──────────────────────────────────────────

export type SessionOutcome = 'success' | 'partial' | 'failure';

export interface SessionSummary {
  summary: string;
  topics: string[];
  toolSequence: string[];
  errorSummary: string;
  outcome: SessionOutcome;
}

/**
 * Produce a heuristic summary of a session from its metadata and events.
 */
export function summarizeSession(
  session: Session,
  events: AgentLensEvent[],
): SessionSummary {
  // Collect tool names in order
  const toolSequence: string[] = [];
  const toolNames = new Set<string>();
  const errorMessages: string[] = [];
  let errorCount = 0;

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    if (
      event.eventType === 'tool_call' ||
      event.eventType === 'tool_response' ||
      event.eventType === 'tool_error'
    ) {
      const toolName = safeString(payload.toolName, 'unknown');
      if (event.eventType === 'tool_call') {
        toolSequence.push(toolName);
      }
      toolNames.add(toolName);
    }

    if (event.eventType === 'tool_error') {
      errorCount++;
      errorMessages.push(safeString(payload.error, 'unknown error'));
    }

    if (event.severity === 'error' || event.severity === 'critical') {
      if (event.eventType !== 'tool_error') {
        errorCount++;
        errorMessages.push(`${event.eventType}: ${truncate(safeString(payload, ''), 100)}`);
      }
    }
  }

  // Calculate duration
  let duration = 'unknown duration';
  if (session.startedAt) {
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt
      ? new Date(session.endedAt).getTime()
      : Date.now();
    const diffMs = end - start;
    if (diffMs < 1000) {
      duration = `${diffMs}ms`;
    } else if (diffMs < 60_000) {
      duration = `${Math.round(diffMs / 1000)}s`;
    } else {
      duration = `${Math.round(diffMs / 60_000)}m`;
    }
  }

  // Build summary text
  const agentName = session.agentName ?? session.agentId;
  const toolList = toolNames.size > 0 ? Array.from(toolNames).join(', ') : 'none';
  const cost = session.totalCostUsd > 0 ? ` Cost: $${session.totalCostUsd.toFixed(4)}.` : '';
  const summary = `Agent ${agentName} ran for ${duration}. Used tools: ${toolList}. ${errorCount} errors.${cost}`;

  // Topics: tool names, event types, tags
  const eventTypes = new Set(events.map((e) => e.eventType));
  const topics = [
    ...Array.from(toolNames),
    ...Array.from(eventTypes),
    ...session.tags,
  ];

  // Error summary
  const errorSummary = errorMessages.length > 0
    ? truncate(errorMessages.join('; '), 500)
    : '';

  // Determine outcome
  let outcome: SessionOutcome;
  const totalEvents = events.length;
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const endedWithError =
    lastEvent?.eventType === 'tool_error' ||
    lastEvent?.severity === 'error' ||
    lastEvent?.severity === 'critical' ||
    (lastEvent?.eventType === 'session_ended' &&
      (lastEvent.payload as unknown as SessionEndedPayload)?.reason === 'error');

  if (errorCount === 0) {
    outcome = 'success';
  } else if (totalEvents > 0 && errorCount / totalEvents > 0.5) {
    outcome = 'failure';
  } else if (endedWithError) {
    outcome = 'failure';
  } else {
    outcome = 'partial';
  }

  return {
    summary,
    topics,
    toolSequence,
    errorSummary,
    outcome,
  };
}

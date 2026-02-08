/**
 * Error Pattern Analysis (Story 4.1)
 *
 * Analyzes tool_error events and error/critical severity events to find
 * recurring error patterns, grouping by normalized message.
 */

import type { IEventStore } from '@agentlensai/core';
import type {
  ErrorPatternResult,
  ErrorPattern,
  AgentLensEvent,
} from '@agentlensai/core';

export interface ErrorPatternOpts {
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Normalize an error message for grouping:
 * - Replace UUIDs with <UUID>
 * - Replace file paths with <PATH>
 * - Replace numbers with <N>
 */
export function normalizeErrorMessage(msg: string): string {
  return msg
    // UUIDs: 8-4-4-4-12 hex pattern
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    // File paths: /foo/bar/baz.ts etc.
    .replace(/\/[\w\/.\-]+/g, '<PATH>')
    // Numbers (standalone or in context)
    .replace(/\d+/g, '<N>');
}

/**
 * Extract error message from an event payload.
 */
function getErrorMessage(event: AgentLensEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.eventType === 'tool_error') {
    return String(payload.error ?? 'Unknown error');
  }
  // For other error/critical severity events, try to extract a message
  return String(
    payload.error ?? payload.message ?? payload.reason ?? JSON.stringify(payload),
  );
}

/**
 * Analyze error patterns from the event store.
 */
export async function analyzeErrorPatterns(
  store: IEventStore,
  opts: ErrorPatternOpts = {},
): Promise<ErrorPatternResult> {
  const limit = opts.limit ?? 20;

  // Query error events: tool_error events + error/critical severity events
  // We query tool_error events first
  const toolErrorResult = await store.queryEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    eventType: 'tool_error',
    limit: 500,
    order: 'asc',
  });

  // Then query error/critical severity events
  const severityErrorResult = await store.queryEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    severity: ['error', 'critical'],
    limit: 500,
    order: 'asc',
  });

  // Merge and deduplicate by event ID
  const seenIds = new Set<string>();
  const allErrors: AgentLensEvent[] = [];
  for (const event of [...toolErrorResult.events, ...severityErrorResult.events]) {
    if (!seenIds.has(event.id)) {
      seenIds.add(event.id);
      allErrors.push(event);
    }
  }

  // Sort by timestamp ascending
  allErrors.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const eventsAnalyzed = allErrors.length;
  const timeRange = {
    from: allErrors.length > 0 ? allErrors[0]!.timestamp : (opts.from ?? ''),
    to: allErrors.length > 0 ? allErrors[allErrors.length - 1]!.timestamp : (opts.to ?? ''),
  };

  // Group by normalized error message pattern
  const patternMap = new Map<
    string,
    {
      count: number;
      firstSeen: string;
      lastSeen: string;
      sessions: Set<string>;
      precedingTools: string[][];
    }
  >();

  // To find preceding tools, we need session timelines.
  // Cache session events to avoid repeated queries.
  const sessionEventsCache = new Map<string, AgentLensEvent[]>();

  for (const event of allErrors) {
    const msg = getErrorMessage(event);
    const pattern = normalizeErrorMessage(msg);

    let entry = patternMap.get(pattern);
    if (!entry) {
      entry = {
        count: 0,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        sessions: new Set(),
        precedingTools: [],
      };
      patternMap.set(pattern, entry);
    }

    entry.count++;
    if (event.timestamp < entry.firstSeen) entry.firstSeen = event.timestamp;
    if (event.timestamp > entry.lastSeen) entry.lastSeen = event.timestamp;
    entry.sessions.add(event.sessionId);

    // Get preceding tool calls (last 3 tool_call events before this error in the session)
    let sessionEvents = sessionEventsCache.get(event.sessionId);
    if (!sessionEvents) {
      sessionEvents = await store.getSessionTimeline(event.sessionId);
      sessionEventsCache.set(event.sessionId, sessionEvents);
    }

    const eventIdx = sessionEvents.findIndex((e) => e.id === event.id);
    if (eventIdx > 0) {
      const preceding: string[] = [];
      for (let i = eventIdx - 1; i >= 0 && preceding.length < 3; i--) {
        const prev = sessionEvents[i]!;
        if (prev.eventType === 'tool_call') {
          const p = prev.payload as Record<string, unknown>;
          preceding.unshift(String(p.toolName ?? 'unknown'));
        }
      }
      if (preceding.length > 0) {
        entry.precedingTools.push(preceding);
      }
    }
  }

  // Build result sorted by frequency descending
  const patterns: ErrorPattern[] = Array.from(patternMap.entries())
    .map(([pattern, entry]) => ({
      pattern,
      count: entry.count,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      affectedSessions: Array.from(entry.sessions),
      // Deduplicate preceding tool sequences
      precedingTools: deduplicateSequences(entry.precedingTools),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return {
    patterns,
    metadata: {
      eventsAnalyzed,
      timeRange,
    },
  };
}

/**
 * Deduplicate tool sequences by stringified form, keeping unique ones.
 */
function deduplicateSequences(sequences: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const seq of sequences) {
    const key = seq.join('→');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(seq);
    }
  }
  return result;
}

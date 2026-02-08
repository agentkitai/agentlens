/**
 * Tool Sequence Analysis (Story 4.2)
 *
 * Analyzes tool_call events to extract N-grams (2-grams and 3-grams)
 * of tool sequences per session, and identifies error-prone sequences.
 */

import type { IEventStore } from '@agentlensai/core';
import type {
  ToolSequenceResult,
  ToolSequence,
  AgentLensEvent,
} from '@agentlensai/core';

export interface ToolSequenceOpts {
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Analyze tool usage sequences across sessions.
 */
export async function analyzeToolSequences(
  store: IEventStore,
  opts: ToolSequenceOpts = {},
): Promise<ToolSequenceResult> {
  const limit = opts.limit ?? 20;

  // Query tool_call events
  const toolCallResult = await store.queryEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    eventType: 'tool_call',
    limit: 1000,
    order: 'asc',
  });

  // Also query tool_error events to identify error-prone sequences
  const toolErrorResult = await store.queryEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    eventType: 'tool_error',
    limit: 1000,
    order: 'asc',
  });

  // Track whether either query hit its limit (results may be truncated)
  const possiblyTruncated =
    toolCallResult.events.length === 1000 || toolErrorResult.events.length === 1000;

  const allToolCalls = toolCallResult.events;
  const allToolErrors = toolErrorResult.events;

  const eventsAnalyzed = allToolCalls.length + allToolErrors.length;
  const timeRange = {
    from: allToolCalls.length > 0 ? allToolCalls[0]!.timestamp : (opts.from ?? ''),
    to: allToolCalls.length > 0 ? allToolCalls[allToolCalls.length - 1]!.timestamp : (opts.to ?? ''),
  };

  // Group tool_call events by session
  const sessionToolCalls = new Map<string, AgentLensEvent[]>();
  for (const event of allToolCalls) {
    const list = sessionToolCalls.get(event.sessionId) ?? [];
    list.push(event);
    sessionToolCalls.set(event.sessionId, list);
  }

  // Group tool_error events by session for error-prone detection
  const sessionErrors = new Map<string, AgentLensEvent[]>();
  for (const event of allToolErrors) {
    const list = sessionErrors.get(event.sessionId) ?? [];
    list.push(event);
    sessionErrors.set(event.sessionId, list);
  }

  // Extract tool names per session (ordered by timestamp)
  const uniqueToolsSet = new Set<string>();
  let totalCalls = 0;
  const sessionToolNames = new Map<string, string[]>();

  for (const [sessionId, calls] of sessionToolCalls) {
    const names = calls.map((e) => {
      const p = e.payload as Record<string, unknown>;
      const name = String(p.toolName ?? 'unknown');
      uniqueToolsSet.add(name);
      return name;
    });
    sessionToolNames.set(sessionId, names);
    totalCalls += names.length;
  }

  // Extract N-grams and count frequencies
  // key = tools joined by "→", value = { frequency across sessions, set of sessions, errorFollowed count }
  const ngramMap = new Map<
    string,
    { tools: string[]; frequency: number; sessions: Set<string>; errorFollowed: number }
  >();

  for (const [sessionId, toolNames] of sessionToolNames) {
    const sessionErrorEvents = sessionErrors.get(sessionId) ?? [];

    // Get the full session timeline for error-proximity checks
    const sessionCalls = sessionToolCalls.get(sessionId) ?? [];

    // Extract 2-grams and 3-grams
    const seenInSession = new Set<string>(); // Avoid counting same ngram twice per session
    for (const n of [2, 3]) {
      for (let i = 0; i <= toolNames.length - n; i++) {
        const ngram = toolNames.slice(i, i + n);
        const key = ngram.join('→');

        if (!seenInSession.has(key)) {
          seenInSession.add(key);
          let entry = ngramMap.get(key);
          if (!entry) {
            entry = { tools: ngram, frequency: 0, sessions: new Set(), errorFollowed: 0 };
            ngramMap.set(key, entry);
          }
          entry.frequency++;
          entry.sessions.add(sessionId);
        }

        // Check if this ngram is followed by an error within 2 events
        // The last event of the ngram is at index i + n - 1 in sessionCalls
        const lastCallInNgram = sessionCalls[i + n - 1];
        if (lastCallInNgram) {
          const isErrorFollowed = sessionErrorEvents.some((errEvt) => {
            // Error must be after the last tool call in ngram
            // and within 2 "event positions" (by timestamp)
            if (errEvt.timestamp < lastCallInNgram.timestamp) return false;

            // Count how many tool_call events are between the last ngram call and the error
            const callsAfter = sessionCalls.filter(
              (c) => c.timestamp > lastCallInNgram.timestamp && c.timestamp <= errEvt.timestamp,
            );
            return callsAfter.length <= 2;
          });

          if (isErrorFollowed) {
            // We only count this once per session per ngram for error rate calculation
            // But we need to track total occurrences vs error-followed
            let entry = ngramMap.get(key)!;
            // Track on first occurrence in session
            if (seenInSession.has(`${key}:error-checked`)) continue;
            seenInSession.add(`${key}:error-checked`);
            entry.errorFollowed++;
          }
        }
      }
    }
  }

  // Calculate stats
  const sessionLengths = Array.from(sessionToolNames.values()).map((n) => n.length);
  const avgSequenceLength =
    sessionLengths.length > 0
      ? sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length
      : 0;

  // Build sorted results
  const sequences: ToolSequence[] = Array.from(ngramMap.values())
    .map((entry) => ({
      tools: entry.tools,
      frequency: entry.frequency,
      sessions: entry.sessions.size,
      errorRate:
        entry.sessions.size > 0
          ? entry.errorFollowed / entry.sessions.size
          : 0,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);

  return {
    sequences,
    stats: {
      avgSequenceLength: Math.round(avgSequenceLength * 100) / 100,
      uniqueTools: uniqueToolsSet.size,
      totalCalls,
    },
    metadata: {
      eventsAnalyzed,
      timeRange,
      ...(possiblyTruncated ? { truncated: true, note: 'Results may be incomplete — query limit reached' } : {}),
    },
  };
}

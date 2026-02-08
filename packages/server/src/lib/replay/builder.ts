/**
 * ReplayBuilder — Core Replay Logic (Stories 2.1, 2.4)
 *
 * Constructs a ReplayState from raw events for a given session.
 * Handles event pairing, cumulative context tracking, pagination,
 * filtering, and redaction of sensitive LLM content.
 */

import type {
  IEventStore,
  AgentLensEvent,
  EventType,
  ReplayStep,
  ReplayContext,
  ReplayState,
  ReplaySummary,
  LlmCallPayload,
  LlmResponsePayload,
  LlmMessage,
  ToolCallPayload,
  ToolResponsePayload,
  ToolErrorPayload,
  ApprovalRequestedPayload,
  ApprovalDecisionPayload,
  CostTrackedPayload,
} from '@agentlensai/core';
import { verifyChain } from '@agentlensai/core';

// ─── Build Options ─────────────────────────────────────────

export interface ReplayBuildOptions {
  /** Skip N steps (default 0) */
  offset?: number;
  /** Max steps to return (default 1000) */
  limit?: number;
  /** Only include these event types */
  eventTypes?: EventType[];
  /** If false, skip cumulative context computation (default true) */
  includeContext?: boolean;
}

// ─── ReplayBuilder ─────────────────────────────────────────

export class ReplayBuilder {
  constructor(private readonly store: IEventStore) {}

  /**
   * Build a ReplayState for the given session.
   * Returns null when the session does not exist.
   */
  async build(
    sessionId: string,
    options: ReplayBuildOptions = {},
  ): Promise<ReplayState | null> {
    const {
      offset = 0,
      limit = 1000,
      eventTypes,
      includeContext = true,
    } = options;

    // 1. Fetch session metadata
    const session = await this.store.getSession(sessionId);
    if (!session) return null;

    // 2. Fetch ALL events for the session (ascending)
    const allEvents = await this.store.getSessionTimeline(sessionId);

    if (allEvents.length === 0) {
      return {
        session,
        chainValid: true,
        totalSteps: 0,
        steps: [],
        pagination: { offset, limit, hasMore: false },
        summary: emptySummary(),
      };
    }

    // 3. Verify hash chain
    const chainResult = verifyChain(allEvents);
    const chainValid = chainResult.valid;

    // 4. Build pairing maps (always on full set for correct pairing)
    const pairMap = buildPairMap(allEvents);

    // 5. Apply eventTypes filter (but keep full list for summary)
    let filteredEvents = allEvents;
    if (eventTypes && eventTypes.length > 0) {
      const typeSet = new Set<string>(eventTypes);
      filteredEvents = allEvents.filter((e) => typeSet.has(e.eventType));
    }

    const totalSteps = filteredEvents.length;

    // 6. Summary is always computed from the full (unfiltered, unpaginated) event list
    const summary = computeSummary(allEvents);

    // 7. Paginate
    const pageEvents = filteredEvents.slice(offset, offset + limit);
    const hasMore = offset + limit < totalSteps;

    // 8. Build steps with cumulative context
    const steps: ReplayStep[] = [];

    if (includeContext) {
      // We need to compute context cumulatively through ALL filtered events
      // up to (offset + limit), then only return the paginated slice.
      const contextState = createContextState(allEvents.length);
      let stepIndex = 0;

      for (const event of filteredEvents) {
        // Update context with this event (even if before our page window)
        updateContext(contextState, event, allEvents);

        if (stepIndex >= offset && stepIndex < offset + limit) {
          const paired = pairMap.get(event.id);
          const step: ReplayStep = {
            index: stepIndex,
            event: maybeRedactEvent(event),
            context: snapshotContext(contextState),
          };
          if (paired) {
            step.pairedEvent = maybeRedactEvent(paired.event);
            step.pairDurationMs = paired.durationMs;
          }
          steps.push(step);
        }

        stepIndex++;
        if (stepIndex >= offset + limit && stepIndex >= totalSteps) break;
      }
    } else {
      // No context — just build steps with empty context
      let stepIndex = offset;
      for (const event of pageEvents) {
        const paired = pairMap.get(event.id);
        const step: ReplayStep = {
          index: stepIndex,
          event: maybeRedactEvent(event),
          context: emptyContext(allEvents.length),
        };
        if (paired) {
          step.pairedEvent = maybeRedactEvent(paired.event);
          step.pairDurationMs = paired.durationMs;
        }
        steps.push(step);
        stepIndex++;
      }
    }

    return {
      session,
      chainValid,
      totalSteps,
      steps,
      pagination: { offset, limit, hasMore },
      summary,
    };
  }
}

// ─── Pairing ───────────────────────────────────────────────

interface PairedInfo {
  event: AgentLensEvent;
  durationMs: number;
}

/**
 * Build a map from initiator event ID → paired response event + duration.
 *
 * Pairings:
 * - tool_call → tool_response/tool_error (by callId)
 * - llm_call → llm_response (by callId)
 * - approval_requested → approval_granted/denied/expired (by requestId)
 * - form_submitted → form_completed/form_expired (by submissionId)
 */
function buildPairMap(events: AgentLensEvent[]): Map<string, PairedInfo> {
  const pairMap = new Map<string, PairedInfo>();

  // Index initiator events by their correlation key
  const toolCalls = new Map<string, AgentLensEvent>(); // callId → event
  const llmCalls = new Map<string, AgentLensEvent>(); // callId → event
  const approvalRequests = new Map<string, AgentLensEvent>(); // requestId → event
  const formSubmissions = new Map<string, AgentLensEvent>(); // submissionId → event

  for (const event of events) {
    const p = event.payload as unknown;

    switch (event.eventType) {
      case 'tool_call':
        toolCalls.set((p as ToolCallPayload).callId, event);
        break;
      case 'llm_call':
        llmCalls.set((p as LlmCallPayload).callId, event);
        break;
      case 'approval_requested':
        approvalRequests.set(
          (p as ApprovalRequestedPayload).requestId,
          event,
        );
        break;
      case 'form_submitted':
        formSubmissions.set((p as { submissionId: string }).submissionId, event);
        break;

      case 'tool_response':
      case 'tool_error': {
        const callId = (p as ToolResponsePayload).callId;
        const initiator = toolCalls.get(callId);
        if (initiator) {
          const durationMs =
            new Date(event.timestamp).getTime() -
            new Date(initiator.timestamp).getTime();
          pairMap.set(initiator.id, { event, durationMs });
        }
        break;
      }

      case 'llm_response': {
        const callId = (p as LlmResponsePayload).callId;
        const initiator = llmCalls.get(callId);
        if (initiator) {
          const durationMs =
            new Date(event.timestamp).getTime() -
            new Date(initiator.timestamp).getTime();
          pairMap.set(initiator.id, { event, durationMs });
        }
        break;
      }

      case 'approval_granted':
      case 'approval_denied':
      case 'approval_expired': {
        const requestId = (p as ApprovalDecisionPayload).requestId;
        const initiator = approvalRequests.get(requestId);
        if (initiator) {
          const durationMs =
            new Date(event.timestamp).getTime() -
            new Date(initiator.timestamp).getTime();
          pairMap.set(initiator.id, { event, durationMs });
        }
        break;
      }

      case 'form_completed':
      case 'form_expired': {
        const submissionId = (p as { submissionId: string }).submissionId;
        const initiator = formSubmissions.get(submissionId);
        if (initiator) {
          const durationMs =
            new Date(event.timestamp).getTime() -
            new Date(initiator.timestamp).getTime();
          pairMap.set(initiator.id, { event, durationMs });
        }
        break;
      }
    }
  }

  return pairMap;
}

// ─── Cumulative Context ────────────────────────────────────

interface ContextState {
  totalEvents: number;
  eventIndex: number;
  cumulativeCostUsd: number;
  firstTimestamp: string | null;
  eventCounts: Record<string, number>;
  llmHistory: ReplayContext['llmHistory'];
  toolResults: ReplayContext['toolResults'];
  pendingApprovals: ReplayContext['pendingApprovals'];
  errorCount: number;
  warnings: string[];

  // Intermediate state (not part of output)
  _currentTimestamp: string | null;
  _pendingToolCalls: Map<
    string,
    { toolName: string; arguments: Record<string, unknown> }
  >;
  _pendingLlmCalls: Map<
    string,
    {
      provider: string;
      model: string;
      messages: LlmMessage[];
      costUsd: number;
    }
  >;
}

function createContextState(totalEvents: number): ContextState {
  return {
    totalEvents,
    eventIndex: 0,
    cumulativeCostUsd: 0,
    firstTimestamp: null,
    eventCounts: {},
    llmHistory: [],
    toolResults: [],
    pendingApprovals: [],
    errorCount: 0,
    warnings: [],
    _currentTimestamp: null,
    _pendingToolCalls: new Map(),
    _pendingLlmCalls: new Map(),
  };
}

function updateContext(
  ctx: ContextState,
  event: AgentLensEvent,
  _allEvents: AgentLensEvent[],
): void {
  ctx.eventIndex++;

  // Track first timestamp and current elapsed
  if (ctx.firstTimestamp === null) {
    ctx.firstTimestamp = event.timestamp;
  }
  ctx._currentTimestamp = event.timestamp;

  // Event counts
  ctx.eventCounts[event.eventType] = (ctx.eventCounts[event.eventType] ?? 0) + 1;

  // Error tracking
  if (
    event.eventType === 'tool_error' ||
    event.severity === 'error'
  ) {
    ctx.errorCount++;
  }

  const p = event.payload as unknown;

  switch (event.eventType) {
    case 'cost_tracked': {
      const payload = p as CostTrackedPayload;
      ctx.cumulativeCostUsd += payload.costUsd;
      break;
    }

    case 'tool_call': {
      const payload = p as ToolCallPayload;
      ctx._pendingToolCalls.set(payload.callId, {
        toolName: payload.toolName,
        arguments: payload.arguments,
      });
      ctx.toolResults.push({
        callId: payload.callId,
        toolName: payload.toolName,
        arguments: payload.arguments,
        completed: false,
      });
      break;
    }

    case 'tool_response': {
      const payload = p as ToolResponsePayload;
      const pending = ctx._pendingToolCalls.get(payload.callId);
      if (pending) {
        // Update the existing entry
        const entry = ctx.toolResults.find(
          (t) => t.callId === payload.callId,
        );
        if (entry) {
          entry.result = payload.result;
          entry.durationMs = payload.durationMs;
          entry.completed = true;
        }
        ctx._pendingToolCalls.delete(payload.callId);
      }
      break;
    }

    case 'tool_error': {
      const payload = p as ToolErrorPayload;
      const pending = ctx._pendingToolCalls.get(payload.callId);
      if (pending) {
        const entry = ctx.toolResults.find(
          (t) => t.callId === payload.callId,
        );
        if (entry) {
          entry.error = payload.error;
          entry.durationMs = payload.durationMs;
          entry.completed = true;
        }
        ctx._pendingToolCalls.delete(payload.callId);
      }
      break;
    }

    case 'llm_call': {
      const payload = p as LlmCallPayload;
      const messages = payload.redacted
        ? redactMessages(payload.messages)
        : payload.messages;
      ctx._pendingLlmCalls.set(payload.callId, {
        provider: payload.provider,
        model: payload.model,
        messages,
        costUsd: 0,
      });
      ctx.llmHistory.push({
        callId: payload.callId,
        provider: payload.provider,
        model: payload.model,
        messages,
        costUsd: 0,
        latencyMs: 0,
      });
      break;
    }

    case 'llm_response': {
      const payload = p as LlmResponsePayload;
      ctx.cumulativeCostUsd += payload.costUsd;
      const entry = ctx.llmHistory.find(
        (h) => h.callId === payload.callId,
      );
      if (entry) {
        entry.response = payload.redacted
          ? '[REDACTED]'
          : (payload.completion ?? undefined);
        entry.toolCalls = payload.toolCalls;
        entry.costUsd = payload.costUsd;
        entry.latencyMs = payload.latencyMs;
      } else {
        // Response without a matching call — still record it
        ctx.llmHistory.push({
          callId: payload.callId,
          provider: payload.provider,
          model: payload.model,
          messages: [],
          response: payload.redacted
            ? '[REDACTED]'
            : (payload.completion ?? undefined),
          toolCalls: payload.toolCalls,
          costUsd: payload.costUsd,
          latencyMs: payload.latencyMs,
        });
      }
      break;
    }

    case 'approval_requested': {
      const payload = p as ApprovalRequestedPayload;
      ctx.pendingApprovals.push({
        requestId: payload.requestId,
        action: payload.action,
        status: 'pending',
      });
      break;
    }

    case 'approval_granted':
    case 'approval_denied':
    case 'approval_expired': {
      const payload = p as ApprovalDecisionPayload;
      const approval = ctx.pendingApprovals.find(
        (a) => a.requestId === payload.requestId,
      );
      if (approval) {
        const statusMap: Record<string, 'granted' | 'denied' | 'expired'> = {
          approval_granted: 'granted',
          approval_denied: 'denied',
          approval_expired: 'expired',
        };
        approval.status = statusMap[event.eventType] ?? 'granted';
      }
      break;
    }
  }
}

function snapshotContext(ctx: ContextState): ReplayContext {
  const elapsedMs =
    ctx.firstTimestamp && ctx._currentTimestamp
      ? new Date(ctx._currentTimestamp).getTime() -
        new Date(ctx.firstTimestamp).getTime()
      : 0;

  return {
    eventIndex: ctx.eventIndex,
    totalEvents: ctx.totalEvents,
    cumulativeCostUsd: ctx.cumulativeCostUsd,
    elapsedMs,
    eventCounts: { ...ctx.eventCounts },
    llmHistory: ctx.llmHistory.map((h) => ({ ...h, messages: [...h.messages] })),
    toolResults: ctx.toolResults.map((t) => ({ ...t })),
    pendingApprovals: ctx.pendingApprovals.map((a) => ({ ...a })),
    errorCount: ctx.errorCount,
    warnings: [...ctx.warnings],
  };
}

function emptyContext(totalEvents: number): ReplayContext {
  return {
    eventIndex: 0,
    totalEvents,
    cumulativeCostUsd: 0,
    elapsedMs: 0,
    eventCounts: {},
    llmHistory: [],
    toolResults: [],
    pendingApprovals: [],
    errorCount: 0,
    warnings: [],
  };
}

// ─── Summary ───────────────────────────────────────────────

function emptySummary(): ReplaySummary {
  return {
    totalCost: 0,
    totalDurationMs: 0,
    totalLlmCalls: 0,
    totalToolCalls: 0,
    totalErrors: 0,
    models: [],
    tools: [],
  };
}

function computeSummary(events: AgentLensEvent[]): ReplaySummary {
  let totalCost = 0;
  let totalLlmCalls = 0;
  let totalToolCalls = 0;
  let totalErrors = 0;
  const models = new Set<string>();
  const tools = new Set<string>();

  for (const event of events) {
    const p = event.payload as unknown;

    switch (event.eventType) {
      case 'llm_call': {
        totalLlmCalls++;
        const payload = p as LlmCallPayload;
        models.add(payload.model);
        break;
      }
      case 'llm_response': {
        const payload = p as LlmResponsePayload;
        totalCost += payload.costUsd;
        break;
      }
      case 'cost_tracked': {
        const payload = p as CostTrackedPayload;
        totalCost += payload.costUsd;
        break;
      }
      case 'tool_call': {
        totalToolCalls++;
        const payload = p as ToolCallPayload;
        tools.add(payload.toolName);
        break;
      }
      case 'tool_error':
        totalErrors++;
        break;
    }
    if (event.severity === 'error' && event.eventType !== 'tool_error') {
      totalErrors++;
    }
  }

  const totalDurationMs =
    events.length >= 2
      ? new Date(events[events.length - 1].timestamp).getTime() -
        new Date(events[0].timestamp).getTime()
      : 0;

  return {
    totalCost,
    totalDurationMs,
    totalLlmCalls,
    totalToolCalls,
    totalErrors,
    models: [...models],
    tools: [...tools],
  };
}

// ─── Redaction (Story 2.4) ─────────────────────────────────

const REDACTED = '[REDACTED]';

function redactMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((msg) => ({
    ...msg,
    content: REDACTED,
  }));
}

/**
 * Return a shallow copy of the event with redacted payload content
 * if the event's payload has `redacted === true`.
 * Metadata (model, tokens, cost, latency) is always preserved.
 */
function maybeRedactEvent(event: AgentLensEvent): AgentLensEvent {
  const p = event.payload as unknown;

  if (event.eventType === 'llm_call' && (p as LlmCallPayload).redacted) {
    const payload = p as LlmCallPayload;
    return {
      ...event,
      payload: {
        ...payload,
        messages: redactMessages(payload.messages),
        systemPrompt: payload.systemPrompt ? REDACTED : undefined,
      } as unknown as typeof event.payload,
    };
  }

  if (event.eventType === 'llm_response' && (p as LlmResponsePayload).redacted) {
    const payload = p as LlmResponsePayload;
    return {
      ...event,
      payload: {
        ...payload,
        completion: REDACTED,
      } as unknown as typeof event.payload,
    };
  }

  return event;
}

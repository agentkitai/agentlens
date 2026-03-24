/**
 * Event ingestion methods — extracted from client.ts (cq-003)
 */

import { randomUUID } from 'node:crypto';
import type {
  EventQuery,
  EventQueryResult,
  AgentLensEvent,
} from '@agentlensai/core';
import { BaseClient } from './base.js';
import type { LogLlmCallParams } from './types.js';

export abstract class EventMethods extends BaseClient {
  /**
   * Query events with filters and pagination.
   */
  async queryEvents(query: EventQuery = {}): Promise<EventQueryResult> {
    const params = new URLSearchParams();
    if (query.sessionId) params.set('sessionId', query.sessionId);
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.eventType) {
      params.set('eventType', Array.isArray(query.eventType) ? query.eventType.join(',') : query.eventType);
    }
    if (query.severity) {
      params.set('severity', Array.isArray(query.severity) ? query.severity.join(',') : query.severity);
    }
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.search) params.set('search', query.search);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    if (query.order) params.set('order', query.order);

    return this.request<EventQueryResult>(`/api/events?${params.toString()}`);
  }

  /**
   * Get a single event by ID.
   */
  async getEvent(id: string): Promise<AgentLensEvent> {
    return this.request<AgentLensEvent>(`/api/events/${encodeURIComponent(id)}`);
  }

  /**
   * Log a complete LLM call (request + response) by sending paired events via batch ingest.
   */
  async logLlmCall(
    sessionId: string,
    agentId: string,
    params: LogLlmCallParams,
  ): Promise<{ callId: string }> {
    const callId = randomUUID();
    const timestamp = new Date().toISOString();
    const redacted = params.redact === true;

    const llmCallPayload: Record<string, unknown> = {
      callId,
      provider: params.provider,
      model: params.model,
      messages: redacted
        ? params.messages.map((m) => ({ role: m.role, content: '[REDACTED]' }))
        : params.messages,
      ...(params.systemPrompt !== undefined
        ? { systemPrompt: redacted ? '[REDACTED]' : params.systemPrompt }
        : {}),
      ...(params.parameters !== undefined ? { parameters: params.parameters } : {}),
      ...(params.tools !== undefined ? { tools: params.tools } : {}),
      ...(redacted ? { redacted: true } : {}),
    };

    const llmResponsePayload: Record<string, unknown> = {
      callId,
      provider: params.provider,
      model: params.model,
      completion: redacted ? '[REDACTED]' : params.completion,
      ...(params.toolCalls !== undefined ? { toolCalls: params.toolCalls } : {}),
      finishReason: params.finishReason,
      usage: params.usage,
      costUsd: params.costUsd,
      latencyMs: params.latencyMs,
      ...(redacted ? { redacted: true } : {}),
    };

    const sendRequest = () =>
      this.request('/api/events', {
        method: 'POST',
        body: {
          events: [
            {
              sessionId,
              agentId,
              eventType: 'llm_call',
              severity: 'info',
              payload: llmCallPayload,
              metadata: {},
              timestamp,
            },
            {
              sessionId,
              agentId,
              eventType: 'llm_response',
              severity: 'info',
              payload: llmResponsePayload,
              metadata: {},
              timestamp,
            },
          ],
        },
      });

    if (this.failOpen) {
      sendRequest().catch(() => {/* already handled by onError in request */});
    } else {
      await sendRequest();
    }

    return { callId };
  }
}

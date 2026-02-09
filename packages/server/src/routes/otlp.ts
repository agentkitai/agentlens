/**
 * OTLP HTTP Receiver Endpoints
 *
 * POST /v1/traces  — ingest OpenTelemetry trace spans
 * POST /v1/metrics — ingest OpenTelemetry metrics
 * POST /v1/logs    — ingest OpenTelemetry logs
 *
 * Maps OTLP data → AgentLens events, primarily for OpenClaw's diagnostics-otel plugin.
 * No auth required (like webhook ingest). JSON format only.
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import { computeEventHash, truncatePayload } from '@agentlensai/core';
import type { AgentLensEvent, EventType, EventPayload, EventSeverity } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import { eventBus } from '../lib/event-bus.js';

// ─── OTLP JSON Types ────────────────────────────────────────────────

interface OtlpKeyValue {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: Array<{ stringValue?: string }> };
  };
}

interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

interface OtlpSpan {
  name: string;
  traceId: string;
  spanId: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpKeyValue[];
  status?: { code?: number; message?: string };
}

interface OtlpScopeSpans {
  spans: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans: OtlpScopeSpans[];
}

interface OtlpTracesPayload {
  resourceSpans: OtlpResourceSpans[];
}

interface OtlpDataPoint {
  asInt?: string | number;
  asDouble?: number;
  attributes?: OtlpKeyValue[];
  timeUnixNano?: string;
}

interface OtlpMetric {
  name: string;
  sum?: { dataPoints: OtlpDataPoint[] };
  gauge?: { dataPoints: OtlpDataPoint[] };
  histogram?: { dataPoints: Array<{ sum?: number; count?: string | number; attributes?: OtlpKeyValue[] }> };
}

interface OtlpScopeMetrics {
  metrics: OtlpMetric[];
}

interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics: OtlpScopeMetrics[];
}

interface OtlpMetricsPayload {
  resourceMetrics: OtlpResourceMetrics[];
}

interface OtlpLogRecord {
  body?: { stringValue?: string };
  severityText?: string;
  severityNumber?: number;
  attributes?: OtlpKeyValue[];
  timeUnixNano?: string;
}

interface OtlpScopeLogs {
  logRecords: OtlpLogRecord[];
}

interface OtlpResourceLogs {
  resource?: OtlpResource;
  scopeLogs: OtlpScopeLogs[];
}

interface OtlpLogsPayload {
  resourceLogs: OtlpResourceLogs[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function getAttr(attrs: OtlpKeyValue[] | undefined, key: string): string | number | undefined {
  if (!attrs) return undefined;
  const kv = attrs.find((a) => a.key === key);
  if (!kv) return undefined;
  const v = kv.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return typeof v.intValue === 'string' ? parseInt(v.intValue, 10) : v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue ? 1 : 0;
  return undefined;
}

function getAttrStr(attrs: OtlpKeyValue[] | undefined, key: string): string | undefined {
  const v = getAttr(attrs, key);
  return v !== undefined ? String(v) : undefined;
}

function getAttrNum(attrs: OtlpKeyValue[] | undefined, key: string): number {
  const v = getAttr(attrs, key);
  return typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) || 0 : 0);
}

function attrsToRecord(attrs: OtlpKeyValue[] | undefined): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (!attrs) return record;
  for (const kv of attrs) {
    const v = kv.value;
    if (v.stringValue !== undefined) record[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) record[kv.key] = typeof v.intValue === 'string' ? parseInt(v.intValue, 10) : v.intValue;
    else if (v.doubleValue !== undefined) record[kv.key] = v.doubleValue;
    else if (v.boolValue !== undefined) record[kv.key] = v.boolValue;
  }
  return record;
}

function nanoToIso(nano: string | undefined): string {
  if (!nano) return new Date().toISOString();
  const ms = Math.floor(Number(BigInt(nano) / BigInt(1_000_000)));
  return new Date(ms).toISOString();
}

function spanDurationMs(span: OtlpSpan): number {
  try {
    const start = BigInt(span.startTimeUnixNano);
    const end = BigInt(span.endTimeUnixNano);
    return Number((end - start) / BigInt(1_000_000));
  } catch {
    return 0;
  }
}

function extractSessionId(spanAttrs: OtlpKeyValue[] | undefined, resourceAttrs: OtlpKeyValue[] | undefined): string {
  return getAttrStr(spanAttrs, 'openclaw.sessionId')
    ?? getAttrStr(spanAttrs, 'openclaw.sessionKey')
    ?? getAttrStr(resourceAttrs, 'openclaw.sessionId')
    ?? 'otlp-default';
}

function extractAgentId(resourceAttrs: OtlpKeyValue[] | undefined): string {
  return getAttrStr(resourceAttrs, 'service.name') ?? 'openclaw';
}

// ─── Span → Event Mapping ───────────────────────────────────────────

function mapSpanToEvent(
  span: OtlpSpan,
  resourceAttrs: OtlpKeyValue[] | undefined,
): { eventType: EventType; severity: EventSeverity; payload: EventPayload; sessionId: string; agentId: string } {
  const sessionId = extractSessionId(span.attributes, resourceAttrs);
  const agentId = extractAgentId(resourceAttrs);
  const attrs = span.attributes;
  const latencyMs = spanDurationMs(span);

  if (span.name === 'openclaw.model.usage') {
    const model = getAttrStr(attrs, 'openclaw.model') ?? 'unknown';
    const provider = getAttrStr(attrs, 'openclaw.provider') ?? 'unknown';
    const inputTokens = getAttrNum(attrs, 'openclaw.tokens.input');
    const outputTokens = getAttrNum(attrs, 'openclaw.tokens.output');
    const totalTokens = getAttrNum(attrs, 'openclaw.tokens.total');
    const cacheReadTokens = getAttrNum(attrs, 'openclaw.tokens.cache_read');

    return {
      eventType: 'llm_call',
      severity: 'info',
      sessionId,
      agentId,
      payload: {
        callId: span.spanId,
        provider,
        model,
        messages: [{ role: 'user' as const, content: '(from OTLP span — message content not available)' }],
        parameters: {
          ...(cacheReadTokens ? { cacheReadTokens } : {}),
        },
      },
    };
  }

  if (span.name === 'openclaw.message.processed') {
    return {
      eventType: 'custom',
      severity: 'info',
      sessionId,
      agentId,
      payload: {
        type: 'message_processed',
        data: {
          channel: getAttrStr(attrs, 'openclaw.channel'),
          outcome: getAttrStr(attrs, 'openclaw.outcome'),
          chatId: getAttrStr(attrs, 'openclaw.chatId'),
          messageId: getAttrStr(attrs, 'openclaw.messageId'),
          latencyMs,
        },
      },
    };
  }

  if (span.name === 'openclaw.webhook.processed' || span.name === 'openclaw.webhook.error') {
    return {
      eventType: 'custom',
      severity: span.name.endsWith('.error') ? 'error' : 'info',
      sessionId,
      agentId,
      payload: {
        type: span.name.replace('openclaw.', ''),
        data: { ...attrsToRecord(attrs), latencyMs },
      },
    };
  }

  if (span.name === 'openclaw.session.stuck') {
    return {
      eventType: 'custom',
      severity: 'error',
      sessionId,
      agentId,
      payload: {
        type: 'session_stuck',
        data: { ...attrsToRecord(attrs), latencyMs },
      },
    };
  }

  // Default: any other span → custom
  return {
    eventType: 'custom',
    severity: 'info',
    sessionId,
    agentId,
    payload: {
      type: 'otlp_span',
      data: {
        name: span.name,
        attributes: attrsToRecord(attrs),
        duration: latencyMs,
        traceId: span.traceId,
        spanId: span.spanId,
      },
    },
  };
}

// ─── Event Builder ──────────────────────────────────────────────────

async function buildAndInsertEvents(
  tenantStore: IEventStore,
  mappedEvents: Array<{
    eventType: EventType;
    severity: EventSeverity;
    payload: EventPayload;
    sessionId: string;
    agentId: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<AgentLensEvent[]> {
  if (mappedEvents.length === 0) return [];

  // Group by session for hash chain
  const bySession = new Map<string, typeof mappedEvents>();
  for (const ev of mappedEvents) {
    const arr = bySession.get(ev.sessionId) ?? [];
    arr.push(ev);
    bySession.set(ev.sessionId, arr);
  }

  const allEvents: AgentLensEvent[] = [];

  for (const [sessionId, sessionMapped] of bySession) {
    let prevHash: string | null = await tenantStore.getLastEventHash(sessionId);

    for (const input of sessionMapped) {
      const id = ulid();
      const payload = truncatePayload(input.payload);
      const hash = computeEventHash({
        id,
        timestamp: input.timestamp,
        sessionId: input.sessionId,
        agentId: input.agentId,
        eventType: input.eventType,
        severity: input.severity,
        payload,
        metadata: input.metadata,
        prevHash,
      });

      const event: AgentLensEvent = {
        id,
        timestamp: input.timestamp,
        sessionId: input.sessionId,
        agentId: input.agentId,
        eventType: input.eventType,
        severity: input.severity,
        payload,
        metadata: input.metadata,
        prevHash,
        hash,
        tenantId: 'default',
      };

      allEvents.push(event);
      prevHash = hash;
    }

    // Insert this session's events
    const sessionEvents = allEvents.filter((e) => e.sessionId === sessionId);
    await tenantStore.insertEvents(sessionEvents);
  }

  // Emit to EventBus
  const now = new Date().toISOString();
  for (const event of allEvents) {
    eventBus.emit({ type: 'event_ingested', event, timestamp: now });
  }

  return allEvents;
}

// ─── Route Factory ──────────────────────────────────────────────────

export function otlpRoutes(store: IEventStore) {
  const app = new Hono();

  // Use store directly — for SqliteEventStore callers should wrap in TenantScopedStore if needed
  const tenantStore = store;

  // POST /v1/traces
  app.post('/traces', async (c) => {
    const body = await c.req.json<OtlpTracesPayload>().catch(() => null);
    if (!body?.resourceSpans) {
      return c.json({ error: 'Invalid OTLP traces payload' }, 400);
    }

    const mapped: Parameters<typeof buildAndInsertEvents>[1] = [];

    for (const rs of body.resourceSpans) {
      const resourceAttrs = rs.resource?.attributes;
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          const result = mapSpanToEvent(span, resourceAttrs);
          mapped.push({
            ...result,
            timestamp: nanoToIso(span.startTimeUnixNano),
            metadata: { source: 'otlp', traceId: span.traceId, spanId: span.spanId },
          });
        }
      }
    }

    const events = await buildAndInsertEvents(tenantStore, mapped);

    return c.json({ partialSuccess: {} }, 200);
  });

  // POST /v1/metrics
  app.post('/metrics', async (c) => {
    const body = await c.req.json<OtlpMetricsPayload>().catch(() => null);
    if (!body?.resourceMetrics) {
      return c.json({ error: 'Invalid OTLP metrics payload' }, 400);
    }

    const mapped: Parameters<typeof buildAndInsertEvents>[1] = [];

    for (const rm of body.resourceMetrics) {
      const resourceAttrs = rm.resource?.attributes;
      const agentId = extractAgentId(resourceAttrs);

      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          const dataPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];

          if (metric.name === 'openclaw.cost.usd') {
            for (const dp of dataPoints) {
              const value = dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : 0);
              mapped.push({
                eventType: 'cost_tracked',
                severity: 'info',
                sessionId: getAttrStr(dp.attributes, 'openclaw.sessionId') ?? 'otlp-default',
                agentId,
                timestamp: nanoToIso(dp.timeUnixNano),
                metadata: { source: 'otlp_metric', metricName: metric.name },
                payload: {
                  provider: getAttrStr(dp.attributes, 'openclaw.provider') ?? 'unknown',
                  model: getAttrStr(dp.attributes, 'openclaw.model') ?? 'unknown',
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                  costUsd: value,
                },
              });
            }
          } else {
            // Generic metric → custom event
            for (const dp of dataPoints) {
              const value = dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : 0);
              mapped.push({
                eventType: 'custom',
                severity: 'info',
                sessionId: getAttrStr(dp.attributes, 'openclaw.sessionId') ?? 'otlp-default',
                agentId,
                timestamp: nanoToIso(dp.timeUnixNano),
                metadata: { source: 'otlp_metric', metricName: metric.name },
                payload: {
                  type: 'otlp_metric',
                  data: {
                    name: metric.name,
                    value,
                    attributes: attrsToRecord(dp.attributes),
                  },
                },
              });
            }
          }
        }
      }
    }

    if (mapped.length > 0) {
      await buildAndInsertEvents(tenantStore, mapped);
    }

    return c.json({ partialSuccess: {} }, 200);
  });

  // POST /v1/logs
  app.post('/logs', async (c) => {
    const body = await c.req.json<OtlpLogsPayload>().catch(() => null);
    if (!body?.resourceLogs) {
      return c.json({ error: 'Invalid OTLP logs payload' }, 400);
    }

    const mapped: Parameters<typeof buildAndInsertEvents>[1] = [];

    for (const rl of body.resourceLogs) {
      const resourceAttrs = rl.resource?.attributes;
      const agentId = extractAgentId(resourceAttrs);

      for (const sl of rl.scopeLogs ?? []) {
        for (const log of sl.logRecords ?? []) {
          const severityText = log.severityText?.toLowerCase() ?? 'info';
          let severity: EventSeverity = 'info';
          if (severityText.includes('error') || severityText.includes('fatal')) severity = 'error';
          else if (severityText.includes('warn')) severity = 'warn';
          else if (severityText.includes('debug') || severityText.includes('trace')) severity = 'debug';

          mapped.push({
            eventType: 'custom',
            severity,
            sessionId: extractSessionId(log.attributes, resourceAttrs),
            agentId,
            timestamp: nanoToIso(log.timeUnixNano),
            metadata: { source: 'otlp_log' },
            payload: {
              type: 'otlp_log',
              data: {
                body: log.body?.stringValue ?? '',
                severityText: log.severityText ?? 'INFO',
                attributes: attrsToRecord(log.attributes),
              },
            },
          });
        }
      }
    }

    if (mapped.length > 0) {
      await buildAndInsertEvents(tenantStore, mapped);
    }

    return c.json({ partialSuccess: {} }, 200);
  });

  return app;
}

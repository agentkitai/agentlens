/**
 * OTLP HTTP Receiver Endpoints
 *
 * POST /v1/traces  — ingest OpenTelemetry trace spans
 * POST /v1/metrics — ingest OpenTelemetry metrics
 * POST /v1/logs    — ingest OpenTelemetry logs
 *
 * Maps OTLP data → AgentLens events, primarily for OpenClaw's diagnostics-otel plugin.
 * No auth required (like webhook ingest). Supports both JSON and Protobuf content types.
 */

import { Hono } from 'hono';
import { timingSafeEqual, createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { computeEventHash, truncatePayload } from '@agentlensai/core';
import type { AgentLensEvent, EventType, EventPayload, EventSeverity } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import { eventBus } from '../lib/event-bus.js';
import type { ServerConfig } from '../config.js';

// ─── Protobuf Decoders (lazy-loaded) ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _protoRoot: Record<string, any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getProtoRoot(): Promise<Record<string, any>> {
  if (_protoRoot) return _protoRoot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('@opentelemetry/otlp-transformer/build/src/generated/root.js');
  const root = mod.default ?? mod;
  _protoRoot = root.opentelemetry.proto;
  return _protoRoot!;
}

async function decodeProtobuf(type: 'traces' | 'metrics' | 'logs', buf: Uint8Array): Promise<unknown> {
  const root = await getProtoRoot();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typeMap: Record<string, any> = {
    traces: root['collector'].trace.v1.ExportTraceServiceRequest,
    metrics: root['collector'].metrics.v1.ExportMetricsServiceRequest,
    logs: root['collector'].logs.v1.ExportLogsServiceRequest,
  };
  const MessageType = typeMap[type];
  const decoded = MessageType.decode(buf);
  return MessageType.toObject(decoded, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: true,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseOtlpBody(c: any, type: 'traces' | 'metrics' | 'logs'): Promise<any> {
  const contentType: string = c.req.header('content-type') ?? '';
  if (contentType.includes('application/x-protobuf') || contentType.includes('application/protobuf')) {
    const arrayBuf = await c.req.arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    if (buf.length === 0) return null;
    try {
      return await decodeProtobuf(type, buf);
    } catch {
      return null;
    }
  }
  // Default: JSON
  try { return await c.req.json(); } catch { return null; }
}

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

interface MappedEvent {
  eventType: EventType;
  severity: EventSeverity;
  payload: EventPayload;
  sessionId: string;
  agentId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

async function buildAndInsertEvents(
  tenantStore: IEventStore,
  mappedEvents: MappedEvent[],
  tenantId: string = 'default',
): Promise<AgentLensEvent[]> {
  if (mappedEvents.length === 0) return [];

  // Group by session for hash chain
  const bySession = new Map<string, MappedEvent[]>();
  for (const ev of mappedEvents) {
    const arr = bySession.get(ev.sessionId) ?? [];
    arr.push(ev);
    bySession.set(ev.sessionId, arr);
  }

  const allEvents: AgentLensEvent[] = [];

  for (const [sessionId, sessionMapped] of bySession) {
    let prevHash: string | null = await tenantStore.getLastEventHash(sessionId);
    const sessionEvents: AgentLensEvent[] = [];

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
        tenantId,
      };

      sessionEvents.push(event);
      allEvents.push(event);
      prevHash = hash;
    }

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

// ─── Rate Limiter ───────────────────────────────────────────────────

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

// H-2 FIX: Periodic cleanup of expired rate limit buckets to prevent memory leak
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanupInterval(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets) {
      if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup
  if (cleanupInterval && typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    cleanupInterval.unref();
  }
}

function checkRateLimit(ip: string, limit: number): boolean {
  ensureCleanupInterval();
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= limit;
}

/** Exported for testing — reset all rate limit state */
export function resetRateLimiter(): void {
  rateLimitBuckets.clear();
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// ─── Route Factory ──────────────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

export function otlpRoutes(store: IEventStore, config?: Partial<Pick<ServerConfig, 'otlpAuthToken' | 'otlpRateLimit' | 'multiTenantMode'>>) {
  const app = new Hono();
  const tenantStore = store;
  const authToken = config?.otlpAuthToken;
  const rateLimit = config?.otlpRateLimit ?? 1000;
  const multiTenantMode = config?.multiTenantMode ?? false;

  /**
   * Extract tenantId from OTLP request context. [F6-S7]
   * 1. From unified auth context (when OTLP_AUTH_REQUIRED=true)
   * 2. From openclaw.tenant_id resource attribute
   * 3. Reject if MULTI_TENANT_MODE=true, else fall back to 'default'
   */
  function resolveOtlpTenantId(
    c: any,
    resourceAttrs?: OtlpKeyValue[],
  ): string | null {
    // F2 auth context
    const auth = c.get('auth') as { orgId?: string } | undefined;
    if (auth?.orgId) return auth.orgId;

    // Legacy API key context
    const apiKey = c.get('apiKey') as { tenantId?: string } | undefined;
    if (apiKey?.tenantId) return apiKey.tenantId;

    // Resource attribute
    const attrTenant = getAttrStr(resourceAttrs, 'openclaw.tenant_id');
    if (attrTenant) return attrTenant;

    // Multi-tenant mode: reject unscoped ingestion
    if (multiTenantMode) return null;

    return 'default';
  }

  // ── Auth middleware ──
  app.use('*', async (c, next) => {
    if (authToken) {
      const authHeader = c.req.header('authorization') ?? '';
      const expected = `Bearer ${authToken}`;
      // M-14 FIX: Timing-safe comparison for auth token
      const a = Buffer.from(authHeader, 'utf-8');
      const b = Buffer.from(expected, 'utf-8');
      let match: boolean;
      if (a.length !== b.length) {
        const ha = createHash('sha256').update(a).digest();
        const hb = createHash('sha256').update(b).digest();
        match = timingSafeEqual(ha, hb);
      } else {
        match = timingSafeEqual(a, b);
      }
      if (!match) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    await next();
  });

  // ── Rate limiting middleware ──
  app.use('*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
    if (!checkRateLimit(ip, rateLimit)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    await next();
  });

  // ── Body size limit middleware ──
  app.use('*', async (c, next) => {
    const contentLength = c.req.header('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return c.json({ error: 'Payload too large' }, 413);
    }
    await next();
  });

  // POST /v1/traces
  app.post('/traces', async (c) => {
    const body: OtlpTracesPayload | null = await parseOtlpBody(c, 'traces');
    if (!body?.resourceSpans) {
      return c.json({ error: 'Invalid OTLP traces payload' }, 400);
    }

    const mapped: MappedEvent[] = [];

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

    // [F6-S7] Resolve tenant from first resource's attributes
    const firstResourceAttrs = body.resourceSpans?.[0]?.resource?.attributes;
    const otlpTenantId = resolveOtlpTenantId(c, firstResourceAttrs);
    if (otlpTenantId === null) {
      return c.json({ error: 'Tenant identification required in multi-tenant mode' }, 400);
    }

    await buildAndInsertEvents(tenantStore, mapped, otlpTenantId);
    return c.json({ partialSuccess: {} }, 200);
  });

  // POST /v1/metrics
  app.post('/metrics', async (c) => {
    const body: OtlpMetricsPayload | null = await parseOtlpBody(c, 'metrics');
    if (!body?.resourceMetrics) {
      return c.json({ error: 'Invalid OTLP metrics payload' }, 400);
    }

    const mapped: MappedEvent[] = [];

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
      // [F6-S7] Resolve tenant from first resource's attributes
      const firstMetricAttrs = body.resourceMetrics?.[0]?.resource?.attributes;
      const metricTenantId = resolveOtlpTenantId(c, firstMetricAttrs);
      if (metricTenantId === null) {
        return c.json({ error: 'Tenant identification required in multi-tenant mode' }, 400);
      }
      await buildAndInsertEvents(tenantStore, mapped, metricTenantId);
    }
    return c.json({ partialSuccess: {} }, 200);
  });

  // POST /v1/logs
  app.post('/logs', async (c) => {
    const body: OtlpLogsPayload | null = await parseOtlpBody(c, 'logs');
    if (!body?.resourceLogs) {
      return c.json({ error: 'Invalid OTLP logs payload' }, 400);
    }

    const mapped: MappedEvent[] = [];

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
      // [F6-S7] Resolve tenant from first resource's attributes
      const firstLogAttrs = body.resourceLogs?.[0]?.resource?.attributes;
      const logTenantId = resolveOtlpTenantId(c, firstLogAttrs);
      if (logTenantId === null) {
        return c.json({ error: 'Tenant identification required in multi-tenant mode' }, 400);
      }
      await buildAndInsertEvents(tenantStore, mapped, logTenantId);
    }
    return c.json({ partialSuccess: {} }, 200);
  });

  return app;
}

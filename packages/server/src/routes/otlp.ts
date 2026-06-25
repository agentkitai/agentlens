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
import protobuf from 'protobufjs';
import { computeEventHash, truncatePayload, costUsdDetailed } from '@agentlensai/core';
import { OTLP_PROTO_DESCRIPTOR } from '../otlp/otlp-proto-descriptor.js';
import { nextEventId } from '../lib/event-id.js';
import type { AgentLensEvent, EventType, EventPayload, EventSeverity } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import { eventBus } from '../lib/event-bus.js';
import type { ServerConfig } from '../config.js';
import type { PromptStore } from '../db/prompt-store.js';
import { recordPromptFingerprints } from '../lib/prompt-fingerprint.js';
import { verifyAgentToken, stampVerifiedAgent } from '../lib/agent-identity.js';
import { verifyIngestKey } from '../lib/ingest-key-verify.js';
import { createLogger } from '../lib/logger.js';

const otlpLogger = createLogger('OTLP');
// Warn at most once per service.name so high-volume ingest doesn't flood logs.
// ponytail: capped so an attacker pumping distinct service.name values can't
// grow this unboundedly; past the cap we just stop warning (low-cardinality in
// normal operation, so the cap is never reached).
const warnedServiceNames = new Set<string>();
const MAX_WARNED_SERVICE_NAMES = 10_000;
// Metric names already warned about for an unsupported aggregation type (same
// cap rationale as warnedServiceNames).
const warnedUnsupportedMetrics = new Set<string>();

// ─── Cost attribution for OTel-ingested GenAI spans ─────────────────
// OTel instrumentation usually reports tokens but not cost. Reconstruct it
// from the model's per-1M-token rates so OTel-instrumented agents get cost
// analytics with no SDK and no per-call cost attribute. Unknown models → 0.
export function otelCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  return costUsdDetailed(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }).costUsd;
}

// ─── Protobuf Decoders ──────────────────────────────────────────────
// Decode incoming binary OTLP requests from a vendored protobufjs descriptor
// (src/otlp/otlp-proto-descriptor.ts) so the receiver owns the schema rather than
// reaching into @opentelemetry/otlp-transformer internals (removed in 0.219 — #52).
// The Root + per-endpoint message types are built once on first use.
let _decoders: Record<'traces' | 'metrics' | 'logs', protobuf.Type> | null = null;

function getDecoders(): Record<'traces' | 'metrics' | 'logs', protobuf.Type> {
  if (_decoders) return _decoders;
  const root = protobuf.Root.fromJSON(OTLP_PROTO_DESCRIPTOR);
  _decoders = {
    traces: root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest'),
    metrics: root.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest'),
    logs: root.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest'),
  };
  return _decoders;
}

function decodeProtobuf(type: 'traces' | 'metrics' | 'logs', buf: Uint8Array): unknown {
  const MessageType = getDecoders()[type];
  // longs→String (precision), bytes→base64, fill defaults. Enums stay NUMERIC so
  // status.code matches the numeric constants the mapping compares against (e.g.
  // OTEL_STATUS_ERROR=2) — the same shape the JSON path produces. (The previous
  // otlp-transformer path used enums:String, which silently broke the protobuf
  // error-status check; spans with status.code=2 mapped to 'info' severity.)
  return MessageType.toObject(MessageType.decode(buf), {
    longs: String,
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

interface OtlpHistogramDataPoint {
  sum?: number;
  count?: string | number;
  attributes?: OtlpKeyValue[];
  timeUnixNano?: string;
}

interface OtlpMetric {
  name: string;
  sum?: { dataPoints: OtlpDataPoint[] };
  gauge?: { dataPoints: OtlpDataPoint[] };
  histogram?: { dataPoints: OtlpHistogramDataPoint[] };
  // Modeled only to detect-and-warn — these aggregations aren't ingested.
  exponentialHistogram?: { dataPoints?: unknown[] };
  summary?: { dataPoints?: unknown[] };
}

/** A metric data point normalized to a single scalar across number (sum/gauge)
 *  and histogram shapes, so every supported metric type ingests uniformly. */
interface NormalizedMetricPoint {
  value: number;
  attributes?: OtlpKeyValue[];
  timeUnixNano?: string;
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
  // `agentlens.agentId` is the PRIMARY cost-attribution key — set it to the
  // emitter's stable id (e.g. an AgentGate `agt_*` id) to make per-agent spend
  // joinable across the control plane (#13). It falls back to `service.name`,
  // which is operator-controlled and can collide between distinct agents, so we
  // warn when the explicit attribute is absent.
  const explicit = getAttrStr(resourceAttrs, 'agentlens.agentId');
  if (explicit) return explicit;
  const serviceName = getAttrStr(resourceAttrs, 'service.name');
  if (serviceName) {
    if (!warnedServiceNames.has(serviceName) && warnedServiceNames.size < MAX_WARNED_SERVICE_NAMES) {
      warnedServiceNames.add(serviceName);
      otlpLogger.warn(
        `OTel spans have no agentlens.agentId; attributing cost to service.name="${serviceName}". ` +
          `Set the agentlens.agentId resource attribute for stable per-agent attribution.`,
      );
    }
    return serviceName;
  }
  return 'openclaw';
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

// ─── OpenTelemetry GenAI Semantic Convention Mapping ────────────────
// Maps OTel GenAI spans (gen_ai.* attributes) into AgentLens events, so any
// OTel GenAI-instrumented agent works with no AgentLens SDK. Handles the two
// dominant content styles: OpenLLMetry indexed attrs (gen_ai.prompt.{i}.role/
// content) and the structured gen_ai.input/output.messages JSON attrs.

type LlmRole = 'system' | 'user' | 'assistant' | 'tool';
const GENAI_LLM_OPS = new Set(['chat', 'text_completion', 'generate_content']);
const OTEL_STATUS_ERROR = 2; // STATUS_CODE_ERROR

function normRole(r: string | undefined): LlmRole {
  if (r === 'system' || r === 'user' || r === 'assistant' || r === 'tool') return r;
  if (r === 'model' || r === 'ai') return 'assistant';
  if (r === 'human') return 'user';
  return 'user';
}

function isGenAiSpan(attrs: OtlpKeyValue[] | undefined): boolean {
  return getAttrStr(attrs, 'gen_ai.operation.name') !== undefined
    || getAttrStr(attrs, 'gen_ai.system') !== undefined
    || getAttrStr(attrs, 'gen_ai.request.model') !== undefined;
}

function genAiProvider(attrs: OtlpKeyValue[] | undefined): string {
  return getAttrStr(attrs, 'gen_ai.system')
    ?? getAttrStr(attrs, 'gen_ai.provider.name')
    ?? 'unknown';
}

function genAiSessionId(
  spanAttrs: OtlpKeyValue[] | undefined,
  resourceAttrs: OtlpKeyValue[] | undefined,
  traceId: string | undefined,
): string {
  // A trace = one agent run, so traceId is a sensible session fallback.
  return getAttrStr(spanAttrs, 'gen_ai.conversation.id')
    ?? getAttrStr(resourceAttrs, 'gen_ai.conversation.id')
    ?? getAttrStr(spanAttrs, 'session.id')
    ?? (traceId ? `trace-${traceId}` : 'otlp-genai');
}

function genAiAgentId(
  spanAttrs: OtlpKeyValue[] | undefined,
  resourceAttrs: OtlpKeyValue[] | undefined,
): string {
  return getAttrStr(spanAttrs, 'gen_ai.agent.name')
    ?? getAttrStr(resourceAttrs, 'gen_ai.agent.name')
    ?? getAttrStr(resourceAttrs, 'service.name')
    ?? 'otel-agent';
}

/** Collect role/content pairs from indexed attrs (OpenLLMetry) or a structured
 *  JSON messages attribute (newer semconv). */
function genAiMessages(
  attrs: OtlpKeyValue[] | undefined,
  indexedPrefix: string,
  structuredKey: string,
): Array<{ role: LlmRole; content: string }> {
  const out: Array<{ role: LlmRole; content: string }> = [];
  // Indexed: gen_ai.prompt.0.role / gen_ai.prompt.0.content
  for (let i = 0; i < 128; i++) {
    const content = getAttrStr(attrs, `${indexedPrefix}.${i}.content`);
    const role = getAttrStr(attrs, `${indexedPrefix}.${i}.role`);
    if (content === undefined && role === undefined) break;
    out.push({ role: normRole(role), content: content ?? '' });
  }
  if (out.length > 0) return out;
  // Structured JSON: gen_ai.input.messages = '[{"role":"user","content":"..."}]'
  const raw = getAttrStr(attrs, structuredKey);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const m of parsed as Array<Record<string, unknown>>) {
          let content = '';
          if (typeof m.content === 'string') content = m.content;
          else if (Array.isArray(m.content)) content = (m.content as Array<Record<string, unknown>>).map((p) => String(p.text ?? p.content ?? '')).join('');
          else if (Array.isArray(m.parts)) content = (m.parts as Array<Record<string, unknown>>).map((p) => String(p.text ?? p.content ?? '')).join('');
          out.push({ role: normRole(typeof m.role === 'string' ? m.role : undefined), content });
        }
      }
    } catch { /* malformed messages attribute — skip content */ }
  }
  return out;
}

function genAiFinishReason(attrs: OtlpKeyValue[] | undefined): string {
  const kv = attrs?.find((a) => a.key === 'gen_ai.response.finish_reasons');
  const first = kv?.value.arrayValue?.values?.[0]?.stringValue;
  return first ?? getAttrStr(attrs, 'gen_ai.response.finish_reason') ?? 'stop';
}

/** Map a GenAI span to AgentLens events, or null if it isn't a GenAI span. */
function mapGenAiSpan(
  span: OtlpSpan,
  resourceAttrs: OtlpKeyValue[] | undefined,
): MappedEvent[] | null {
  const attrs = span.attributes;
  if (!isGenAiSpan(attrs)) return null;

  const op = getAttrStr(attrs, 'gen_ai.operation.name') ?? 'chat';
  const sessionId = genAiSessionId(attrs, resourceAttrs, span.traceId);
  const agentId = genAiAgentId(attrs, resourceAttrs);
  const startTs = nanoToIso(span.startTimeUnixNano);
  const endTs = nanoToIso(span.endTimeUnixNano);
  const latencyMs = spanDurationMs(span);
  const meta = { source: 'otlp_genai', operation: op, traceId: span.traceId, spanId: span.spanId };
  const errored = span.status?.code === OTEL_STATUS_ERROR;

  if (GENAI_LLM_OPS.has(op)) {
    const provider = genAiProvider(attrs);
    const model = getAttrStr(attrs, 'gen_ai.request.model') ?? getAttrStr(attrs, 'gen_ai.response.model') ?? 'unknown';
    const responseModel = getAttrStr(attrs, 'gen_ai.response.model') ?? model;
    const inputMsgs = genAiMessages(attrs, 'gen_ai.prompt', 'gen_ai.input.messages');
    const outputMsgs = genAiMessages(attrs, 'gen_ai.completion', 'gen_ai.output.messages');
    const temperature = getAttr(attrs, 'gen_ai.request.temperature');
    const maxTokens = getAttr(attrs, 'gen_ai.request.max_tokens');
    const inputTokens = getAttrNum(attrs, 'gen_ai.usage.input_tokens');
    const outputTokens = getAttrNum(attrs, 'gen_ai.usage.output_tokens');
    // Prompt-cache tokens (#55 Thread 2). Anthropic-via-OpenLLMetry uses
    // cache_read_input_tokens / cache_creation_input_tokens; tolerate the shorter
    // cached_input_tokens some instrumentations emit.
    const cacheReadTokens =
      getAttrNum(attrs, 'gen_ai.usage.cache_read_input_tokens') ||
      getAttrNum(attrs, 'gen_ai.usage.cached_input_tokens');
    const cacheWriteTokens = getAttrNum(attrs, 'gen_ai.usage.cache_creation_input_tokens');

    // One LLM span → a paired llm_call (request, at span start) and llm_response
    // (response + token usage, at span end). The dashboard pairs them by callId.
    return [
      {
        eventType: 'llm_call', severity: 'info', sessionId, agentId,
        timestamp: startTs, metadata: meta,
        payload: {
          callId: span.spanId, provider, model,
          messages: inputMsgs.length
            ? inputMsgs
            : [{ role: 'user', content: '(prompt content not captured by instrumentation)' }],
          parameters: {
            ...(typeof temperature === 'number' ? { temperature } : {}),
            ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
          },
        },
      },
      {
        eventType: 'llm_response', severity: errored ? 'error' : 'info', sessionId, agentId,
        timestamp: endTs, metadata: meta,
        payload: {
          callId: span.spanId, provider, model: responseModel,
          completion: outputMsgs.map((m) => m.content).filter(Boolean).join('\n') || null,
          finishReason: genAiFinishReason(attrs),
          usage: {
            inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
            ...(cacheReadTokens ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
          },
          costUsd: otelCostUsd(responseModel, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
          latencyMs,
        },
      },
    ];
  }

  if (op === 'execute_tool') {
    const toolName = getAttrStr(attrs, 'gen_ai.tool.name') ?? span.name ?? 'tool';
    const callId = getAttrStr(attrs, 'gen_ai.tool.call.id') ?? span.spanId;
    let args: Record<string, unknown> = {};
    const rawArgs = getAttrStr(attrs, 'gen_ai.tool.call.arguments');
    if (rawArgs) {
      try { const p: unknown = JSON.parse(rawArgs); if (p && typeof p === 'object') args = p as Record<string, unknown>; }
      catch { args = { raw: rawArgs }; }
    }
    return [{
      eventType: 'tool_call', severity: errored ? 'error' : 'info', sessionId, agentId,
      timestamp: startTs, metadata: meta,
      payload: { callId, toolName, arguments: args },
    }];
  }

  if (op === 'embeddings') {
    return [{
      eventType: 'custom', severity: 'info', sessionId, agentId,
      timestamp: startTs, metadata: meta,
      payload: { type: 'embeddings', data: {
        provider: genAiProvider(attrs),
        model: getAttrStr(attrs, 'gen_ai.request.model') ?? 'unknown',
        inputTokens: getAttrNum(attrs, 'gen_ai.usage.input_tokens'),
        latencyMs,
      } },
    }];
  }

  if (op === 'invoke_agent' || op === 'create_agent') {
    return [{
      eventType: 'custom', severity: errored ? 'error' : 'info', sessionId, agentId,
      timestamp: startTs, metadata: meta,
      payload: { type: op, data: {
        agentName: getAttrStr(attrs, 'gen_ai.agent.name'),
        agentId: getAttrStr(attrs, 'gen_ai.agent.id'),
        description: getAttrStr(attrs, 'gen_ai.agent.description'),
        latencyMs,
      } },
    }];
  }

  // Unknown gen_ai operation → custom, preserving the raw attributes.
  return [{
    eventType: 'custom', severity: errored ? 'error' : 'info', sessionId, agentId,
    timestamp: startTs, metadata: meta,
    payload: { type: `gen_ai.${op}`, data: { ...attrsToRecord(attrs), latencyMs } },
  }];
}

/**
 * Resolve a server-authoritative verified agent id for an OTLP request (#24).
 * Prefer the agent JWT (X-Agent-Token, crypto-only, no network); fall back to a
 * longer-lived ingest key (X-Agent-Ingest-Key, verified via AgentGate with a
 * short cache) for exporters that can't refresh the 15-min token. Either yields
 * the SAME opaque verified id, distinguished only by `method` for provenance.
 */
async function resolveOtlpVerified(
  agentToken: string | undefined,
  ingestKey: string | undefined,
): Promise<{ id: string | null; method: string }> {
  const tokenId = await verifyAgentToken(agentToken);
  if (tokenId) return { id: tokenId, method: 'agentgate_token' };
  const keyId = await verifyIngestKey(ingestKey);
  if (keyId) return { id: keyId, method: 'agentgate_ingest_key' };
  return { id: null, method: 'agentgate_token' };
}

async function buildAndInsertEvents(
  tenantStore: IEventStore,
  mappedEvents: MappedEvent[],
  tenantId: string = 'default',
  verifiedAgentId: string | null = null,
  verifiedAgentMethod: string = 'agentgate_token',
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

    // Chain in chronological order (stable) with monotonic ids, so the stored
    // chain order matches how verification reads events — OTLP batches routinely
    // share timestamps. See lib/event-id.ts.
    const ordered = [...sessionMapped].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

    for (const input of ordered) {
      const id = nextEventId();
      const payload = truncatePayload(input.payload);
      // Stamp the server-verified agent id into the (server-built) metadata so it
      // is hashed like every other field and the Slice-A verified_agent_id column
      // is derived from it at insert (#88). stampVerifiedAgent also strips the
      // reserved keys, so an OTLP caller can never forge a verified id; an
      // unverified span (verifiedAgentId=null) keeps its metadata byte-for-byte.
      const metadata = stampVerifiedAgent(input.metadata, verifiedAgentId, verifiedAgentMethod);
      const hash = computeEventHash({
        id,
        timestamp: input.timestamp,
        sessionId: input.sessionId,
        agentId: input.agentId,
        eventType: input.eventType,
        severity: input.severity,
        payload,
        metadata,
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
        metadata,
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

export function otlpRoutes(
  store: IEventStore,
  config?: Partial<Pick<ServerConfig, 'otlpAuthToken' | 'otlpRateLimit' | 'multiTenantMode'>>,
  promptStore?: PromptStore | null,
) {
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
          // OTel GenAI spans (gen_ai.*) → real llm_call/llm_response/tool_call
          // events; everything else keeps the existing OpenClaw/default mapping.
          const genai = mapGenAiSpan(span, resourceAttrs);
          if (genai) {
            mapped.push(...genai);
            continue;
          }
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

    // Verification gate (#88/#24): an AgentGate agent token (X-Agent-Token) or a
    // longer-lived ingest key (X-Agent-Ingest-Key) — e.g. via
    // OTEL_EXPORTER_OTLP_HEADERS — yields a server-authoritative verified id; a
    // spoofed agentlens.agentId without a valid credential stays unverified.
    const verified = await resolveOtlpVerified(c.req.header('x-agent-token'), c.req.header('x-agent-ingest-key'));
    const inserted = await buildAndInsertEvents(tenantStore, mapped, otlpTenantId, verified.id, verified.method);
    // Auto-discover prompt templates from ingested llm_call events (best-effort).
    recordPromptFingerprints(promptStore ?? null, inserted);
    return c.json({ partialSuccess: {} }, 200);
  });

  // POST /v1/metrics
  // Normalize a metric to scalar points across sum/gauge (NumberDataPoint) and
  // histogram (HistogramDataPoint → its `sum`). Returns [] for the aggregation
  // types we don't ingest (exponentialHistogram, summary), warning once so the
  // drop is visible rather than silent.
  const metricToPoints = (metric: OtlpMetric): NormalizedMetricPoint[] => {
    const numeric = metric.sum?.dataPoints ?? metric.gauge?.dataPoints;
    if (numeric) {
      return numeric.map((dp) => ({
        value: dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : 0),
        attributes: dp.attributes,
        timeUnixNano: dp.timeUnixNano,
      }));
    }
    if (metric.histogram?.dataPoints) {
      // A histogram's summed total is the scalar we surface. Skip points with no
      // `sum` (it's optional in OTLP) rather than emit a misleading 0.
      return metric.histogram.dataPoints.flatMap((dp) =>
        dp.sum === undefined
          ? []
          : [{ value: dp.sum, attributes: dp.attributes, timeUnixNano: dp.timeUnixNano }],
      );
    }
    // Aggregation types we don't ingest. Warn once (per name, capped) — but only
    // when there's actually data, so empty metrics don't spam the log.
    const kind = metric.exponentialHistogram ? 'exponentialHistogram' : metric.summary ? 'summary' : null;
    const hasData =
      (metric.exponentialHistogram?.dataPoints?.length ?? metric.summary?.dataPoints?.length ?? 0) > 0;
    if (kind && hasData && !warnedUnsupportedMetrics.has(metric.name) && warnedUnsupportedMetrics.size < MAX_WARNED_SERVICE_NAMES) {
      warnedUnsupportedMetrics.add(metric.name);
      otlpLogger.warn(
        `OTLP ${kind} metric "${metric.name}" not ingested (only sum, gauge, and histogram are mapped).`,
      );
    }
    return [];
  };

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
          const points = metricToPoints(metric);
          // Cost is always a sum/gauge counter — never trust a histogram (or other
          // aggregation) named openclaw.cost.usd as spend; it falls through to a
          // generic otlp_metric event instead of inflating cost_tracked.
          const isCostMetric =
            metric.name === 'openclaw.cost.usd' && (metric.sum !== undefined || metric.gauge !== undefined);

          if (isCostMetric) {
            for (const p of points) {
              mapped.push({
                eventType: 'cost_tracked',
                severity: 'info',
                sessionId: getAttrStr(p.attributes, 'openclaw.sessionId') ?? 'otlp-default',
                agentId,
                timestamp: nanoToIso(p.timeUnixNano),
                metadata: { source: 'otlp_metric', metricName: metric.name },
                payload: {
                  provider: getAttrStr(p.attributes, 'openclaw.provider') ?? 'unknown',
                  model: getAttrStr(p.attributes, 'openclaw.model') ?? 'unknown',
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                  costUsd: p.value,
                },
              });
            }
          } else {
            for (const p of points) {
              mapped.push({
                eventType: 'custom',
                severity: 'info',
                sessionId: getAttrStr(p.attributes, 'openclaw.sessionId') ?? 'otlp-default',
                agentId,
                timestamp: nanoToIso(p.timeUnixNano),
                metadata: { source: 'otlp_metric', metricName: metric.name },
                payload: {
                  type: 'otlp_metric',
                  data: {
                    name: metric.name,
                    value: p.value,
                    attributes: attrsToRecord(p.attributes),
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
      const verified = await resolveOtlpVerified(c.req.header('x-agent-token'), c.req.header('x-agent-ingest-key'));
      const inserted = await buildAndInsertEvents(tenantStore, mapped, metricTenantId, verified.id, verified.method);
      // Symmetry with the traces path; metrics don't emit llm_call today, so this
      // no-ops, but keeps fingerprinting wired if that ever changes.
      recordPromptFingerprints(promptStore ?? null, inserted);
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
      const verified = await resolveOtlpVerified(c.req.header('x-agent-token'), c.req.header('x-agent-ingest-key'));
      const inserted = await buildAndInsertEvents(tenantStore, mapped, logTenantId, verified.id, verified.method);
      recordPromptFingerprints(promptStore ?? null, inserted);
    }
    return c.json({ partialSuccess: {} }, 200);
  });

  return app;
}

/**
 * Span-context stamping for OTLP ingest (#119 — nested execution traces).
 *
 * The OTLP receiver flattens each span to one-or-more events, but the
 * `trace_id → span_id ← parent_span_id` hierarchy on the wire is what explains
 * *what called what*. We preserve it by stamping the span context into each
 * event's `metadata` (already covered by `computeEventHash`), so the tree can
 * be reconstructed downstream from already-stored events — no span table.
 *
 * Ids are normalized to lowercase hex so protobuf batches (decoded to base64 by
 * `decodeProtobuf`) and JSON/OTLP batches (hex per W3C trace-context) join on a
 * single canonical representation.
 */

/**
 * Normalize an OTLP span/trace id to canonical lowercase hex.
 *
 * Valid OTLP ids are 8 bytes (span) or 16 bytes (trace): 16 / 32 hex chars, or
 * 12 / 24 base64 chars — the lengths never overlap, so length + charset tells
 * the two encodings apart unambiguously. All-zero ids (a root's absent parent,
 * filled in by protobuf `defaults:true`) and empty strings collapse to
 * `undefined` so roots have no parent link.
 */
export function toHexId(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  // OTLP/JSON: already hex (16 or 32 chars). base64 of a real id is 12/24 chars,
  // so an all-hex string of length 16/32 is unambiguously hex, not base64.
  if (/^[0-9a-fA-F]+$/.test(id) && (id.length === 16 || id.length === 32)) {
    const hex = id.toLowerCase();
    return /^0+$/.test(hex) ? undefined : hex;
  }
  // Protobuf path: `decodeProtobuf` renders bytes as base64 → convert to hex.
  try {
    const hex = Buffer.from(id, 'base64').toString('hex');
    return !hex || /^0+$/.test(hex) ? undefined : hex;
  } catch {
    return id;
  }
}

export interface SpanLike {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
}

function spanDurationMs(span: SpanLike): number | null {
  if (!span.startTimeUnixNano || !span.endTimeUnixNano) return null;
  try {
    return Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / BigInt(1_000_000));
  } catch {
    return null;
  }
}

/**
 * Build the span-context fields to merge into an event's `metadata`:
 * normalized `traceId`/`spanId`/`parentSpanId` for tree linkage, plus the raw
 * start/end nanos and derived duration for the latency waterfall. Omits keys
 * that are absent (e.g. `parentSpanId` on a root span).
 */
export function spanContextMeta(span: SpanLike): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const traceId = toHexId(span.traceId);
  const spanId = toHexId(span.spanId);
  const parentSpanId = toHexId(span.parentSpanId);
  if (traceId) meta.traceId = traceId;
  if (spanId) meta.spanId = spanId;
  if (parentSpanId) meta.parentSpanId = parentSpanId;
  if (span.startTimeUnixNano) meta.spanStartUnixNano = span.startTimeUnixNano;
  if (span.endTimeUnixNano) meta.spanEndUnixNano = span.endTimeUnixNano;
  const dur = spanDurationMs(span);
  if (dur != null) meta.spanDurationMs = dur;
  return meta;
}

/**
 * Streaming Compliance Export (Feature 9 — EU AI Act)
 *
 * Transform streams for CSV export and chunked JSON writer.
 * Handles 100K+ events without OOM via batched reading + Transform streams.
 */

import { Transform, type TransformCallback } from 'node:stream';
import type { EventRepository } from '../db/repositories/event-repository.js';

const BATCH_SIZE = 5000;
const UTF8_BOM = '\uFEFF';

// ─── CSV Escaping (RFC 4180) ────────────────────────────────

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ─── Event Row Types ────────────────────────────────────────

export type RawEventRow = {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  payload: string;
  metadata: string;
  prevHash: string | null;
  hash: string;
};

const EVENT_CSV_HEADERS = [
  'id', 'timestamp', 'session_id', 'agent_id', 'event_type',
  'severity', 'payload', 'metadata', 'prev_hash', 'hash',
];

// ─── CSV Transform Stream ───────────────────────────────────

export class CsvEventTransform extends Transform {
  private headerSent = false;

  constructor() {
    super({ objectMode: true });
  }

  _transform(row: RawEventRow, _encoding: string, callback: TransformCallback): void {
    if (!this.headerSent) {
      this.push(UTF8_BOM + EVENT_CSV_HEADERS.join(',') + '\n');
      this.headerSent = true;
    }
    const line = [
      escapeCsvField(row.id),
      escapeCsvField(row.timestamp),
      escapeCsvField(row.sessionId),
      escapeCsvField(row.agentId),
      escapeCsvField(row.eventType),
      escapeCsvField(row.severity),
      escapeCsvField(row.payload),
      escapeCsvField(row.metadata),
      escapeCsvField(row.prevHash),
      escapeCsvField(row.hash),
    ].join(',');
    this.push(line + '\n');
    callback();
  }
}

// ─── Streaming Helpers ──────────────────────────────────────

/**
 * Stream all events for a tenant+range as CSV into a writable stream.
 * Uses batched reads to avoid loading everything into memory.
 */
export async function streamEventsAsCsv(
  repo: EventRepository,
  tenantId: string,
  from: string,
  to: string,
  writable: NodeJS.WritableStream,
): Promise<number> {
  const transform = new CsvEventTransform();
  transform.pipe(writable);

  let offset = 0;
  let totalEvents = 0;

  while (true) {
    const batch = repo.getEventsBatchByTenantAndRange(tenantId, from, to, offset, BATCH_SIZE);
    if (batch.length === 0) break;

    for (const row of batch) {
      transform.write(row);
    }

    totalEvents += batch.length;
    offset += batch.length;

    if (batch.length < BATCH_SIZE) break;
  }

  transform.end();
  return totalEvents;
}

/**
 * Stream all events for a tenant+range as JSON.
 * Returns a complete JSON object with metadata.
 */
export async function streamEventsAsJson(
  repo: EventRepository,
  tenantId: string,
  from: string,
  to: string,
  writable: NodeJS.WritableStream,
): Promise<number> {
  let offset = 0;
  let totalEvents = 0;
  let first = true;

  writable.write('{"exportedAt":"' + new Date().toISOString() + '",');
  writable.write('"range":{"from":"' + from + '","to":"' + to + '"},');
  writable.write('"events":[');

  while (true) {
    const batch = repo.getEventsBatchByTenantAndRange(tenantId, from, to, offset, BATCH_SIZE);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (!first) writable.write(',');
      first = false;
      writable.write(JSON.stringify(row));
    }

    totalEvents += batch.length;
    offset += batch.length;

    if (batch.length < BATCH_SIZE) break;
  }

  writable.write('],');
  writable.write('"totalEvents":' + totalEvents + '}');

  return totalEvents;
}

/**
 * Collect all events for a tenant+range as an array (for JSON response).
 * For smaller datasets that fit in memory.
 */
export function collectAllEvents(
  repo: EventRepository,
  tenantId: string,
  from: string,
  to: string,
): RawEventRow[] {
  const allEvents: RawEventRow[] = [];
  let offset = 0;

  while (true) {
    const batch = repo.getEventsBatchByTenantAndRange(tenantId, from, to, offset, BATCH_SIZE);
    if (batch.length === 0) break;
    allEvents.push(...batch);
    offset += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  return allEvents;
}

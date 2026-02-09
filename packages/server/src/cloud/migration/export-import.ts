/**
 * Export/Import Format & Logic (S-8.3)
 *
 * Portable NDJSON format for org data export/import.
 * Each line is a self-contained JSON object with a `_type` discriminator.
 * Sessions come before their events (dependency order).
 * Checksum line at the end for integrity verification.
 */

import { createHash } from 'node:crypto';
import type { Pool } from '../tenant-pool.js';
import { withTenantTransaction, tenantQuery } from '../tenant-pool.js';

// ─── Types ───────────────────────────────────────────────────

export type RecordType = 'agent' | 'session' | 'event' | 'health_score' | 'config';

export interface ExportRecord {
  _type: RecordType;
  _version: 1;
  [key: string]: unknown;
}

export interface ExportChecksum {
  _type: 'checksum';
  sha256: string;
  counts: Record<RecordType, number>;
  exported_at: string;
}

export interface ExportOptions {
  orgId: string;
  from?: string;      // ISO date — filter events after this
  to?: string;        // ISO date — filter events before this
  agentId?: string;   // filter to a specific agent
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: number;
  errors: Array<{ line: number; error: string }>;
  checksumValid: boolean | null; // null if no checksum line present
}

// ─── Record Tables ───────────────────────────────────────────

const TABLE_MAP: Record<RecordType, string> = {
  agent: 'agents',
  session: 'sessions',
  event: 'events',
  health_score: 'health_scores',
  config: 'org_settings',
};

// ─── Export ──────────────────────────────────────────────────

/**
 * Export org data as an array of NDJSON lines (strings).
 * Streams agents → sessions → events → health_scores → config.
 * Appends a checksum record at the end.
 */
export async function exportOrgData(
  pool: Pool,
  options: ExportOptions,
): Promise<string[]> {
  const { orgId, from, to, agentId } = options;
  const lines: string[] = [];
  const counts: Record<string, number> = {};
  const hash = createHash('sha256');

  function addLine(record: ExportRecord): void {
    const json = JSON.stringify(record);
    lines.push(json);
    hash.update(json + '\n');
    counts[record._type] = (counts[record._type] ?? 0) + 1;
  }

  await withTenantTransaction(pool, orgId, async (client) => {
    // 1. Agents
    const agentWhere = agentId ? ' AND id = $1' : '';
    const agentParams = agentId ? [agentId] : [];
    const agents = await client.query(
      `SELECT * FROM agents WHERE 1=1${agentWhere} ORDER BY id`,
      agentParams,
    );
    for (const row of agents.rows as Record<string, unknown>[]) {
      addLine({ _type: 'agent', _version: 1, ...stripOrgId(row) });
    }

    // 2. Sessions
    const sessionFilters: string[] = [];
    const sessionParams: unknown[] = [];
    let paramIdx = 1;
    if (agentId) {
      sessionFilters.push(`agent_id = $${paramIdx++}`);
      sessionParams.push(agentId);
    }
    if (from) {
      sessionFilters.push(`created_at >= $${paramIdx++}`);
      sessionParams.push(from);
    }
    if (to) {
      sessionFilters.push(`created_at <= $${paramIdx++}`);
      sessionParams.push(to);
    }
    const sessionWhere = sessionFilters.length
      ? ' AND ' + sessionFilters.join(' AND ')
      : '';
    const sessions = await client.query(
      `SELECT * FROM sessions WHERE 1=1${sessionWhere} ORDER BY created_at`,
      sessionParams,
    );
    for (const row of sessions.rows as Record<string, unknown>[]) {
      addLine({ _type: 'session', _version: 1, ...stripOrgId(row) });
    }

    // Collect session IDs for event filtering
    const sessionIds = (sessions.rows as Record<string, unknown>[]).map((r) => r.id as string);

    // 3. Events (only for exported sessions)
    if (sessionIds.length > 0) {
      const eventFilters: string[] = [`session_id = ANY($1)`];
      const eventParams: unknown[] = [sessionIds];
      let eidx = 2;
      if (from) {
        eventFilters.push(`timestamp >= $${eidx++}`);
        eventParams.push(from);
      }
      if (to) {
        eventFilters.push(`timestamp <= $${eidx++}`);
        eventParams.push(to);
      }
      const events = await client.query(
        `SELECT * FROM events WHERE ${eventFilters.join(' AND ')} ORDER BY timestamp`,
        eventParams,
      );
      for (const row of events.rows as Record<string, unknown>[]) {
        addLine({ _type: 'event', _version: 1, ...stripOrgId(row) });
      }
    }

    // 4. Health scores
    const hsFilters: string[] = [];
    const hsParams: unknown[] = [];
    let hsIdx = 1;
    if (agentId) {
      hsFilters.push(`agent_id = $${hsIdx++}`);
      hsParams.push(agentId);
    }
    if (from) {
      hsFilters.push(`timestamp >= $${hsIdx++}`);
      hsParams.push(from);
    }
    if (to) {
      hsFilters.push(`timestamp <= $${hsIdx++}`);
      hsParams.push(to);
    }
    const hsWhere = hsFilters.length ? ' AND ' + hsFilters.join(' AND ') : '';
    const healthScores = await client.query(
      `SELECT * FROM health_scores WHERE 1=1${hsWhere} ORDER BY timestamp`,
      hsParams,
    );
    for (const row of healthScores.rows as Record<string, unknown>[]) {
      addLine({ _type: 'health_score', _version: 1, ...stripOrgId(row) });
    }
  });

  // Checksum line
  const checksum: ExportChecksum = {
    _type: 'checksum',
    sha256: hash.digest('hex'),
    counts: counts as Record<RecordType, number>,
    exported_at: new Date().toISOString(),
  };
  lines.push(JSON.stringify(checksum));

  return lines;
}

// ─── Import ──────────────────────────────────────────────────

/**
 * Import NDJSON lines into an org. Idempotent: existing IDs are skipped.
 * Validates checksum if present.
 */
export async function importOrgData(
  pool: Pool,
  orgId: string,
  lines: string[],
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: {},
    skipped: 0,
    errors: [],
    checksumValid: null,
  };

  // Separate data lines from checksum
  const dataLines: string[] = [];
  let checksumLine: ExportChecksum | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed._type === 'checksum') {
        checksumLine = parsed as ExportChecksum;
      } else {
        dataLines.push(line);
      }
    } catch {
      result.errors.push({ line: i + 1, error: 'Invalid JSON' });
    }
  }

  // Validate checksum
  if (checksumLine) {
    const hash = createHash('sha256');
    for (const dl of dataLines) {
      hash.update(dl + '\n');
    }
    result.checksumValid = hash.digest('hex') === checksumLine.sha256;
  }

  // Import records in dependency order: agents → sessions → events → health_scores
  const ordered = orderByDependency(dataLines, result);

  await withTenantTransaction(pool, orgId, async (client) => {
    for (const { lineNum, record } of ordered) {
      try {
        const imported = await importRecord(client, orgId, record);
        if (imported) {
          result.imported[record._type] = (result.imported[record._type] ?? 0) + 1;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push({
          line: lineNum,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────

function stripOrgId(row: Record<string, unknown>): Record<string, unknown> {
  const { org_id, ...rest } = row;
  return rest;
}

const TYPE_ORDER: Record<string, number> = {
  config: 0,
  agent: 1,
  session: 2,
  event: 3,
  health_score: 4,
};

interface OrderedRecord {
  lineNum: number;
  record: ExportRecord;
}

function orderByDependency(
  dataLines: string[],
  result: ImportResult,
): OrderedRecord[] {
  const records: OrderedRecord[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    try {
      const parsed = JSON.parse(dataLines[i]) as ExportRecord;
      if (!parsed._type || !(parsed._type in TYPE_ORDER)) {
        result.errors.push({ line: i + 1, error: `Unknown record type: ${parsed._type}` });
        continue;
      }
      records.push({ lineNum: i + 1, record: parsed });
    } catch {
      result.errors.push({ line: i + 1, error: 'Invalid JSON' });
    }
  }
  records.sort(
    (a, b) => (TYPE_ORDER[a.record._type] ?? 99) - (TYPE_ORDER[b.record._type] ?? 99),
  );
  return records;
}

/**
 * Import a single record. Returns true if inserted, false if skipped (duplicate).
 */
async function importRecord(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> },
  orgId: string,
  record: ExportRecord,
): Promise<boolean> {
  const { _type, _version, ...data } = record;

  switch (_type) {
    case 'agent': {
      const { id, name, description, created_at, updated_at } = data as Record<string, unknown>;
      const res = await client.query(
        `INSERT INTO agents (id, org_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, orgId, name ?? null, description ?? null, created_at, updated_at ?? created_at],
      );
      return (res.rowCount ?? 0) > 0;
    }
    case 'session': {
      const { id, agent_id, status, metadata, created_at, updated_at, ended_at } =
        data as Record<string, unknown>;
      const res = await client.query(
        `INSERT INTO sessions (id, org_id, agent_id, status, metadata, created_at, updated_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          id, orgId, agent_id, status ?? 'completed',
          typeof metadata === 'object' ? JSON.stringify(metadata) : metadata ?? '{}',
          created_at, updated_at ?? created_at, ended_at ?? null,
        ],
      );
      return (res.rowCount ?? 0) > 0;
    }
    case 'event': {
      const { id, session_id, type, timestamp, data: eventData, ...extra } =
        data as Record<string, unknown>;
      const res = await client.query(
        `INSERT INTO events (id, org_id, session_id, type, timestamp, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          id, orgId, session_id, type, timestamp,
          typeof eventData === 'object' ? JSON.stringify(eventData) : eventData ?? '{}',
        ],
      );
      return (res.rowCount ?? 0) > 0;
    }
    case 'health_score': {
      const { id, agent_id, timestamp, score, dimensions, metadata: hsMeta } =
        data as Record<string, unknown>;
      const res = await client.query(
        `INSERT INTO health_scores (id, org_id, agent_id, timestamp, score, dimensions, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          id, orgId, agent_id, timestamp, score,
          typeof dimensions === 'object' ? JSON.stringify(dimensions) : dimensions ?? '{}',
          typeof hsMeta === 'object' ? JSON.stringify(hsMeta) : hsMeta ?? '{}',
        ],
      );
      return (res.rowCount ?? 0) > 0;
    }
    case 'config': {
      // Config records are org-level settings — upsert
      const { key, value } = data as Record<string, unknown>;
      if (!key) return false;
      await client.query(
        `INSERT INTO org_settings (org_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [orgId, key, typeof value === 'object' ? JSON.stringify(value) : value],
      );
      return true;
    }
    default:
      return false;
  }
}

/**
 * Compute SHA-256 checksum for an array of NDJSON lines.
 */
export function computeChecksum(lines: string[]): string {
  const hash = createHash('sha256');
  for (const line of lines) {
    hash.update(line + '\n');
  }
  return hash.digest('hex');
}

/**
 * Validate that an NDJSON checksum line matches the data.
 */
export function validateChecksum(dataLines: string[], expectedSha256: string): boolean {
  return computeChecksum(dataLines) === expectedSha256;
}

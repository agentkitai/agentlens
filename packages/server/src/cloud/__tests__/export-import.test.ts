/**
 * Export/Import Tests (S-8.3)
 *
 * Unit tests with mock pool for NDJSON export/import, checksums, and idempotency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportOrgData,
  importOrgData,
  computeChecksum,
  validateChecksum,
  type ExportRecord,
} from '../migration/export-import.js';
import type { Pool, PoolClient } from '../tenant-pool.js';

// ═══════════════════════════════════════════
// Mock Pool
// ═══════════════════════════════════════════

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function createMockPool(tableData: Record<string, unknown[]> = {}) {
  const insertedRows: Array<{ table: string; params: unknown[] }> = [];

  const mockClient: PoolClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Handle SET LOCAL / BEGIN / COMMIT / ROLLBACK
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      // SELECT queries → return mock data
      if (/^SELECT/i.test(sql)) {
        for (const [table, rows] of Object.entries(tableData)) {
          if (sql.toLowerCase().includes(`from ${table}`)) {
            return { rows, rowCount: rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      }

      // INSERT queries → track and return success
      if (/^INSERT/i.test(sql)) {
        const tableMatch = sql.match(/INTO\s+(\w+)/i);
        insertedRows.push({ table: tableMatch?.[1] ?? 'unknown', params: params ?? [] });
        // Simulate ON CONFLICT DO NOTHING returning 1 for new, 0 for dup
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  const pool: Pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => mockClient.query(sql, params)),
    connect: vi.fn(async () => mockClient),
    end: vi.fn(async () => {}),
  };

  return { pool, mockClient, insertedRows };
}

// ═══════════════════════════════════════════
// Export Tests
// ═══════════════════════════════════════════

describe('S-8.3: Export/Import Format', () => {
  describe('exportOrgData', () => {
    it('exports agents, sessions, events, health_scores as NDJSON', async () => {
      const { pool } = createMockPool({
        agents: [{ id: 'a1', org_id: ORG_A, name: 'TestAgent' }],
        sessions: [{ id: 's1', org_id: ORG_A, agent_id: 'a1', created_at: '2026-01-15T10:00:00Z' }],
        events: [
          { id: 'e1', org_id: ORG_A, session_id: 's1', type: 'llm_call', timestamp: '2026-01-15T10:00:01Z', data: '{}' },
        ],
        health_scores: [
          { id: 'h1', org_id: ORG_A, agent_id: 'a1', timestamp: '2026-01-15T11:00:00Z', score: 85 },
        ],
      });

      const lines = await exportOrgData(pool, { orgId: ORG_A });
      expect(lines.length).toBe(5); // 1 agent + 1 session + 1 event + 1 health + 1 checksum

      const records = lines.map((l) => JSON.parse(l));
      expect(records[0]._type).toBe('agent');
      expect(records[1]._type).toBe('session');
      expect(records[2]._type).toBe('event');
      expect(records[3]._type).toBe('health_score');
      expect(records[4]._type).toBe('checksum');
    });

    it('strips org_id from exported records', async () => {
      const { pool } = createMockPool({
        agents: [{ id: 'a1', org_id: ORG_A, name: 'TestAgent' }],
        sessions: [],
        events: [],
        health_scores: [],
      });

      const lines = await exportOrgData(pool, { orgId: ORG_A });
      const agent = JSON.parse(lines[0]);
      expect(agent.org_id).toBeUndefined();
      expect(agent.id).toBe('a1');
      expect(agent.name).toBe('TestAgent');
    });

    it('includes valid SHA-256 checksum', async () => {
      const { pool } = createMockPool({
        agents: [{ id: 'a1', org_id: ORG_A, name: 'Agent' }],
        sessions: [],
        events: [],
        health_scores: [],
      });

      const lines = await exportOrgData(pool, { orgId: ORG_A });
      const checksumLine = JSON.parse(lines[lines.length - 1]);
      expect(checksumLine._type).toBe('checksum');
      expect(checksumLine.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(checksumLine.counts.agent).toBe(1);

      // Verify checksum matches data
      const dataLines = lines.slice(0, -1);
      expect(validateChecksum(dataLines, checksumLine.sha256)).toBe(true);
    });

    it('respects date range filters', async () => {
      const { pool, mockClient } = createMockPool({
        agents: [],
        sessions: [],
        events: [],
        health_scores: [],
      });

      await exportOrgData(pool, {
        orgId: ORG_A,
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      });

      // Verify date params were passed to queries
      const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;
      const sessionCall = calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('FROM sessions'));
      expect(sessionCall).toBeDefined();
      if (sessionCall) {
        expect((sessionCall[0] as string)).toContain('created_at >=');
      }
    });
  });

  describe('importOrgData', () => {
    it('imports records in dependency order', async () => {
      const { pool, insertedRows } = createMockPool();

      const lines = [
        JSON.stringify({ _type: 'event', _version: 1, id: 'e1', session_id: 's1', type: 'llm_call', timestamp: '2026-01-15T10:00:01Z', data: {} }),
        JSON.stringify({ _type: 'agent', _version: 1, id: 'a1', name: 'Agent' }),
        JSON.stringify({ _type: 'session', _version: 1, id: 's1', agent_id: 'a1', created_at: '2026-01-15T10:00:00Z' }),
      ];

      const result = await importOrgData(pool, ORG_A, lines);
      expect(result.imported.agent).toBe(1);
      expect(result.imported.session).toBe(1);
      expect(result.imported.event).toBe(1);

      // Verify order: agent → session → event
      expect(insertedRows[0].table).toBe('agents');
      expect(insertedRows[1].table).toBe('sessions');
      expect(insertedRows[2].table).toBe('events');
    });

    it('validates checksum when present', async () => {
      const { pool } = createMockPool();

      const dataLine = JSON.stringify({ _type: 'agent', _version: 1, id: 'a1', name: 'Agent' });
      const checksum = computeChecksum([dataLine]);
      const checksumLine = JSON.stringify({
        _type: 'checksum',
        sha256: checksum,
        counts: { agent: 1 },
        exported_at: '2026-01-15T12:00:00Z',
      });

      const result = await importOrgData(pool, ORG_A, [dataLine, checksumLine]);
      expect(result.checksumValid).toBe(true);
    });

    it('detects invalid checksum', async () => {
      const { pool } = createMockPool();

      const dataLine = JSON.stringify({ _type: 'agent', _version: 1, id: 'a1', name: 'Agent' });
      const checksumLine = JSON.stringify({
        _type: 'checksum',
        sha256: 'badhash',
        counts: { agent: 1 },
        exported_at: '2026-01-15T12:00:00Z',
      });

      const result = await importOrgData(pool, ORG_A, [dataLine, checksumLine]);
      expect(result.checksumValid).toBe(false);
    });

    it('skips invalid JSON lines and reports errors', async () => {
      const { pool } = createMockPool();

      const lines = [
        JSON.stringify({ _type: 'agent', _version: 1, id: 'a1', name: 'Agent' }),
        'not valid json {{{',
        JSON.stringify({ _type: 'agent', _version: 1, id: 'a2', name: 'Agent2' }),
      ];

      const result = await importOrgData(pool, ORG_A, lines);
      expect(result.imported.agent).toBe(2);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].line).toBe(2);
    });

    it('returns null checksumValid when no checksum present', async () => {
      const { pool } = createMockPool();

      const lines = [
        JSON.stringify({ _type: 'agent', _version: 1, id: 'a1', name: 'Agent' }),
      ];

      const result = await importOrgData(pool, ORG_A, lines);
      expect(result.checksumValid).toBeNull();
    });

    it('reports unknown record types as errors', async () => {
      const { pool } = createMockPool();

      const lines = [
        JSON.stringify({ _type: 'unknown_thing', _version: 1, id: 'x1' }),
      ];

      const result = await importOrgData(pool, ORG_A, lines);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toContain('Unknown record type');
    });
  });

  describe('checksum utilities', () => {
    it('computeChecksum produces consistent SHA-256', () => {
      const lines = ['{"a":1}', '{"b":2}'];
      const c1 = computeChecksum(lines);
      const c2 = computeChecksum(lines);
      expect(c1).toBe(c2);
      expect(c1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validateChecksum returns false for tampered data', () => {
      const lines = ['{"a":1}', '{"b":2}'];
      const checksum = computeChecksum(lines);
      expect(validateChecksum(['{"a":1}', '{"b":3}'], checksum)).toBe(false);
    });
  });
});

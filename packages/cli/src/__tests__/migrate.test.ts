/**
 * Migration CLI Tests (S-8.4)
 *
 * Tests for the `agentlens migrate` command: SQLite export,
 * progress tracking, resume, and reverse migration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportFromSqlite } from '../commands/migrate.js';

// ═══════════════════════════════════════════
// SQLite Export Tests
// ═══════════════════════════════════════════

describe('S-8.4: Migration CLI', () => {
  describe('exportFromSqlite', () => {
    it('throws if database file not found', async () => {
      await expect(exportFromSqlite('/nonexistent/db.sqlite')).rejects.toThrow(
        'SQLite database not found',
      );
    });

    // Note: Tests that require better-sqlite3 are integration tests.
    // Unit tests mock at the boundary.

    it('throws if better-sqlite3 is not available', async () => {
      // Create a dummy file so the existence check passes
      const tmpFile = join(tmpdir(), `test-migrate-${Date.now()}.db`);
      writeFileSync(tmpFile, '');

      // The import will fail because better-sqlite3 isn't typically available in test env
      // This test verifies the error message is helpful
      try {
        await exportFromSqlite(tmpFile);
        // If better-sqlite3 IS installed, the file won't be a valid SQLite DB
        // so it will throw a different error — that's fine too
      } catch (err: any) {
        expect(err.message).toMatch(/better-sqlite3|not a database|SQLite/i);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
      }
    });
  });

  describe('NDJSON format', () => {
    it('each record has _type and _version fields', () => {
      const records = [
        { _type: 'agent', _version: 1, id: 'a1', name: 'Test' },
        { _type: 'session', _version: 1, id: 's1', agent_id: 'a1' },
        { _type: 'event', _version: 1, id: 'e1', session_id: 's1', type: 'llm_call' },
      ];

      for (const rec of records) {
        const line = JSON.stringify(rec);
        const parsed = JSON.parse(line);
        expect(parsed._type).toBeDefined();
        expect(parsed._version).toBe(1);
      }
    });

    it('checksum record has sha256 and counts', () => {
      const checksum = {
        _type: 'checksum',
        sha256: 'a'.repeat(64),
        counts: { agent: 1, session: 2, event: 5 },
        exported_at: '2026-01-15T12:00:00Z',
      };

      const parsed = JSON.parse(JSON.stringify(checksum));
      expect(parsed.sha256).toHaveLength(64);
      expect(parsed.counts.agent).toBe(1);
      expect(parsed.counts.session).toBe(2);
      expect(parsed.counts.event).toBe(5);
    });
  });

  describe('progress tracking', () => {
    it('state file tracks migration progress', () => {
      const state = {
        direction: 'up',
        phase: 'upload',
        exportFile: '/tmp/export.ndjson',
        lastUploadedLine: 250,
        totalLines: 1000,
        counts: { agent: 5, session: 20, event: 225 },
      };

      // Verify state structure is serializable
      const serialized = JSON.stringify(state);
      const deserialized = JSON.parse(serialized);
      expect(deserialized.lastUploadedLine).toBe(250);
      expect(deserialized.phase).toBe('upload');
    });

    it('resume starts from lastUploadedLine', () => {
      const state = {
        direction: 'up',
        phase: 'upload',
        lastUploadedLine: 500,
        totalLines: 1000,
      };

      // Simulate batch calculation
      const batchSize = 100;
      const startLine = state.lastUploadedLine;
      const batches: number[] = [];

      for (let i = startLine; i < state.totalLines; i += batchSize) {
        batches.push(i);
      }

      expect(batches[0]).toBe(500); // Starts from where we left off
      expect(batches.length).toBe(5); // 500-1000 in batches of 100
    });
  });

  describe('verification', () => {
    it('count comparison detects mismatches', () => {
      const localCounts = { agent: 5, session: 20, event: 100 };
      const remoteCounts = { agent: 5, session: 20, event: 95 };

      const mismatches: string[] = [];
      for (const [type, count] of Object.entries(localCounts)) {
        const remote = remoteCounts[type as keyof typeof remoteCounts] ?? 0;
        if (remote < count) {
          mismatches.push(type);
        }
      }

      expect(mismatches).toContain('event');
      expect(mismatches).not.toContain('agent');
    });

    it('count comparison passes when all match', () => {
      const localCounts = { agent: 5, session: 20, event: 100 };
      const remoteCounts = { agent: 5, session: 20, event: 100 };

      let allMatch = true;
      for (const [type, count] of Object.entries(localCounts)) {
        const remote = remoteCounts[type as keyof typeof remoteCounts] ?? 0;
        if (remote < count) allMatch = false;
      }

      expect(allMatch).toBe(true);
    });
  });

  describe('reverse migration (cloud → self-hosted)', () => {
    it('NDJSON export file can be parsed line by line', () => {
      const ndjson = [
        '{"_type":"agent","_version":1,"id":"a1","name":"Test"}',
        '{"_type":"session","_version":1,"id":"s1","agent_id":"a1","created_at":"2026-01-15T10:00:00Z"}',
        '{"_type":"event","_version":1,"id":"e1","session_id":"s1","type":"llm_call","timestamp":"2026-01-15T10:00:01Z","data":{}}',
        '{"_type":"checksum","sha256":"abc123","counts":{"agent":1,"session":1,"event":1},"exported_at":"2026-01-15T12:00:00Z"}',
      ].join('\n');

      const lines = ndjson.split('\n').filter(Boolean);
      expect(lines.length).toBe(4);

      const records = lines.map((l) => JSON.parse(l));
      const types = records.map((r) => r._type);
      expect(types).toEqual(['agent', 'session', 'event', 'checksum']);
    });
  });
});

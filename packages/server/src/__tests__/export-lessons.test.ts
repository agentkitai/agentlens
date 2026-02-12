/**
 * Export Lessons Script Tests
 *
 * Tests the AgentLens → Lore lesson export logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mapLesson, exportLessons, type AgentLensLesson } from '../../scripts/export-lessons.js';

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function createTestDb(dir: string): string {
  const dbPath = join(dir, 'test.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE lessons (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      agent_id TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      importance TEXT NOT NULL DEFAULT 'normal',
      source_session_id TEXT,
      source_event_id TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      PRIMARY KEY (id, tenant_id)
    )
  `);
  db.close();
  return dbPath;
}

function insertLesson(dbPath: string, overrides: Partial<AgentLensLesson> = {}) {
  const db = new Database(dbPath);
  const lesson: AgentLensLesson = {
    id: 'lesson-1',
    tenant_id: 'tenant-1',
    agent_id: null,
    category: 'error-handling',
    title: 'Always retry on 503',
    content: 'When a 503 is received, retry with exponential backoff up to 3 times.',
    context: '{}',
    importance: 'high',
    source_session_id: 'sess-1',
    source_event_id: null,
    access_count: 5,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
    archived_at: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO lessons (id, tenant_id, agent_id, category, title, content, context, importance,
      source_session_id, source_event_id, access_count, created_at, updated_at, archived_at)
    VALUES (@id, @tenant_id, @agent_id, @category, @title, @content, @context, @importance,
      @source_session_id, @source_event_id, @access_count, @created_at, @updated_at, @archived_at)
  `).run(lesson);
  db.close();
}

// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'export-lessons-'));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
});

describe('mapLesson', () => {
  it('maps title → problem, content → resolution', () => {
    const result = mapLesson({
      id: '1', tenant_id: 't1', agent_id: null, category: 'general',
      title: 'My Problem', content: 'My Solution', context: '{}',
      importance: 'normal', source_session_id: null, source_event_id: null,
      access_count: 0, created_at: '', updated_at: '', archived_at: null,
    });
    expect(result.problem).toBe('My Problem');
    expect(result.resolution).toBe('My Solution');
  });

  it('maps category to tags', () => {
    const result = mapLesson({
      id: '1', tenant_id: 't1', agent_id: 'agent-x', category: 'debugging',
      title: 'T', content: 'C', context: '{}',
      importance: 'normal', source_session_id: null, source_event_id: null,
      access_count: 0, created_at: '', updated_at: '', archived_at: null,
    });
    expect(result.tags).toContain('debugging');
    expect(result.tags).toContain('agent:agent-x');
  });

  it('maps importance to confidence', () => {
    const cases = [
      { importance: 'critical', expected: 1.0 },
      { importance: 'high', expected: 0.85 },
      { importance: 'normal', expected: 0.7 },
      { importance: 'low', expected: 0.5 },
    ];
    for (const { importance, expected } of cases) {
      const result = mapLesson({
        id: '1', tenant_id: 't1', agent_id: null, category: 'general',
        title: 'T', content: 'C', context: '{}',
        importance, source_session_id: null, source_event_id: null,
        access_count: 0, created_at: '', updated_at: '', archived_at: null,
      });
      expect(result.confidence).toBe(expected);
    }
  });

  it('handles malformed context JSON gracefully', () => {
    const result = mapLesson({
      id: '1', tenant_id: 't1', agent_id: null, category: 'general',
      title: 'T', content: 'C', context: 'not-json',
      importance: 'normal', source_session_id: null, source_event_id: null,
      access_count: 0, created_at: '', updated_at: '', archived_at: null,
    });
    expect(result.metadata).not.toHaveProperty('context');
  });
});

describe('exportLessons', () => {
  it('exports lessons with correct structure', () => {
    const dbPath = createTestDb(tmpDir);
    insertLesson(dbPath);
    insertLesson(dbPath, { id: 'lesson-2', title: 'Use timeouts', content: 'Always set timeouts on HTTP calls.' });

    const result = exportLessons(dbPath);
    expect(result.version).toBe('1.0');
    expect(result.exported_at).toBeTruthy();
    expect(result.lessons).toHaveLength(2);
    expect(result.lessons[0].problem).toBe('Always retry on 503');
    expect(result.lessons[0].source).toBe('agentlens-export');
  });

  it('excludes archived lessons', () => {
    const dbPath = createTestDb(tmpDir);
    insertLesson(dbPath);
    insertLesson(dbPath, { id: 'lesson-archived', title: 'Old', content: 'Old content', archived_at: '2026-01-10T00:00:00Z' });

    const result = exportLessons(dbPath);
    expect(result.lessons).toHaveLength(1);
  });

  it('handles empty database', () => {
    const dbPath = createTestDb(tmpDir);
    const result = exportLessons(dbPath);
    expect(result.lessons).toHaveLength(0);
    expect(result.version).toBe('1.0');
  });

  it('preserves metadata from original lessons', () => {
    const dbPath = createTestDb(tmpDir);
    insertLesson(dbPath, { context: '{"env":"production"}' });

    const result = exportLessons(dbPath);
    const meta = result.lessons[0].metadata as Record<string, unknown>;
    expect(meta.original_id).toBe('lesson-1');
    expect(meta.tenant_id).toBe('tenant-1');
    expect(meta.access_count).toBe(5);
    expect(meta.context).toEqual({ env: 'production' });
  });
});

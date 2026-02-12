#!/usr/bin/env tsx
/**
 * Export lessons from AgentLens SQLite to Lore-compatible JSON format.
 * Usage: tsx scripts/export-lessons.ts [--db ./agentlens.db] [--out lessons.json]
 */

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface AgentLensLesson {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  category: string;
  title: string;
  content: string;
  context: string;
  importance: string;
  source_session_id: string | null;
  source_event_id: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface LoreLesson {
  problem: string;
  resolution: string;
  tags: string[];
  confidence: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface LoreExport {
  version: '1.0';
  exported_at: string;
  lessons: LoreLesson[];
}

// ═══════════════════════════════════════════
// Mapping
// ═══════════════════════════════════════════

const IMPORTANCE_TO_CONFIDENCE: Record<string, number> = {
  critical: 1.0,
  high: 0.85,
  normal: 0.7,
  low: 0.5,
};

export function mapLesson(lesson: AgentLensLesson): LoreLesson {
  let context: Record<string, unknown> = {};
  try {
    context = JSON.parse(lesson.context);
  } catch {
    // ignore malformed context
  }

  return {
    problem: lesson.title,
    resolution: lesson.content,
    tags: [lesson.category, ...(lesson.agent_id ? [`agent:${lesson.agent_id}`] : [])],
    confidence: IMPORTANCE_TO_CONFIDENCE[lesson.importance] ?? 0.7,
    source: 'agentlens-export',
    metadata: {
      original_id: lesson.id,
      tenant_id: lesson.tenant_id,
      source_session_id: lesson.source_session_id,
      access_count: lesson.access_count,
      created_at: lesson.created_at,
      ...(Object.keys(context).length > 0 ? { context } : {}),
    },
  };
}

export function exportLessons(dbPath: string): LoreExport {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare('SELECT * FROM lessons WHERE archived_at IS NULL').all() as AgentLensLesson[];
    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      lessons: rows.map(mapLesson),
    };
  } finally {
    db.close();
  }
}

// ═══════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  let dbPath = './agentlens.db';
  let outPath = 'lessons.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) dbPath = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outPath = args[++i];
    else if (args[i] === '--help') {
      console.log('Usage: tsx scripts/export-lessons.ts [--db ./agentlens.db] [--out lessons.json]');
      process.exit(0);
    }
  }

  console.log(`Exporting lessons from ${dbPath}...`);
  const result = exportLessons(dbPath);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Exported ${result.lessons.length} lessons to ${outPath}`);
}

// Run CLI if executed directly
const isDirectRun = process.argv[1]?.endsWith('export-lessons.ts') || process.argv[1]?.endsWith('export-lessons');
if (isDirectRun) {
  main();
}

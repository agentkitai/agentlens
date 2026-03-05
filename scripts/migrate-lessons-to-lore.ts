#!/usr/bin/env npx tsx
/**
 * One-time migration: AgentLens SQLite lessons → Lore v0.5.0
 *
 * Usage:
 *   npx tsx scripts/migrate-lessons-to-lore.ts \
 *     --db ./data/agentlens.db \
 *     --lore-url http://localhost:8765 \
 *     --lore-key <api-key> \
 *     [--dry-run]
 *
 * Environment variables:
 *   AGENTLENS_DB_PATH, LORE_API_URL, LORE_API_KEY
 */

import Database from 'better-sqlite3';

// ─── CLI Argument Parsing ────────────────────────────────

function parseArgs(): { dbPath: string; loreUrl: string; loreKey: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let dbPath = process.env.AGENTLENS_DB_PATH ?? '';
  let loreUrl = process.env.LORE_API_URL ?? '';
  let loreKey = process.env.LORE_API_KEY ?? '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) { dbPath = args[++i]!; continue; }
    if (args[i] === '--lore-url' && args[i + 1]) { loreUrl = args[++i]!; continue; }
    if (args[i] === '--lore-key' && args[i + 1]) { loreKey = args[++i]!; continue; }
    if (args[i] === '--dry-run') { dryRun = true; continue; }
  }

  if (!dbPath) { console.error('Missing --db or AGENTLENS_DB_PATH'); process.exit(1); }
  if (!loreUrl) { console.error('Missing --lore-url or LORE_API_URL'); process.exit(1); }
  if (!loreKey) { console.error('Missing --lore-key or LORE_API_KEY'); process.exit(1); }

  return { dbPath, loreUrl: loreUrl.replace(/\/$/, ''), loreKey, dryRun };
}

// ─── SQLite Reader ───────────────────────────────────────

interface LessonRow {
  id: string;
  title: string;
  content: string;
  category: string | null;
  importance: string | null;
  agentId: string | null;
  context: string | null;
  createdAt: string;
  updatedAt: string;
}

function readLessons(dbPath: string): LessonRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id, title, content, category, importance, agentId,
           context, createdAt, updatedAt
    FROM lessons
  `).all() as LessonRow[];
  db.close();
  return rows;
}

// ─── Field Mapping ───────────────────────────────────────

export function mapLessonToLore(row: LessonRow): {
  problem: string;
  resolution: string;
  tags: string[];
  confidence: number;
  source: string | undefined;
  meta: Record<string, unknown>;
} {
  const tags: string[] = [];
  if (row.category) tags.push(row.category);

  const meta: Record<string, unknown> = { type: 'lesson' };
  if (row.importance) meta.importance = row.importance;
  if (row.agentId) meta.agentId = row.agentId;

  let ctx: Record<string, unknown> | undefined;
  if (row.context) {
    try { ctx = JSON.parse(row.context); } catch { /* ignore */ }
  }
  if (ctx && Object.keys(ctx).length > 0) meta.context = ctx;

  return {
    problem: row.title,
    resolution: row.content,
    tags,
    confidence: 0.5,
    source: row.agentId ?? undefined,
    meta,
  };
}

// ─── Lore API Caller ─────────────────────────────────────

async function createLoreLesson(
  loreUrl: string,
  loreKey: string,
  body: ReturnType<typeof mapLessonToLore>,
): Promise<string> {
  const res = await fetch(`${loreUrl}/v1/lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loreKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  const { dbPath, loreUrl, loreKey, dryRun } = parseArgs();

  console.log(`Reading lessons from: ${dbPath}`);
  const lessons = readLessons(dbPath);
  console.log(`Found ${lessons.length} lesson(s)`);

  if (dryRun) {
    console.log('\n--- DRY RUN (no changes will be made) ---\n');
  }

  let imported = 0;
  let failed = 0;
  const createdIds: string[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const lesson of lessons) {
    const mapped = mapLessonToLore(lesson);

    if (dryRun) {
      console.log(`[DRY] ${lesson.id}: "${lesson.title}" → problem="${mapped.problem}", tags=${JSON.stringify(mapped.tags)}`);
      imported++;
      continue;
    }

    try {
      const loreId = await createLoreLesson(loreUrl, loreKey, mapped);
      createdIds.push(loreId);
      imported++;
      console.log(`[OK] ${lesson.id} → ${loreId}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ id: lesson.id, error: msg });
      console.error(`[FAIL] ${lesson.id}: ${msg}`);
    }
  }

  // Summary
  console.log(`\n--- Summary ---`);
  console.log(`Total:    ${lessons.length}`);
  console.log(`Imported: ${imported}`);
  console.log(`Failed:   ${failed}`);

  if (createdIds.length > 0) {
    console.log(`\nCreated Lore IDs (for rollback):`);
    createdIds.forEach((id) => console.log(`  ${id}`));
  }

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach((f) => console.log(`  ${f.id}: ${f.error}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

/**
 * agentlens migrate — Self-Hosted ↔ Cloud Migration (S-8.4)
 *
 * Reads from local SQLite, transforms to cloud NDJSON format,
 * and uploads via cloud API. Supports resume on failure and
 * reverse migration (cloud → self-hosted export → SQLite import).
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { loadConfig } from '../lib/config.js';

// ─── Types ───────────────────────────────────────────────────

export interface MigrateOptions {
  direction: 'up' | 'down';   // up = self-hosted → cloud, down = cloud → self-hosted
  sqlitePath?: string;         // path to local SQLite DB
  cloudUrl?: string;           // cloud API URL
  apiKey?: string;             // cloud API key
  batchSize?: number;          // records per upload batch
  resumeFile?: string;         // state file for resume
}

export interface MigrateState {
  direction: string;
  phase: 'export' | 'upload' | 'verify' | 'done';
  exportFile?: string;
  lastUploadedLine: number;
  totalLines: number;
  counts: Record<string, number>;
}

interface SqliteRow {
  [key: string]: unknown;
}

const STATE_DIR = join(homedir(), '.agentlens');
const DEFAULT_STATE_FILE = join(STATE_DIR, 'migrate-state.json');
const DEFAULT_SQLITE_PATH = join(process.cwd(), 'agentlens.db');

// ─── Main Command ────────────────────────────────────────────

export async function runMigrateCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'up':
      await migrateUp(args.slice(1));
      break;
    case 'down':
      await migrateDown(args.slice(1));
      break;
    case 'status':
      showMigrateStatus();
      break;
    case 'clean':
      cleanMigrateState();
      break;
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Unknown migrate subcommand: ${subcommand}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`agentlens migrate — Self-Hosted ↔ Cloud Migration

Usage:
  agentlens migrate up [options]     Migrate self-hosted SQLite → Cloud
  agentlens migrate down [options]   Export Cloud → local NDJSON file
  agentlens migrate status           Show current migration state
  agentlens migrate clean            Remove migration state file

Options (up):
  --db <path>          SQLite database path (default: ./agentlens.db)
  --batch-size <n>     Records per upload batch (default: 500)
  --resume             Resume a previously interrupted migration

Options (down):
  --output <path>      Output NDJSON file (default: ./agentlens-export.ndjson)

Common:
  --url <url>          Cloud API URL (overrides config)
  --api-key <key>      Cloud API key (overrides config)
`);
}

// ─── Migrate Up (Self-Hosted → Cloud) ────────────────────────

async function migrateUp(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const sqlitePath = options['db'] ?? DEFAULT_SQLITE_PATH;
  const batchSize = parseInt(options['batch-size'] ?? '500', 10);
  const resume = args.includes('--resume');
  const config = loadConfig();
  const cloudUrl = options['url'] ?? config.url;
  const apiKey = options['api-key'] ?? config.apiKey;

  if (!apiKey) {
    console.error('Error: API key required. Set via `agentlens config set api-key <key>` or --api-key');
    process.exit(1);
  }

  // Check for resume state
  let state: MigrateState | null = null;
  if (resume && existsSync(DEFAULT_STATE_FILE)) {
    state = JSON.parse(readFileSync(DEFAULT_STATE_FILE, 'utf-8'));
    console.log(`Resuming migration from line ${state!.lastUploadedLine}/${state!.totalLines}`);
  }

  // Phase 1: Export from SQLite
  let ndjsonLines: string[];
  if (state?.exportFile && existsSync(state.exportFile)) {
    console.log('Using cached export file...');
    ndjsonLines = readFileSync(state.exportFile, 'utf-8').split('\n').filter(Boolean);
  } else {
    console.log(`Exporting from SQLite: ${sqlitePath}`);
    ndjsonLines = await exportFromSqlite(sqlitePath);
    // Cache export
    const exportFile = join(STATE_DIR, 'migrate-export.ndjson');
    writeFileSync(exportFile, ndjsonLines.join('\n') + '\n', 'utf-8');
    state = {
      direction: 'up',
      phase: 'upload',
      exportFile,
      lastUploadedLine: 0,
      totalLines: ndjsonLines.length,
      counts: {},
    };
    saveState(state);
    console.log(`Exported ${ndjsonLines.length} records`);
  }

  // Phase 2: Upload to cloud in batches
  const startLine = state?.lastUploadedLine ?? 0;
  const total = ndjsonLines.length;
  let uploaded = startLine;

  for (let i = startLine; i < total; i += batchSize) {
    const batch = ndjsonLines.slice(i, Math.min(i + batchSize, total));
    const progress = Math.min(100, Math.round(((i + batch.length) / total) * 100));

    process.stdout.write(`\rUploading... ${progressBar(progress)} ${progress}% (${i + batch.length}/${total})`);

    await uploadBatch(cloudUrl, apiKey, batch);
    uploaded = i + batch.length;

    // Save progress for resume
    state!.lastUploadedLine = uploaded;
    saveState(state!);
  }

  console.log('\n');

  // Phase 3: Verify
  state!.phase = 'verify';
  saveState(state!);
  console.log('Verifying migration...');

  const verified = await verifyMigration(cloudUrl, apiKey, ndjsonLines);
  if (verified) {
    console.log('✅ Migration verified successfully!');
    state!.phase = 'done';
    saveState(state!);
  } else {
    console.log('⚠️  Verification found count mismatches. Run `agentlens migrate status` for details.');
  }
}

// ─── Migrate Down (Cloud → Self-Hosted) ─────────────────────

async function migrateDown(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const outputPath = options['output'] ?? join(process.cwd(), 'agentlens-export.ndjson');
  const config = loadConfig();
  const cloudUrl = options['url'] ?? config.url;
  const apiKey = options['api-key'] ?? config.apiKey;

  if (!apiKey) {
    console.error('Error: API key required.');
    process.exit(1);
  }

  console.log('Exporting from cloud...');
  const response = await fetch(`${cloudUrl}/v1/export`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/x-ndjson',
    },
  });

  if (!response.ok) {
    console.error(`Export failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const body = await response.text();
  writeFileSync(outputPath, body, 'utf-8');

  const lineCount = body.split('\n').filter(Boolean).length;
  console.log(`✅ Exported ${lineCount} records to ${outputPath}`);
}

// ─── Status & Clean ──────────────────────────────────────────

function showMigrateStatus(): void {
  if (!existsSync(DEFAULT_STATE_FILE)) {
    console.log('No migration in progress.');
    return;
  }
  const state: MigrateState = JSON.parse(readFileSync(DEFAULT_STATE_FILE, 'utf-8'));
  console.log(`Migration status:
  Direction: ${state.direction}
  Phase: ${state.phase}
  Progress: ${state.lastUploadedLine}/${state.totalLines} records
  ${state.phase === 'done' ? '✅ Complete' : '⏳ In progress'}`);
}

function cleanMigrateState(): void {
  if (existsSync(DEFAULT_STATE_FILE)) {
    unlinkSync(DEFAULT_STATE_FILE);
    console.log('Migration state cleaned.');
  } else {
    console.log('No migration state to clean.');
  }
}

// ─── SQLite Export ───────────────────────────────────────────

/**
 * Read from local SQLite and produce NDJSON lines.
 * Uses dynamic import for better-sqlite3 so it's optional.
 */
export async function exportFromSqlite(dbPath: string): Promise<string[]> {
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  // Dynamic import — better-sqlite3 is optional dep
  let Database: any;
  try {
    const modName = 'better-sqlite3';
    const mod = await import(modName);
    Database = mod.default ?? mod;
  } catch {
    throw new Error(
      'better-sqlite3 is required for SQLite migration. Install it: npm install better-sqlite3',
    );
  }

  const db = new Database(dbPath, { readonly: true });
  const lines: string[] = [];

  try {
    // Agents
    const agents = safeAll(db, 'SELECT * FROM agents ORDER BY id');
    for (const row of agents) {
      lines.push(JSON.stringify({ _type: 'agent', _version: 1, ...row }));
    }

    // Sessions
    const sessions = safeAll(db, 'SELECT * FROM sessions ORDER BY created_at');
    for (const row of sessions) {
      lines.push(JSON.stringify({ _type: 'session', _version: 1, ...parseJsonFields(row, ['metadata']) }));
    }

    // Events
    const events = safeAll(db, 'SELECT * FROM events ORDER BY timestamp');
    for (const row of events) {
      lines.push(JSON.stringify({ _type: 'event', _version: 1, ...parseJsonFields(row, ['data']) }));
    }

    // Health scores
    const healthScores = safeAll(db, 'SELECT * FROM health_scores ORDER BY timestamp');
    for (const row of healthScores) {
      lines.push(
        JSON.stringify({ _type: 'health_score', _version: 1, ...parseJsonFields(row, ['dimensions', 'metadata']) }),
      );
    }
  } finally {
    db.close();
  }

  // Add checksum
  const hash = createHash('sha256');
  for (const line of lines) {
    hash.update(line + '\n');
  }
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const type = JSON.parse(line)._type;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  lines.push(
    JSON.stringify({
      _type: 'checksum',
      sha256: hash.digest('hex'),
      counts,
      exported_at: new Date().toISOString(),
    }),
  );

  return lines;
}

// ─── Upload Helpers ──────────────────────────────────────────

async function uploadBatch(cloudUrl: string, apiKey: string, lines: string[]): Promise<void> {
  const body = lines.join('\n') + '\n';
  const response = await fetch(`${cloudUrl}/v1/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-ndjson',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Upload failed: ${response.status} ${response.statusText} ${text}`);
  }
}

async function verifyMigration(
  cloudUrl: string,
  apiKey: string,
  ndjsonLines: string[],
): Promise<boolean> {
  // Count local records by type
  const localCounts: Record<string, number> = {};
  for (const line of ndjsonLines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed._type && parsed._type !== 'checksum') {
        localCounts[parsed._type] = (localCounts[parsed._type] ?? 0) + 1;
      }
    } catch { /* skip */ }
  }

  try {
    const response = await fetch(`${cloudUrl}/v1/export/counts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return false;
    const remoteCounts = (await response.json()) as Record<string, number>;

    let allMatch = true;
    for (const [type, count] of Object.entries(localCounts)) {
      const remote = remoteCounts[type] ?? 0;
      if (remote < count) {
        console.log(`  ⚠️  ${type}: local=${count}, cloud=${remote}`);
        allMatch = false;
      } else {
        console.log(`  ✓ ${type}: ${remote} records`);
      }
    }
    return allMatch;
  } catch {
    console.log('  Could not verify (API error). Check manually.');
    return false;
  }
}

// ─── Utility ─────────────────────────────────────────────────

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5);
  return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + ']';
}

function saveState(state: MigrateState): void {
  const { mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(DEFAULT_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

function safeAll(db: any, sql: string): SqliteRow[] {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

function parseJsonFields(row: SqliteRow, fields: string[]): SqliteRow {
  const result = { ...row };
  for (const field of fields) {
    if (typeof result[field] === 'string') {
      try {
        result[field] = JSON.parse(result[field] as string);
      } catch { /* keep as string */ }
    }
  }
  return result;
}

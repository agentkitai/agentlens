/**
 * Cloud Migration Runner
 *
 * Executes numbered SQL migration files against PostgreSQL.
 * Tracks applied migrations in a `_cloud_migrations` table.
 * Idempotent: skips already-applied migrations.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, 'migrations');

/**
 * Get ordered migration files from the migrations directory.
 */
export function getMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Read the SQL content of a migration file.
 */
export function readMigration(filename: string, dir: string = MIGRATIONS_DIR): string {
  return readFileSync(join(dir, filename), 'utf-8');
}

/**
 * Ensure the migrations tracking table exists.
 */
async function ensureTrackingTable(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _cloud_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Get list of already-applied migrations.
 */
async function getAppliedMigrations(client: MigrationClient): Promise<Set<string>> {
  const result = await client.query('SELECT name FROM _cloud_migrations ORDER BY name');
  return new Set((result.rows as { name: string }[]).map((r) => r.name));
}

/**
 * Run all pending migrations in order.
 */
export async function runMigrations(
  client: MigrationClient,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  await ensureTrackingTable(client);
  const applied = await getAppliedMigrations(client);
  const files = getMigrationFiles(dir);

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }

    const sql = readMigration(file, dir);
    await client.query(sql);
    await client.query('INSERT INTO _cloud_migrations (name) VALUES ($1)', [file]);
    result.applied.push(file);
  }

  return result;
}

/**
 * Validate migration SQL files without executing them.
 * Returns parsing issues (basic checks).
 */
export function validateMigrations(dir: string = MIGRATIONS_DIR): {
  valid: boolean;
  files: string[];
  errors: { file: string; error: string }[];
} {
  const files = getMigrationFiles(dir);
  const errors: { file: string; error: string }[] = [];

  for (const file of files) {
    try {
      const sql = readMigration(file, dir);
      if (!sql.trim()) {
        errors.push({ file, error: 'Empty migration file' });
      }
      // Check numbering
      const num = file.match(/^(\d+)/);
      if (!num) {
        errors.push({ file, error: 'Migration file must start with a number' });
      }
    } catch (err) {
      errors.push({ file, error: String(err) });
    }
  }

  return { valid: errors.length === 0, files, errors };
}

// All tenant-scoped tables that should have RLS
export const TENANT_SCOPED_TABLES = [
  'events',
  'sessions',
  'agents',
  'alert_rules',
  'alert_history',
  'lessons',
  'embeddings',
  'session_summaries',
  'sharing_config',
  'agent_sharing_config',
  'deny_list_rules',
  'sharing_audit_log',
  'sharing_review_queue',
  'anonymous_id_map',
  'capability_registry',
  'discovery_config',
  'delegation_log',
  'api_keys',
  'usage_records',
  'invoices',
  'audit_log',
  'org_members',
  'org_invitations',
] as const;

// Cloud-specific tables (S-1.1)
export const CLOUD_TABLES = [
  'orgs',
  'users',
  'org_members',
  'org_invitations',
  'api_keys',
  'usage_records',
  'invoices',
  'audit_log',
] as const;

// Existing tables ported to Postgres (S-1.2)
export const EXISTING_TABLES = [
  'events',
  'sessions',
  'agents',
  'alert_rules',
  'alert_history',
  'lessons',
  'embeddings',
  'session_summaries',
  'sharing_config',
  'agent_sharing_config',
  'deny_list_rules',
  'sharing_audit_log',
  'sharing_review_queue',
  'anonymous_id_map',
  'capability_registry',
  'discovery_config',
  'delegation_log',
] as const;

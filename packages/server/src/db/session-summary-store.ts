/**
 * Session Summary Store (Story 5.1)
 *
 * CRUD operations for the session_summaries table with tenant isolation.
 * Stores auto-generated session summaries for cross-session context retrieval.
 */

import { eq, and, or, sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import { sessionSummaries } from './schema.sqlite.js';

/** Escape LIKE wildcard characters to prevent injection */
function escapeLike(s: string): string {
  return s.replace(/[%_]/g, '\\$&');
}

/** Stored session summary record */
export interface SessionSummaryRecord {
  sessionId: string;
  tenantId: string;
  summary: string;
  topics: string[];
  toolSequence: string[];
  errorSummary: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Parse a DB row into a SessionSummaryRecord */
function rowToRecord(row: typeof sessionSummaries.$inferSelect): SessionSummaryRecord {
  return {
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    summary: row.summary,
    topics: JSON.parse(row.topics) as string[],
    toolSequence: JSON.parse(row.toolSequence) as string[],
    errorSummary: row.errorSummary ?? null,
    outcome: row.outcome ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SessionSummaryStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Upsert a session summary. If one already exists for (tenantId, sessionId),
   * it is updated; otherwise a new row is inserted.
   */
  save(
    tenantId: string,
    sessionId: string,
    summary: string,
    topics: string[],
    toolSequence: string[],
    errorSummary: string | null,
    outcome: string | null,
  ): SessionSummaryRecord {
    const now = new Date().toISOString();

    this.db
      .insert(sessionSummaries)
      .values({
        sessionId,
        tenantId,
        summary,
        topics: JSON.stringify(topics),
        toolSequence: JSON.stringify(toolSequence),
        errorSummary,
        outcome,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sessionSummaries.sessionId, sessionSummaries.tenantId],
        set: {
          summary,
          topics: JSON.stringify(topics),
          toolSequence: JSON.stringify(toolSequence),
          errorSummary,
          outcome,
          updatedAt: now,
        },
      })
      .run();

    // Return the saved record
    return this.get(tenantId, sessionId)!;
  }

  /**
   * Get a session summary by sessionId.
   */
  get(tenantId: string, sessionId: string): SessionSummaryRecord | null {
    const row = this.db
      .select()
      .from(sessionSummaries)
      .where(
        and(
          eq(sessionSummaries.sessionId, sessionId),
          eq(sessionSummaries.tenantId, tenantId),
        ),
      )
      .get();

    if (!row) return null;
    return rowToRecord(row);
  }

  /**
   * List session summaries for a tenant, ordered by creation time descending.
   */
  getByTenant(
    tenantId: string,
    opts?: { limit?: number; offset?: number },
  ): SessionSummaryRecord[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = this.db
      .select()
      .from(sessionSummaries)
      .where(eq(sessionSummaries.tenantId, tenantId))
      .limit(limit)
      .offset(offset)
      .orderBy(sql`${sessionSummaries.createdAt} DESC`)
      .all();

    return rows.map(rowToRecord);
  }

  /**
   * Text search over session summaries (LIKE-based).
   * Searches summary text, topics JSON, and error_summary.
   */
  search(tenantId: string, query: string, limit?: number): SessionSummaryRecord[] {
    const maxResults = limit ?? 10;
    const pattern = `%${escapeLike(query)}%`;

    const rows = this.db
      .select()
      .from(sessionSummaries)
      .where(
        and(
          eq(sessionSummaries.tenantId, tenantId),
          or(
            sql`${sessionSummaries.summary} LIKE ${pattern} ESCAPE '\\'`,
            sql`${sessionSummaries.topics} LIKE ${pattern} ESCAPE '\\'`,
            sql`${sessionSummaries.errorSummary} LIKE ${pattern} ESCAPE '\\'`,
          ),
        ),
      )
      .limit(maxResults)
      .orderBy(sql`${sessionSummaries.createdAt} DESC`)
      .all();

    return rows.map(rowToRecord);
  }
}

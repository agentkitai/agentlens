/**
 * Retention service — data cleanup and retention policy enforcement.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, lte, sql, count as drizzleCount } from 'drizzle-orm';
import type { SqliteDb } from '../index.js';
import { events, sessions } from '../schema.sqlite.js';

export class RetentionService {
  constructor(private db: SqliteDb) {}

  async applyRetention(
    olderThan: string,
    tenantId?: string,
  ): Promise<{ deletedCount: number }> {
    const countConditions = [lte(events.timestamp, olderThan)];
    if (tenantId) countConditions.push(eq(events.tenantId, tenantId));

    const countResult = this.db
      .select({ count: drizzleCount() })
      .from(events)
      .where(and(...countConditions))
      .get();
    const deletedCount = countResult?.count ?? 0;

    if (deletedCount === 0) return { deletedCount: 0 };

    this.db.transaction((tx) => {
      if (tenantId) {
        tx.delete(events)
          .where(and(lte(events.timestamp, olderThan), eq(events.tenantId, tenantId)))
          .run();

        tx.run(sql`
          DELETE FROM sessions
          WHERE tenant_id = ${tenantId}
            AND id NOT IN (
              SELECT DISTINCT session_id FROM events WHERE tenant_id = ${tenantId}
            )
        `);
      } else {
        tx.delete(events).where(lte(events.timestamp, olderThan)).run();

        tx.run(sql`
          DELETE FROM sessions
          WHERE id NOT IN (SELECT DISTINCT session_id FROM events)
        `);
      }
    });

    return { deletedCount };
  }
}

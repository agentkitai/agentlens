/**
 * Annotation queues (#122) — tenant-isolated CRUD + lifecycle for human-review
 * queues and their items (pending → in_review → scored/skipped). Mirrors the
 * EvalStore drizzle-sql style.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';

export interface AnnotationQueue {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type AnnotationItemStatus = 'pending' | 'in_review' | 'scored' | 'skipped';

export interface AnnotationItem {
  id: string;
  queueId: string;
  tenantId: string;
  sessionId: string;
  traceId?: string;
  status: AnnotationItemStatus;
  assignee?: string;
  dueAt?: string;
  scoreEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQueueInput {
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  createdBy?: string;
}

export interface AddItemInput {
  sessionId: string;
  traceId?: string;
  dueAt?: string;
}

interface QueueRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  config: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  queue_id: string;
  tenant_id: string;
  session_id: string;
  trace_id: string | null;
  status: string;
  assignee: string | null;
  due_at: string | null;
  score_event_id: string | null;
  created_at: string;
  updated_at: string;
}

function toQueue(row: QueueRow): AnnotationQueue {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    config: JSON.parse(row.config) as Record<string, unknown>,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItem(row: ItemRow): AnnotationItem {
  return {
    id: row.id,
    queueId: row.queue_id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    traceId: row.trace_id ?? undefined,
    status: row.status as AnnotationItemStatus,
    assignee: row.assignee ?? undefined,
    dueAt: row.due_at ?? undefined,
    scoreEventId: row.score_event_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AnnotationStore {
  constructor(private readonly db: AnyDb) {}

  async createQueue(tenantId: string, input: CreateQueueInput): Promise<AnnotationQueue> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await dbRun(this.db, sql`
      INSERT INTO annotation_queues (id, tenant_id, name, description, config, created_by, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${input.name}, ${input.description ?? null}, ${JSON.stringify(input.config ?? {})}, ${input.createdBy ?? null}, ${now}, ${now})
    `);
    return (await this.getQueue(tenantId, id))!;
  }

  async getQueue(tenantId: string, id: string): Promise<AnnotationQueue | undefined> {
    const row = await dbGet<QueueRow>(this.db, sql`SELECT * FROM annotation_queues WHERE id = ${id} AND tenant_id = ${tenantId}`);
    return row ? toQueue(row) : undefined;
  }

  async listQueues(tenantId: string): Promise<AnnotationQueue[]> {
    return (await dbAll<QueueRow>(this.db, sql`SELECT * FROM annotation_queues WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`))
      .map(toQueue);
  }

  /** Add items to a queue; returns [] if the queue doesn't exist for this tenant. */
  async addItems(tenantId: string, queueId: string, items: AddItemInput[]): Promise<AnnotationItem[]> {
    if (!await this.getQueue(tenantId, queueId)) return [];
    const out: AnnotationItem[] = [];
    const now = new Date().toISOString();
    for (const it of items) {
      const id = randomUUID();
      await dbRun(this.db, sql`
        INSERT INTO annotation_items (id, queue_id, tenant_id, session_id, trace_id, status, due_at, created_at, updated_at)
        VALUES (${id}, ${queueId}, ${tenantId}, ${it.sessionId}, ${it.traceId ?? null}, 'pending', ${it.dueAt ?? null}, ${now}, ${now})
      `);
      out.push((await this.getItem(tenantId, id))!);
    }
    return out;
  }

  async getItem(tenantId: string, id: string): Promise<AnnotationItem | undefined> {
    const row = await dbGet<ItemRow>(this.db, sql`SELECT * FROM annotation_items WHERE id = ${id} AND tenant_id = ${tenantId}`);
    return row ? toItem(row) : undefined;
  }

  async listItems(tenantId: string, queueId: string, filters: { status?: AnnotationItemStatus; assignee?: string } = {}): Promise<AnnotationItem[]> {
    let where = sql`tenant_id = ${tenantId} AND queue_id = ${queueId}`;
    if (filters.status) where = sql`${where} AND status = ${filters.status}`;
    if (filters.assignee) where = sql`${where} AND assignee = ${filters.assignee}`;
    return (await dbAll<ItemRow>(this.db, sql`SELECT * FROM annotation_items WHERE ${where} ORDER BY created_at ASC`)).map(toItem);
  }

  /** Claim a pending item for review. Idempotent-safe: only transitions from 'pending'. */
  async claimItem(tenantId: string, id: string, assignee: string): Promise<{ ok: boolean; item?: AnnotationItem; reason?: string }> {
    const item = await this.getItem(tenantId, id);
    if (!item) return { ok: false, reason: 'not_found' };
    if (item.status !== 'pending') return { ok: false, item, reason: `cannot claim from status '${item.status}'` };
    await dbRun(this.db, sql`
      UPDATE annotation_items SET status = 'in_review', assignee = ${assignee}, updated_at = ${new Date().toISOString()}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'
    `);
    return { ok: true, item: await this.getItem(tenantId, id) };
  }

  /** Mark an in-review item scored, linking the human_score event. */
  async markScored(tenantId: string, id: string, scoreEventId: string): Promise<AnnotationItem | undefined> {
    await dbRun(this.db, sql`
      UPDATE annotation_items SET status = 'scored', score_event_id = ${scoreEventId}, updated_at = ${new Date().toISOString()}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return await this.getItem(tenantId, id);
  }

  async skipItem(tenantId: string, id: string): Promise<AnnotationItem | undefined> {
    await dbRun(this.db, sql`
      UPDATE annotation_items SET status = 'skipped', updated_at = ${new Date().toISOString()}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return await this.getItem(tenantId, id);
  }
}

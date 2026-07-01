/**
 * MediaStore (#252) — dialect-agnostic storage for offloaded media blobs.
 *
 * Large base64 media in LLM payloads bloats the events table; the offloader
 * (lib/media-offload.ts) moves those blobs here and leaves a `media://<id>` ref
 * in the event, and the signed GET route resolves refs back to bytes. Blobs live
 * in the dedicated `media_objects` table (base64 text) — tenant-scoped on read.
 * An object-storage backend (S3/GCS via the #151 sink) can be layered later
 * without touching callers.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbGet } from './dialect-db.js';

export interface MediaBlob {
  contentType: string;
  /** base64-encoded blob (no data-URL prefix). */
  data: string;
}

export class MediaStore {
  constructor(private readonly db: AnyDb) {}

  /** Store a base64 blob; returns its id (used in the `media://<id>` ref). */
  async store(tenantId: string, contentType: string, data: string): Promise<string> {
    const id = randomUUID();
    await dbRun(
      this.db,
      sql`INSERT INTO media_objects (id, tenant_id, content_type, size, data, created_at)
          VALUES (${id}, ${tenantId}, ${contentType}, ${data.length}, ${data}, ${new Date().toISOString()})`,
    );
    return id;
  }

  /** Fetch a blob by id, scoped to the tenant (returns null if missing/other-tenant). */
  async fetch(tenantId: string, id: string): Promise<MediaBlob | null> {
    const row = await dbGet<{ content_type: string; data: string }>(
      this.db,
      sql`SELECT content_type, data FROM media_objects WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    return row ? { contentType: row.content_type, data: row.data } : null;
  }
}

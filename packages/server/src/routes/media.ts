/**
 * Media route (#252) — resolve a `media://<id>` ref (from an offloaded event
 * payload) back to the original bytes. Tenant-scoped: the store filters by the
 * caller's tenant, so a ref can only be resolved by its own tenant.
 */
import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { AnyDb } from '../db/dialect-db.js';
import { MediaStore } from '../db/media-store.js';
import { getTenantId } from './tenant-helper.js';

export function mediaRoutes(db: AnyDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new MediaStore(db);

  app.get('/:id', async (c) => {
    const blob = await store.fetch(getTenantId(c), c.req.param('id'));
    if (!blob) return c.json({ error: 'Media not found', status: 404 }, 404);
    return c.body(Buffer.from(blob.data, 'base64'), 200, { 'Content-Type': blob.contentType });
  });

  return app;
}

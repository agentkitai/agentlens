/**
 * Prompt Management REST Endpoints (Feature 19 — Story 4)
 *
 * POST   /api/prompts                        — Create template
 * GET    /api/prompts                        — List templates
 * GET    /api/prompts/fingerprints           — List auto-discovered fingerprints
 * POST   /api/prompts/fingerprints/:hash/link — Link fingerprint to template
 * GET    /api/prompts/:id                    — Get template with versions
 * POST   /api/prompts/:id/versions           — Create new version
 * GET    /api/prompts/:id/versions/:vid      — Get specific version
 * GET    /api/prompts/:id/analytics          — Per-version analytics
 * GET    /api/prompts/:id/diff               — Diff between two versions
 * DELETE /api/prompts/:id                    — Soft delete
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { PromptStore, type CreateTemplateInput, type CreateVersionInput } from '../db/prompt-store.js';
import type { SqliteDb } from '../db/index.js';

export function promptRoutes(db: SqliteDb): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new PromptStore(db);

  // POST /api/prompts — Create template
  app.post('/', async (c) => {
    const tenantId = getTenantId(c);
    const body = await c.req.json();

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }
    if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
      return c.json({ error: 'content is required' }, 400);
    }

    const input: CreateTemplateInput = {
      name: body.name.trim(),
      description: body.description,
      category: body.category,
      content: body.content,
      variables: body.variables,
      createdBy: body.createdBy,
    };

    const result = store.createTemplate(tenantId, input);
    return c.json(result, 201);
  });

  // GET /api/prompts — List templates
  app.get('/', (c) => {
    const tenantId = getTenantId(c);
    const category = c.req.query('category');
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const result = store.listTemplates({ tenantId, category, search, limit, offset });
    return c.json(result);
  });

  // GET /api/prompts/fingerprints — List fingerprints
  app.get('/fingerprints', (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.query('agentId');
    const fingerprints = store.getFingerprints(tenantId, agentId ?? undefined);
    return c.json({ fingerprints });
  });

  // POST /api/prompts/fingerprints/:hash/link — Link fingerprint to template
  app.post('/fingerprints/:hash/link', async (c) => {
    const tenantId = getTenantId(c);
    const hash = c.req.param('hash');
    const body = await c.req.json();

    if (!body.templateId) {
      return c.json({ error: 'templateId is required' }, 400);
    }

    const updated = store.linkFingerprintToTemplate(hash, tenantId, body.templateId);
    if (!updated) {
      return c.json({ error: 'Fingerprint not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // GET /api/prompts/:id — Get template with versions
  app.get('/:id', (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const template = store.getTemplate(id, tenantId);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }
    const versions = store.listVersions(id, tenantId);
    return c.json({ template, versions });
  });

  // POST /api/prompts/:id/versions — Create new version
  app.post('/:id/versions', async (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const body = await c.req.json();

    if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
      return c.json({ error: 'content is required' }, 400);
    }

    const input: CreateVersionInput = {
      content: body.content,
      variables: body.variables,
      changelog: body.changelog,
      createdBy: body.createdBy,
    };

    const version = store.createVersion(templateId, tenantId, input);
    if (!version) {
      return c.json({ error: 'Template not found' }, 404);
    }
    return c.json({ version }, 201);
  });

  // GET /api/prompts/:id/versions/:vid — Get specific version
  app.get('/:id/versions/:vid', (c) => {
    const tenantId = getTenantId(c);
    const vid = c.req.param('vid');
    const version = store.getVersion(vid, tenantId);
    if (!version) {
      return c.json({ error: 'Version not found' }, 404);
    }
    return c.json({ version });
  });

  // GET /api/prompts/:id/analytics — Per-version analytics
  app.get('/:id/analytics', (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const analytics = store.getVersionAnalytics(templateId, tenantId, from, to);
    return c.json({ analytics });
  });

  // GET /api/prompts/:id/diff — Diff between two versions
  app.get('/:id/diff', (c) => {
    const tenantId = getTenantId(c);
    const v1Id = c.req.query('v1');
    const v2Id = c.req.query('v2');

    if (!v1Id || !v2Id) {
      return c.json({ error: 'v1 and v2 query params are required' }, 400);
    }

    const v1 = store.getVersion(v1Id, tenantId);
    const v2 = store.getVersion(v2Id, tenantId);

    if (!v1 || !v2) {
      return c.json({ error: 'One or both versions not found' }, 404);
    }

    // Simple unified diff
    const lines1 = v1.content.split('\n');
    const lines2 = v2.content.split('\n');
    const diff: string[] = [];
    const maxLines = Math.max(lines1.length, lines2.length);

    for (let i = 0; i < maxLines; i++) {
      const l1 = lines1[i];
      const l2 = lines2[i];
      if (l1 === l2) {
        if (l1 !== undefined) diff.push(` ${l1}`);
      } else {
        if (l1 !== undefined) diff.push(`-${l1}`);
        if (l2 !== undefined) diff.push(`+${l2}`);
      }
    }

    return c.json({
      v1: { id: v1.id, versionNumber: v1.versionNumber },
      v2: { id: v2.id, versionNumber: v2.versionNumber },
      diff: diff.join('\n'),
    });
  });

  // DELETE /api/prompts/:id — Soft delete
  app.delete('/:id', (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const deleted = store.softDeleteTemplate(id, tenantId);
    if (!deleted) {
      return c.json({ error: 'Template not found' }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}

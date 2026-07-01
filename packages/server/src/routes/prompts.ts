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

import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { PromptGithubSyncStore, pushPrompts } from '../lib/prompt-github-sync.js';
import { secretsAvailable } from '../lib/secret-box.js';
import {
  PromptStore,
  type CreateTemplateInput,
  type CreateVersionInput,
  getPromptEnvironments,
  isKnownEnvironment,
  isProtectedEnvironment,
} from '../db/prompt-store.js';
import type { AnyDb } from '../db/dialect-db.js';
import { compilePrompt, type PromptConfig, type VariableValues } from '@agentkitai/agentlens-core';
import { normalizeVariants } from '../lib/prompt-ab.js';
import { verifyAgentTokenWithMethod } from '../lib/agent-identity.js';
import { requestDeployApproval } from '../lib/prompt-deploy-approval.js';

/** Resolve the verified actor for a deploy/rollback: agent token, else API-key identity. */
async function resolveActor(
  c: Context<{ Variables: AuthVariables }>,
): Promise<{ id: string | null; method: string }> {
  const verified = await verifyAgentTokenWithMethod(c.req.header('x-agent-token'));
  if (verified) return { id: verified.id, method: verified.method };
  const apiKey = c.get('apiKey');
  if (apiKey?.id) return { id: apiKey.id, method: 'api_key' };
  return { id: null, method: 'unknown' };
}

export function promptRoutes(db: AnyDb): Hono<{ Variables: AuthVariables }> {
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
      folder: body.folder,
      content: body.content,
      variables: body.variables,
      config: body.config,
      promptType: body.promptType === 'chat' ? 'chat' : undefined,
      createdBy: body.createdBy,
    };

    const result = await store.createTemplate(tenantId, input);
    return c.json(result, 201);
  });

  // GET /api/prompts — List templates
  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const category = c.req.query('category');
    const folder = c.req.query('folder') ?? undefined;
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const result = await store.listTemplates({ tenantId, category, folder, search, limit, offset });
    return c.json(result);
  });

  // GET /api/prompts/fingerprints — List fingerprints
  app.get('/fingerprints', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.query('agentId');
    const fingerprints = await store.getFingerprints(tenantId, agentId ?? undefined);
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

    const updated = await store.linkFingerprintToTemplate(hash, tenantId, body.templateId);
    if (!updated) {
      return c.json({ error: 'Fingerprint not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // GET /api/prompts/environments — configured deploy environments (#120)
  app.get('/environments', async (c) => {
    return c.json({ environments: getPromptEnvironments() });
  });

  // GET /api/prompts/deployments/verify — verify an env's deploy ledger chain (#120)
  app.get('/deployments/verify', async (c) => {
    const tenantId = getTenantId(c);
    const environment = c.req.query('environment');
    if (!environment || !isKnownEnvironment(environment)) {
      return c.json({ error: 'valid environment query param is required' }, 400);
    }
    return c.json(await store.verifyDeployLedger(tenantId, environment));
  });

  // GET /api/prompts/:id — Get template with versions + live versions per env
  app.get('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const template = await store.getTemplate(id, tenantId);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }
    const versions = await store.listVersions(id, tenantId);
    const liveVersions = await store.getLiveVersions(tenantId, id);
    return c.json({ template, versions, liveVersions });
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
      config: body.config,
      promptType: body.promptType === 'chat' ? 'chat' : undefined,
      changelog: body.changelog,
      createdBy: body.createdBy,
    };

    const version = await store.createVersion(templateId, tenantId, input);
    if (!version) {
      return c.json({ error: 'Template not found' }, 404);
    }
    return c.json({ version }, 201);
  });

  // GET /api/prompts/:id/versions/:vid — Get specific version
  app.get('/:id/versions/:vid', async (c) => {
    const tenantId = getTenantId(c);
    const vid = c.req.param('vid');
    const version = await store.getVersion(vid, tenantId);
    if (!version) {
      return c.json({ error: 'Version not found' }, 404);
    }
    return c.json({ version });
  });

  // POST /api/prompts/:id/compile — compile a version's {{variables}} + config (#145)
  app.post('/:id/compile', async (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { variables?: VariableValues; versionId?: string };
    let version = body.versionId ? await store.getVersion(body.versionId, tenantId) : null;
    if (!version) {
      const template = await store.getTemplate(id, tenantId);
      if (template?.currentVersionId) version = await store.getVersion(template.currentVersionId, tenantId);
    }
    if (!version) return c.json({ error: 'Prompt version not found' }, 404);
    const compiled = compilePrompt(
      { type: version.promptType, content: version.content, variables: version.variables, config: version.config as PromptConfig | undefined },
      body.variables ?? {},
    );
    return c.json({ compiled, versionId: version.id, versionNumber: version.versionNumber });
  });

  // ─── A/B testing (#150) ───
  // POST /api/prompts/:id/ab — start/replace a weighted A/B test for an environment
  app.post('/:id/ab', async (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { environment?: string; variants?: unknown };
    if (!body.environment || !isKnownEnvironment(body.environment)) {
      return c.json({ error: 'a valid environment is required' }, 400);
    }
    const variants = normalizeVariants(body.variants);
    if (!variants) return c.json({ error: 'variants must be [{ versionId, label?, weight }] with at least one positive weight' }, 400);
    if (!await store.getTemplate(templateId, tenantId)) return c.json({ error: 'Template not found' }, 404);
    const abTest = await store.createAbTest(tenantId, templateId, body.environment, variants, c.get('apiKey')?.id);
    return c.json({ abTest }, 201);
  });

  // GET /api/prompts/:id/ab — list A/B tests for a template
  app.get('/:id/ab', async (c) => {
    return c.json({ abTests: await store.listAbTests(getTenantId(c), c.req.param('id')) });
  });

  // DELETE /api/prompts/:id/ab/:abId — stop an active A/B test
  app.delete('/:id/ab/:abId', async (c) => {
    const ok = await store.stopAbTest(getTenantId(c), c.req.param('abId'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Active A/B test not found' }, 404);
  });

  // GET /api/prompts/:id/resolve?environment=&key= — resolve the version to serve
  // (A/B-aware, sticky by key) — what an SDK calls at runtime.
  app.get('/:id/resolve', async (c) => {
    const environment = c.req.query('environment') ?? 'production';
    const resolved = await store.resolveVersion(getTenantId(c), c.req.param('id'), environment, c.req.query('key'));
    return resolved ? c.json(resolved) : c.json({ error: 'No live version for this environment' }, 404);
  });

  // GET /api/prompts/:id/analytics — Per-version analytics
  app.get('/:id/analytics', async (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const analytics = await store.getVersionAnalytics(templateId, tenantId, from, to);
    return c.json({ analytics });
  });

  // GET /api/prompts/:id/analytics/by-agent — per-agent usage + cost per version (#120)
  app.get('/:id/analytics/by-agent', async (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const usage = await store.getVersionAnalyticsByAgent(templateId, tenantId, from, to);
    return c.json({ usage });
  });

  // GET /api/prompts/:id/diff — Diff between two versions
  app.get('/:id/diff', async (c) => {
    const tenantId = getTenantId(c);
    const v1Id = c.req.query('v1');
    const v2Id = c.req.query('v2');

    if (!v1Id || !v2Id) {
      return c.json({ error: 'v1 and v2 query params are required' }, 400);
    }

    const v1 = await store.getVersion(v1Id, tenantId);
    const v2 = await store.getVersion(v2Id, tenantId);

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

  // ─── Deploy lifecycle (#120) ──────────────────────────────

  // GET /api/prompts/:id/deployments — deploy history for a template (optionally one env)
  app.get('/:id/deployments', async (c) => {
    const tenantId = getTenantId(c);
    const templateId = c.req.param('id');
    const environment = c.req.query('environment') ?? undefined;
    const deployments = await store.listDeployments(tenantId, { templateId, environment });
    return c.json({ deployments });
  });

  // POST /api/prompts/:id/deploy { environment, versionId, note? }
  // POST /api/prompts/:id/rollback { environment, toVersionId, note? }
  for (const action of ['deploy', 'rollback'] as const) {
    app.post(`/:id/${action}`, async (c) => {
      const tenantId = getTenantId(c);
      const templateId = c.req.param('id');
      const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
      const environment = typeof body.environment === 'string' ? body.environment : '';
      const versionId =
        action === 'rollback'
          ? (typeof body.toVersionId === 'string' ? body.toVersionId : (body.versionId as string))
          : (body.versionId as string);
      const note = typeof body.note === 'string' ? body.note : undefined;

      if (!environment || !isKnownEnvironment(environment)) {
        return c.json({ error: 'a valid environment is required' }, 400);
      }
      if (!versionId || typeof versionId !== 'string') {
        return c.json({ error: action === 'rollback' ? 'toVersionId is required' : 'versionId is required' }, 400);
      }

      // The version must exist and belong to this template+tenant before we gate it.
      const version = await store.getVersion(versionId, tenantId);
      if (!version || version.templateId !== templateId) {
        return c.json({ error: 'Version not found for this template' }, 404);
      }

      const actor = await resolveActor(c);
      let approverId: string | undefined;
      let approvalRef: string | undefined;

      if (isProtectedEnvironment(environment)) {
        const decision = await requestDeployApproval({ templateId, versionId, environment, actorId: actor.id, action });
        if (decision.notConfigured) {
          return c.json({ error: decision.reason }, 503);
        }
        if (!decision.approved) {
          // Record the denial in the ledger (audit trail); live version unchanged.
          const denied = await store.appendDeployment(tenantId, {
            templateId, environment, versionId, action, status: 'denied',
            actorId: actor.id, actorMethod: actor.method, approvalRef: decision.approvalRef, note: decision.reason ?? note,
          });
          return c.json({ error: decision.reason ?? 'Deploy denied by AgentGate', deployment: denied }, 403);
        }
        approverId = decision.approverId;
        approvalRef = decision.approvalRef;
      }

      const deployment = await store.appendDeployment(tenantId, {
        templateId, environment, versionId, action, status: 'committed',
        actorId: actor.id, actorMethod: actor.method, approverId, approvalRef, note,
      });
      if (!deployment) {
        return c.json({ error: 'Template or version not found' }, 404);
      }
      return c.json({ deployment }, 201);
    });
  }

  // DELETE /api/prompts/:id — Soft delete
  app.delete('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const deleted = await store.softDeleteTemplate(id, tenantId);
    if (!deleted) {
      return c.json({ error: 'Template not found' }, 404);
    }
    return c.body(null, 204);
  });

  // ── GitHub prompt-sync (#253): one-way push of prompt versions to a repo ──
  const ghSync = new PromptGithubSyncStore(db);

  // GET /api/prompts/sync/github — current sync config (never the token).
  app.get('/sync/github', async (c) => {
    return c.json({ config: await ghSync.getConfig(getTenantId(c)) });
  });

  // PUT /api/prompts/sync/github — set repo + PAT (PAT encrypted via secret-box).
  app.put('/sync/github', async (c) => {
    if (!secretsAvailable()) {
      return c.json({ error: 'AGENTLENS_ENCRYPTION_KEY is not configured; cannot store a token', status: 503 }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string; repo?: string; basePath?: string; token?: string };
    if (!body.owner || !body.repo || !body.token) {
      return c.json({ error: 'owner, repo and token are required', status: 400 }, 400);
    }
    await ghSync.setConfig(getTenantId(c), { owner: body.owner, repo: body.repo, basePath: body.basePath, token: body.token });
    return c.json({ config: await ghSync.getConfig(getTenantId(c)) }, 200);
  });

  // POST /api/prompts/sync/github/push — push all prompts to the configured repo.
  app.post('/sync/github/push', async (c) => {
    const tenantId = getTenantId(c);
    const config = await ghSync.getConfig(tenantId);
    const token = await ghSync.getToken(tenantId);
    if (!config || !token) return c.json({ error: 'GitHub sync is not configured', status: 400 }, 400);
    try {
      const result = await pushPrompts(tenantId, config, token, store);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'push failed', status: 502 }, 502);
    }
  });

  return app;
}

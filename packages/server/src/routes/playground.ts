/**
 * Playground run endpoint (#144).
 *
 * Executes a prompt against a stored LLM connection (#143), compiling
 * {{variables}} (#145) when a stored prompt is referenced, and returns the output
 * with token usage, cost, and latency. The dashboard runs this once per panel for
 * side-by-side comparison.
 */
import { Hono } from 'hono';
import { costUsdDetailed, compilePrompt } from '@agentkitai/agentlens-core';
import type { SqliteDb } from '../db/index.js';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { LlmConnectionStore } from '../db/llm-connection-store.js';
import { PromptStore } from '../db/prompt-store.js';
import { invokeLlm, type InvokeMessage } from '../lib/llm-invoke.js';

export function playgroundRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const connections = new LlmConnectionStore(db);
  const prompts = new PromptStore(db);

  // POST /api/playground/run
  app.post('/run', async (c) => {
    const tenantId = getTenantId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      connectionId?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      messages?: Array<{ role: string; content: string }>;
      prompt?: string;
      promptId?: string;
      versionId?: string;
      variables?: Record<string, string | number | boolean>;
    };

    if (!body.connectionId) return c.json({ error: 'connectionId is required' }, 400);
    const conn = connections.getWithKey(tenantId, body.connectionId);
    if (!conn) return c.json({ error: 'Connection not found' }, 404);

    // Resolve messages: explicit messages, a stored prompt (compiled), or a raw string.
    let messages: InvokeMessage[];
    if (body.promptId) {
      const template = prompts.getTemplate(body.promptId, tenantId);
      const versionId = body.versionId ?? template?.currentVersionId;
      const version = versionId ? prompts.getVersion(versionId, tenantId) : null;
      if (!version) return c.json({ error: 'Prompt version not found' }, 404);
      const compiled = compilePrompt(
        { type: version.promptType, content: version.content, variables: version.variables, config: version.config },
        body.variables ?? {},
      );
      messages = compiled.type === 'chat' ? compiled.messages! : [{ role: 'user', content: compiled.text! }];
    } else if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = body.messages.map((m) => ({ role: String(m.role), content: String(m.content) }));
    } else if (typeof body.prompt === 'string' && body.prompt.trim()) {
      messages = [{ role: 'user', content: body.prompt }];
    } else {
      return c.json({ error: 'provide messages, prompt, or promptId' }, 400);
    }

    const model = body.model || conn.defaultModel;
    if (!model) return c.json({ error: 'a model is required (request.model or the connection default)' }, 400);

    const start = Date.now();
    try {
      const output = await invokeLlm(
        { provider: conn.provider, apiKey: conn.apiKey, baseUrl: conn.baseUrl, defaultModel: conn.defaultModel },
        { model, messages, temperature: body.temperature, maxTokens: body.maxTokens },
      );
      const latencyMs = Date.now() - start;
      const { costUsd } = costUsdDetailed(output.model, {
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
      });
      return c.json({ output, costUsd, latencyMs });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  return app;
}

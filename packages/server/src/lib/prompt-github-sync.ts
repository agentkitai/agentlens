/**
 * Prompt → GitHub one-way version-sync (#253).
 *
 * Pushes each prompt template's current version to a GitHub repo as a JSON file
 * (so prompt changes get a git history / review flow). Config + PAT are stored
 * per tenant; the PAT is encrypted at rest via the existing secret-box. Uses the
 * GitHub Contents REST API over fetch — no new dependency. `fetch` is injectable
 * for testing. Pull / two-way merge / conflict resolution are a follow-up.
 */
import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbGet } from '../db/dialect-db.js';
import { encryptSecret, decryptSecret, lastFour } from './secret-box.js';
import type { PromptStore } from '../db/prompt-store.js';

export interface GithubSyncConfig {
  owner: string;
  repo: string;
  basePath: string;
  tokenLast4: string;
  updatedAt: string;
}

export type FetchFn = typeof fetch;

export class PromptGithubSyncStore {
  constructor(private readonly db: AnyDb) {}

  async setConfig(tenantId: string, input: { owner: string; repo: string; basePath?: string; token: string }): Promise<void> {
    const now = new Date().toISOString();
    await dbRun(
      this.db,
      sql`INSERT INTO prompt_github_sync (tenant_id, owner, repo, base_path, encrypted_token, token_last4, updated_at)
          VALUES (${tenantId}, ${input.owner}, ${input.repo}, ${input.basePath || 'prompts'}, ${encryptSecret(input.token)}, ${lastFour(input.token)}, ${now})
          ON CONFLICT (tenant_id) DO UPDATE SET
            owner = excluded.owner, repo = excluded.repo, base_path = excluded.base_path,
            encrypted_token = excluded.encrypted_token, token_last4 = excluded.token_last4, updated_at = excluded.updated_at`,
    );
  }

  /** Public config (never the token). */
  async getConfig(tenantId: string): Promise<GithubSyncConfig | null> {
    const r = await dbGet<{ owner: string; repo: string; base_path: string; token_last4: string; updated_at: string }>(
      this.db,
      sql`SELECT owner, repo, base_path, token_last4, updated_at FROM prompt_github_sync WHERE tenant_id = ${tenantId}`,
    );
    return r ? { owner: r.owner, repo: r.repo, basePath: r.base_path, tokenLast4: r.token_last4, updatedAt: r.updated_at } : null;
  }

  /** Internal: decrypt the PAT for a push. Never expose via the API. */
  async getToken(tenantId: string): Promise<string | null> {
    const r = await dbGet<{ encrypted_token: string }>(
      this.db,
      sql`SELECT encrypted_token FROM prompt_github_sync WHERE tenant_id = ${tenantId}`,
    );
    return r ? decryptSecret(r.encrypted_token) : null;
  }
}

/** Create-or-update a file in the repo via the GitHub Contents API. */
async function putFile(cfg: GithubSyncConfig, token: string, path: string, content: string, fetchFn: FetchFn): Promise<void> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  // Fetch the existing blob sha (if any) so the PUT updates rather than 422s.
  let sha: string | undefined;
  const head = await fetchFn(url, { headers });
  if (head.ok) sha = ((await head.json()) as { sha?: string }).sha;
  const body = { message: `chore(prompts): sync ${path}`, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) };
  const res = await fetchFn(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status}`);
}

/** Push every template's current version to the repo. Returns the count pushed. */
export async function pushPrompts(
  tenantId: string,
  cfg: GithubSyncConfig,
  token: string,
  store: PromptStore,
  fetchFn: FetchFn = fetch,
): Promise<{ pushed: number }> {
  const { templates } = await store.listTemplates({ tenantId, limit: 1000 });
  let pushed = 0;
  for (const t of templates) {
    const versions = await store.listVersions(t.id, tenantId);
    const current = versions.find((v) => v.id === t.currentVersionId) ?? versions[0];
    if (!current) continue;
    const file = JSON.stringify(
      { name: t.name, category: t.category, folder: t.folder, version: current.versionNumber, content: current.content, variables: current.variables },
      null,
      2,
    );
    const path = [cfg.basePath, t.folder, `${t.name}.json`].filter(Boolean).join('/').replace(/\/{2,}/g, '/');
    await putFile(cfg, token, path, file, fetchFn);
    pushed++;
  }
  return { pushed };
}

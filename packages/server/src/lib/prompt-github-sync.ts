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
import { PromptStore, computePromptHash } from '../db/prompt-store.js';
import type { PromptTemplate, PromptVersion } from '@agentkitai/agentlens-core';

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

function ghHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
}
const contentsUrl = (cfg: GithubSyncConfig, path: string) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

/** The repo path a prompt maps to: <basePath>/<folder>/<name>.json. */
export function promptPath(cfg: GithubSyncConfig, name: string, folder?: string): string {
  return [cfg.basePath, folder, `${name}.json`].filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}

/** Create-or-update a file in the repo via the GitHub Contents API. Returns the new blob sha. */
async function putFile(cfg: GithubSyncConfig, token: string, path: string, content: string, fetchFn: FetchFn): Promise<string | undefined> {
  const headers = ghHeaders(token);
  // Fetch the existing blob sha (if any) so the PUT updates rather than 422s.
  let sha: string | undefined;
  const head = await fetchFn(contentsUrl(cfg, path), { headers });
  if (head.ok) sha = ((await head.json()) as { sha?: string }).sha;
  const body = { message: `chore(prompts): sync ${path}`, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) };
  const res = await fetchFn(contentsUrl(cfg, path), { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status}`);
  return ((await res.json().catch(() => ({}))) as { content?: { sha?: string } }).content?.sha;
}

/** Read a file's content + blob sha, or null if it doesn't exist. */
async function getRepoFile(cfg: GithubSyncConfig, token: string, path: string, fetchFn: FetchFn): Promise<{ content: string; sha: string } | null> {
  const res = await fetchFn(contentsUrl(cfg, path), { headers: ghHeaders(token) });
  if (!res.ok) return null;
  const j = (await res.json()) as { content?: string; sha?: string };
  if (!j.content || !j.sha) return null;
  return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}

/** List all *.json blobs under basePath (recursing into folders). */
async function listRepoPrompts(cfg: GithubSyncConfig, token: string, dir: string, fetchFn: FetchFn, acc: Array<{ path: string; sha: string }> = []): Promise<Array<{ path: string; sha: string }>> {
  const res = await fetchFn(contentsUrl(cfg, dir), { headers: ghHeaders(token) });
  if (!res.ok) return acc; // 404 → empty
  const entries = (await res.json()) as Array<{ path: string; sha: string; type: string }>;
  for (const e of entries) {
    if (e.type === 'file' && e.path.endsWith('.json')) acc.push({ path: e.path, sha: e.sha });
    else if (e.type === 'dir') await listRepoPrompts(cfg, token, e.path, fetchFn, acc);
  }
  return acc;
}

interface PromptFile {
  name: string;
  category?: string;
  folder?: string;
  content: string;
  variables?: unknown[];
}

function serializePrompt(t: PromptTemplate, v: PromptVersion): string {
  return JSON.stringify(
    { name: t.name, category: t.category, folder: t.folder, version: v.versionNumber, content: v.content, variables: v.variables },
    null,
    2,
  );
}

function parsePromptFile(raw: string): PromptFile | null {
  try {
    const j = JSON.parse(raw);
    if (typeof j?.name === 'string' && typeof j?.content === 'string') return j as PromptFile;
  } catch {
    /* not a prompt file */
  }
  return null;
}

/** The current version of a local template, if any. */
async function currentVersion(store: PromptStore, tenantId: string, t: PromptTemplate): Promise<PromptVersion | null> {
  const versions = await store.listVersions(t.id, tenantId);
  return versions.find((v) => v.id === t.currentVersionId) ?? versions[versions.length - 1] ?? null;
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
    const current = await currentVersion(store, tenantId, t);
    if (!current) continue;
    await putFile(cfg, token, promptPath(cfg, t.name, t.folder), serializePrompt(t, current), fetchFn);
    pushed++;
  }
  return { pushed };
}

/** Import prompts from the repo — create templates / add versions for changed prompts. */
export async function pullPrompts(
  tenantId: string,
  cfg: GithubSyncConfig,
  token: string,
  store: PromptStore,
  fetchFn: FetchFn = fetch,
): Promise<{ pulled: number }> {
  const files = await listRepoPrompts(cfg, token, cfg.basePath, fetchFn);
  const { templates } = await store.listTemplates({ tenantId, limit: 1000 });
  const byName = new Map(templates.map((t) => [t.name, t]));
  let pulled = 0;
  for (const f of files) {
    const rf = await getRepoFile(cfg, token, f.path, fetchFn);
    const pf = rf && parsePromptFile(rf.content);
    if (!pf) continue;
    const existing = byName.get(pf.name);
    if (!existing) {
      await store.createTemplate(tenantId, { name: pf.name, category: pf.category, folder: pf.folder, content: pf.content, variables: pf.variables as never });
      pulled++;
    } else {
      const cur = await currentVersion(store, tenantId, existing);
      if (!cur || cur.contentHash !== computePromptHash(pf.content)) {
        await store.createVersion(existing.id, tenantId, { content: pf.content, variables: pf.variables as never, changelog: 'Pulled from GitHub' });
        pulled++;
      }
    }
  }
  return { pulled };
}

// ── Two-way sync with conflict detection (state = last-synced sha + hash) ──

export class SyncStateStore {
  constructor(private readonly db: AnyDb) {}
  async get(tenantId: string, path: string): Promise<{ repoSha: string; localHash: string } | null> {
    const r = await dbGet<{ repo_sha: string; local_hash: string }>(
      this.db,
      sql`SELECT repo_sha, local_hash FROM prompt_github_sync_state WHERE tenant_id = ${tenantId} AND path = ${path}`,
    );
    return r ? { repoSha: r.repo_sha, localHash: r.local_hash } : null;
  }
  async set(tenantId: string, path: string, s: { repoSha: string; localHash: string }): Promise<void> {
    await dbRun(
      this.db,
      sql`INSERT INTO prompt_github_sync_state (tenant_id, path, repo_sha, local_hash, updated_at)
          VALUES (${tenantId}, ${path}, ${s.repoSha}, ${s.localHash}, ${new Date().toISOString()})
          ON CONFLICT (tenant_id, path) DO UPDATE SET repo_sha = excluded.repo_sha, local_hash = excluded.local_hash, updated_at = excluded.updated_at`,
    );
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: string[];
}

/**
 * Reconcile local prompts with the repo. Applies one-sided changes (push or pull)
 * and reports — without clobbering — any prompt that changed on BOTH sides since
 * the last sync.
 */
export async function syncPrompts(
  tenantId: string,
  cfg: GithubSyncConfig,
  token: string,
  store: PromptStore,
  state: SyncStateStore,
  fetchFn: FetchFn = fetch,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, conflicts: [] };

  const { templates } = await store.listTemplates({ tenantId, limit: 1000 });
  const local = new Map<string, { template: PromptTemplate; version: PromptVersion; hash: string }>();
  for (const t of templates) {
    const v = await currentVersion(store, tenantId, t);
    if (v) local.set(promptPath(cfg, t.name, t.folder), { template: t, version: v, hash: v.contentHash });
  }

  const repo = new Map<string, { file: PromptFile; sha: string }>();
  for (const f of await listRepoPrompts(cfg, token, cfg.basePath, fetchFn)) {
    const rf = await getRepoFile(cfg, token, f.path, fetchFn);
    const pf = rf && parsePromptFile(rf.content);
    if (rf && pf) repo.set(f.path, { file: pf, sha: rf.sha });
  }

  for (const path of new Set([...local.keys(), ...repo.keys()])) {
    const l = local.get(path);
    const r = repo.get(path);
    const last = await state.get(tenantId, path);

    if (l && r) {
      const repoHash = computePromptHash(r.file.content);
      if (l.hash === repoHash) {
        await state.set(tenantId, path, { repoSha: r.sha, localHash: l.hash });
        continue;
      }
      const localChanged = !last || l.hash !== last.localHash;
      const repoChanged = !last || r.sha !== last.repoSha;
      if (localChanged && repoChanged) {
        result.conflicts.push(path);
      } else if (repoChanged) {
        await store.createVersion(l.template.id, tenantId, { content: r.file.content, changelog: 'Pulled from GitHub (sync)' });
        result.pulled++;
        await state.set(tenantId, path, { repoSha: r.sha, localHash: repoHash });
      } else {
        const sha = await putFile(cfg, token, path, serializePrompt(l.template, l.version), fetchFn);
        result.pushed++;
        await state.set(tenantId, path, { repoSha: sha ?? r.sha, localHash: l.hash });
      }
    } else if (l && !r) {
      const sha = await putFile(cfg, token, path, serializePrompt(l.template, l.version), fetchFn);
      result.pushed++;
      await state.set(tenantId, path, { repoSha: sha ?? '', localHash: l.hash });
    } else if (r && !l) {
      await store.createTemplate(tenantId, { name: r.file.name, category: r.file.category, folder: r.file.folder, content: r.file.content, variables: r.file.variables as never });
      result.pulled++;
      await state.set(tenantId, path, { repoSha: r.sha, localHash: computePromptHash(r.file.content) });
    }
  }
  return result;
}

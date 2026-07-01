/**
 * #265 — GitHub prompt sync: pull + two-way reconcile with conflict detection.
 * Uses an in-memory mock of the GitHub Contents API (no network).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { PromptStore, computePromptHash } from '../../db/prompt-store.js';
import { pullPrompts, syncPrompts, SyncStateStore, promptPath, type GithubSyncConfig } from '../prompt-github-sync.js';

const CFG: GithubSyncConfig = { owner: 'acme', repo: 'prompts', basePath: 'prompts', tokenLast4: '0000', updatedAt: '' };

/** In-memory GitHub Contents API mock: path → {content, sha}. */
function mockGithub(initial: Record<string, unknown> = {}) {
  const repo = new Map<string, { content: string; sha: string }>();
  let n = 1;
  for (const [p, obj] of Object.entries(initial)) repo.set(p, { content: JSON.stringify(obj), sha: `sha${n++}` });

  const fetchFn = vi.fn((url: string, init?: any) => {
    const path = decodeURIComponent(/\/contents\/(.+)$/.exec(url)?.[1] ?? '');
    if (init?.method === 'PUT') {
      const content = Buffer.from(JSON.parse(init.body).content, 'base64').toString('utf8');
      const sha = `sha${n++}`;
      repo.set(path, { content, sha });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: { sha } }) });
    }
    const file = repo.get(path);
    if (file) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: Buffer.from(file.content).toString('base64'), sha: file.sha, type: 'file' }) });
    }
    // Directory listing (immediate children).
    const prefix = path ? path + '/' : '';
    const children = new Map<string, { path: string; sha: string; type: string }>();
    for (const [p, e] of repo) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes('/')) {
        const dir = prefix + rest.split('/')[0];
        children.set(dir, { path: dir, sha: 'dir', type: 'dir' });
      } else {
        children.set(p, { path: p, sha: e.sha, type: 'file' });
      }
    }
    if (children.size === 0) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve([...children.values()]) });
  });
  return { fetchFn: fetchFn as any, repo };
}

describe('#265 GitHub prompt pull + sync', () => {
  let db: any;
  let store: PromptStore;
  let state: SyncStateStore;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new PromptStore(db);
    state = new SyncStateStore(db);
  });

  it('pull imports a repo prompt as a new template', async () => {
    const { fetchFn } = mockGithub({ 'prompts/greeting.json': { name: 'greeting', category: 'general', content: 'Hi {{x}}' } });
    const res = await pullPrompts('default', CFG, 'tok', store, fetchFn);
    expect(res.pulled).toBe(1);
    const { templates } = await store.listTemplates({ tenantId: 'default' });
    expect(templates.map((t) => t.name)).toContain('greeting');
  });

  it('sync pulls a repo-only change and pushes a local-only prompt', async () => {
    // local-only prompt 'local' → should push; repo-only 'remote' → should pull.
    await store.createTemplate('default', { name: 'local', content: 'L1' });
    const { fetchFn, repo } = mockGithub({ 'prompts/remote.json': { name: 'remote', content: 'R1' } });

    const res = await syncPrompts('default', CFG, 'tok', store, state, fetchFn);
    expect(res.conflicts).toEqual([]);
    expect(res.pulled).toBe(1); // remote
    expect(res.pushed).toBe(1); // local
    expect(repo.has(promptPath(CFG, 'local'))).toBe(true);
    const { templates } = await store.listTemplates({ tenantId: 'default' });
    expect(templates.map((t) => t.name).sort()).toEqual(['local', 'remote']);
  });

  it('sync flags a conflict when both sides changed and does NOT clobber', async () => {
    await store.createTemplate('default', { name: 'p', content: 'LOCAL' });
    const { fetchFn } = mockGithub({ 'prompts/p.json': { name: 'p', content: 'REMOTE' } });
    // Last-synced state predating both edits → both changed.
    await state.set('default', 'prompts/p.json', { repoSha: 'old-sha', localHash: 'old-hash' });

    const res = await syncPrompts('default', CFG, 'tok', store, state, fetchFn);
    expect(res.conflicts).toEqual(['prompts/p.json']);
    expect(res.pulled).toBe(0);
    expect(res.pushed).toBe(0);

    // Local content untouched (no new version from the repo).
    const tmpl = (await store.listTemplates({ tenantId: 'default' })).templates.find((t) => t.name === 'p')!;
    const versions = await store.listVersions(tmpl.id, 'default');
    expect(versions.every((v) => v.content === 'LOCAL')).toBe(true);
  });

  it('sync pulls when only the repo changed since last sync', async () => {
    const t = (await store.createTemplate('default', { name: 'p', content: 'A' })).template;
    const { fetchFn } = mockGithub({ 'prompts/p.json': { name: 'p', content: 'B' } });
    // State says local is unchanged (hash of A) but repo sha is stale → repo changed only.
    await state.set('default', 'prompts/p.json', { repoSha: 'old-sha', localHash: computePromptHash('A') });

    const res = await syncPrompts('default', CFG, 'tok', store, state, fetchFn);
    expect(res.conflicts).toEqual([]);
    expect(res.pulled).toBe(1);
    const versions = await store.listVersions(t.id, 'default');
    expect(versions.some((v) => v.content === 'B')).toBe(true);
  });
});

/**
 * #253 — prompt folders + one-way GitHub version-sync.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { promptRoutes } from '../prompts.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys)
    .values({
      id: 'key-1', keyHash: hashApiKey(rawKey), name: 'Test Key',
      scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'default', role: 'editor',
    })
    .run();
  return rawKey;
}

const newPrompt = (name: string, folder?: string) => ({ name, content: 'Hello {{x}}', category: 'general', folder });

describe('#253 prompt folders + GitHub sync', () => {
  let db: any;
  let app: any;
  let apiKey: string;
  let prevKey: string | undefined;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(() => {
    prevKey = process.env.AGENTLENS_ENCRYPTION_KEY;
    process.env.AGENTLENS_ENCRYPTION_KEY = 'test-passphrase-for-secret-box';
    db = createTestDb();
    runMigrations(db);
    app = new Hono<{ Variables: AuthVariables }>();
    app.use('/*', authMiddleware(db, false));
    app.route('/api/prompts', promptRoutes(db));
    apiKey = seedApiKey(db);
  });

  afterEach(() => {
    process.env.AGENTLENS_ENCRYPTION_KEY = prevKey;
    vi.unstubAllGlobals();
  });

  it('stores a folder and filters the list by folder', async () => {
    for (const p of [newPrompt('a', 'team/billing'), newPrompt('b', 'team/support'), newPrompt('c')]) {
      const res = await app.request('/api/prompts', { method: 'POST', headers: auth(), body: JSON.stringify(p) });
      expect(res.status).toBe(201);
    }
    const filtered = await (await app.request('/api/prompts?folder=team/billing', { headers: auth() })).json();
    expect(filtered.templates.map((t: any) => t.name)).toEqual(['a']);
    expect(filtered.templates[0].folder).toBe('team/billing');

    const all = await (await app.request('/api/prompts', { headers: auth() })).json();
    expect(all.total).toBe(3);
  });

  it('stores GitHub config (token masked) and pushes prompts to the repo', async () => {
    await app.request('/api/prompts', { method: 'POST', headers: auth(), body: JSON.stringify(newPrompt('greeting', 'welcome')) });

    // Configure sync — the response never echoes the token.
    const cfgRes = await app.request('/api/prompts/sync/github', {
      method: 'PUT', headers: auth(),
      body: JSON.stringify({ owner: 'acme', repo: 'prompts-repo', token: 'ghp_secrettoken1234' }),
    });
    expect(cfgRes.status).toBe(200);
    const cfg = (await cfgRes.json()).config;
    expect(cfg.owner).toBe('acme');
    expect(cfg.tokenLast4).toBe('1234');
    expect(JSON.stringify(cfg)).not.toContain('ghp_secrettoken');

    // Push — mock GitHub: GET (no existing file) then PUT (created).
    const mockFetch = vi.fn((_url: string, init?: any) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? { ok: true, status: 201, json: () => Promise.resolve({}) }
          : { ok: false, status: 404, json: () => Promise.resolve({}) },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    const pushRes = await app.request('/api/prompts/sync/github/push', { method: 'POST', headers: auth() });
    expect(pushRes.status).toBe(200);
    expect((await pushRes.json()).pushed).toBe(1);

    const putCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(putCall![0]).toContain('/repos/acme/prompts-repo/contents/prompts/welcome/greeting.json');
    expect(putCall![1].headers.Authorization).toBe('Bearer ghp_secrettoken1234');
    expect(JSON.parse(Buffer.from(JSON.parse(putCall![1].body).content, 'base64').toString()).name).toBe('greeting');
  });

  it('refuses to push when GitHub sync is not configured', async () => {
    const res = await app.request('/api/prompts/sync/github/push', { method: 'POST', headers: auth() });
    expect(res.status).toBe(400);
  });
});

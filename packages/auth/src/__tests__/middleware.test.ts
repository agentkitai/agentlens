import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requirePermission } from '../middleware/hono.js';
import type { AuthContext } from '../types.js';

function makeApp(authCtx?: AuthContext) {
  const app = new Hono();

  // Simulate upstream auth middleware
  app.use('*', async (c, next) => {
    if (authCtx) c.set('auth', authCtx);
    await next();
  });

  app.get('/protected', requirePermission('events:write'), (c) => {
    return c.json({ ok: true });
  });

  return app;
}

const editorAuth: AuthContext = {
  identity: { type: 'user', id: '1', displayName: 'Test', role: 'editor' },
  tenantId: 't1',
  permissions: ['events:read', 'events:write', 'sessions:read'],
};

const viewerAuth: AuthContext = {
  identity: { type: 'user', id: '2', displayName: 'Viewer', role: 'viewer' },
  tenantId: 't1',
  permissions: ['events:read', 'sessions:read'],
};

describe('requirePermission middleware', () => {
  it('returns 401 when no auth context', async () => {
    const app = makeApp();
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 403 when permission missing', async () => {
    const app = makeApp(viewerAuth);
    const res = await app.request('/protected');
    expect(res.status).toBe(403);
  });

  it('returns 200 when permission present', async () => {
    const app = makeApp(editorAuth);
    const res = await app.request('/protected');
    expect(res.status).toBe(200);
  });
});

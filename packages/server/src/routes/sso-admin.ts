/**
 * SSO admin + enforcement routes (#148) — `/sso`.
 *
 * Enterprise-gated. Domain-ownership verification (DNS TXT) and the enforcement
 * lookup the login flow consults to decide whether to force SSO for an email.
 */
import { Hono } from 'hono';
import type { AnyDb } from '../db/dialect-db.js';
import { SsoConnectionStore } from '../db/sso-connection-store.js';
import {
  enforcedConnectionForEmail,
  ssoLoginUrl,
  requestDomainVerification,
  confirmDomainVerification,
} from '../lib/sso/enforcement.js';

export interface SsoAdminConfig {
  baseUrl: string;
}

export function ssoAdminRoutes(db: AnyDb, cfg: SsoAdminConfig) {
  const app = new Hono();
  const store = new SsoConnectionStore(db);

  // Does this email's domain force SSO? The login UI calls this and redirects.
  app.get('/enforcement', async (c) => {
    const email = c.req.query('email');
    if (!email) return c.json({ error: 'email is required' }, 400);
    const conn = await enforcedConnectionForEmail(store, email);
    if (!conn) return c.json({ enforced: false });
    return c.json({ enforced: true, connectionId: conn.id, loginUrl: ssoLoginUrl(cfg.baseUrl, conn) });
  });

  // Start domain verification → returns the DNS TXT record the admin must add.
  app.post('/connections/:id/domain/verify-request', async (c) => {
    const result = await requestDomainVerification(store, c.req.param('id'));
    if (!result) return c.json({ error: 'Connection not found or has no domain' }, 404);
    return c.json(result);
  });

  // Confirm domain verification by checking DNS for the token.
  app.post('/connections/:id/domain/verify-confirm', async (c) => {
    const conn = await store.getById(c.req.param('id'));
    if (!conn) return c.json({ error: 'Connection not found' }, 404);
    const verified = await confirmDomainVerification(store, c.req.param('id'));
    return c.json({ verified }, verified ? 200 : 422);
  });

  return app;
}

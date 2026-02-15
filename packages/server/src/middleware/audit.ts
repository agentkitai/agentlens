/**
 * Audit Logger Middleware (SH-2)
 *
 * Injects the audit logger into Hono context as `c.get('audit')`.
 */

import { createMiddleware } from 'hono/factory';
import type { AuditLogger } from '../lib/audit.js';

export type AuditVariables = {
  audit: AuditLogger;
};

/**
 * Create middleware that injects the audit logger into context.
 */
export function auditMiddleware(auditLogger: AuditLogger) {
  return createMiddleware<{ Variables: AuditVariables }>(async (c, next) => {
    c.set('audit', auditLogger);
    return next();
  });
}

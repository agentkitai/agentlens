/**
 * Compliance Report & Export Endpoints (Feature 9 — EU AI Act)
 *
 * GET /report           — Generate compliance report (JSON)
 * GET /export/events    — Export events as JSON or streaming CSV
 */

import { Hono } from 'hono';
import { getTenantId } from './tenant-helper.js';
import { stream } from 'hono/streaming';
import type { UnifiedAuthVariables } from '../middleware/unified-auth.js';
import type { SqliteDb } from '../db/index.js';
import { EventRepository } from '../db/repositories/event-repository.js';
import { AnalyticsRepository } from '../db/repositories/analytics-repository.js';
import { GuardrailStore } from '../db/guardrail-store.js';
import { ComplianceReportBuilder } from '../lib/compliance-report.js';
import { CsvEventTransform, collectAllEvents } from '../lib/compliance-export.js';
import { runVerification } from '../lib/audit-verify.js';
import type { AuditVariables } from '../middleware/audit.js';

const REPORT_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 5000;

// ─── Validation Helpers ─────────────────────────────────────

function validateDateRange(from: string | undefined, to: string | undefined): { error?: string; from: string; to: string } {
  if (!from || !to) {
    return { error: 'Both "from" and "to" query parameters are required (ISO 8601)', from: '', to: '' };
  }
  if (isNaN(Date.parse(from))) {
    return { error: `Invalid ISO 8601 date for "from": ${from}`, from: '', to: '' };
  }
  if (isNaN(Date.parse(to))) {
    return { error: `Invalid ISO 8601 date for "to": ${to}`, from: '', to: '' };
  }
  const diffMs = new Date(to).getTime() - new Date(from).getTime();
  const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
  if (diffMs > oneYearMs) {
    return { error: 'Date range must not exceed 365 days', from: '', to: '' };
  }
  if (diffMs < 0) {
    return { error: '"from" must be before "to"', from: '', to: '' };
  }
  return { from, to };
}

// ─── Route Factory ──────────────────────────────────────────

export function complianceRoutes(
  db: SqliteDb,
  signingKey?: string,
  opts?: { retentionDays?: number; minimumRetentionDays?: number },
) {
  const app = new Hono<{ Variables: UnifiedAuthVariables & AuditVariables }>();
  const eventRepo = new EventRepository(db);
  const analyticsRepo = new AnalyticsRepository(db);
  const guardrailStore = new GuardrailStore(db);

  const builder = new ComplianceReportBuilder(
    eventRepo,
    analyticsRepo,
    guardrailStore,
    signingKey,
    opts?.retentionDays ?? 90,
    opts?.minimumRetentionDays ?? 180,
  );

  // ─── GET /report ────────────────────────────────────────

  app.get('/report', async (c) => {
    const auth = c.var.auth;
    const tenantId = getTenantId(c);

    const validation = validateDateRange(c.req.query('from'), c.req.query('to'));
    if (validation.error) {
      return c.json({ error: validation.error, status: 400 }, 400);
    }

    const { from, to } = validation;

    // Build with timeout
    const buildPromise = builder.build(tenantId, from, to);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), REPORT_TIMEOUT_MS),
    );

    const result = await Promise.race([buildPromise, timeoutPromise]);

    if (result === null) {
      return c.json({
        error: 'Report generation timed out',
        message: 'Generation did not complete within 30 seconds. Try a smaller date range.',
        status: 504,
      }, 504);
    }

    // Audit log
    const audit = c.get('audit');
    if (audit) {
      audit.log({
        tenantId,
        actorType: auth?.type === 'jwt' ? 'user' : 'api_key',
        actorId: auth?.userId ?? auth?.keyId ?? 'unknown',
        action: 'compliance_report_generated',
        resourceType: 'compliance_report',
        details: { from, to },
      });
    }

    return c.json(result, 200);
  });

  // ─── GET /export/events ─────────────────────────────────

  app.get('/export/events', async (c) => {
    const auth = c.var.auth;
    const tenantId = getTenantId(c);

    const validation = validateDateRange(c.req.query('from'), c.req.query('to'));
    if (validation.error) {
      return c.json({ error: validation.error, status: 400 }, 400);
    }

    const { from, to } = validation;
    const format = c.req.query('format') ?? 'json';

    if (format !== 'json' && format !== 'csv') {
      return c.json({ error: 'Invalid format. Use "json" or "csv"', status: 400 }, 400);
    }

    // Audit log
    const audit = c.get('audit');
    if (audit) {
      audit.log({
        tenantId,
        actorType: auth?.type === 'jwt' ? 'user' : 'api_key',
        actorId: auth?.userId ?? auth?.keyId ?? 'unknown',
        action: 'compliance_export_events',
        resourceType: 'compliance_export',
        details: { from, to, format },
      });
    }

    if (format === 'csv') {
      // Chain verification for header
      const verification = await runVerification(eventRepo, { tenantId, from, to, signingKey });
      const verificationStatus = verification.verified ? 'verified' : 'broken';

      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="agentlens-events-${from}-${to}.csv"`);
      c.header('Transfer-Encoding', 'chunked');
      c.header('X-Chain-Verification', verificationStatus);

      return stream(c, async (s) => {
        const transform = new CsvEventTransform();

        // Pipe transform output to the response stream
        transform.on('data', (chunk: Buffer | string) => {
          s.write(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        });

        const done = new Promise<void>((resolve) => {
          transform.on('end', resolve);
        });

        let offset = 0;
        while (true) {
          const batch = eventRepo.getEventsBatchByTenantAndRange(tenantId, from, to, offset, BATCH_SIZE);
          if (batch.length === 0) break;
          for (const row of batch) {
            transform.write(row);
          }
          offset += batch.length;
          if (batch.length < BATCH_SIZE) break;
        }
        transform.end();
        await done;
      });
    }

    // JSON format
    const allEvents = collectAllEvents(eventRepo, tenantId, from, to);
    const verification = await runVerification(eventRepo, { tenantId, from, to, signingKey });

    return c.json({
      exportedAt: new Date().toISOString(),
      range: { from, to },
      totalEvents: allEvents.length,
      chainVerification: verification,
      events: allEvents,
    }, 200);
  });

  return app;
}

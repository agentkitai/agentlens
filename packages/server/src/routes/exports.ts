/**
 * Signed, self-describing exports (#125).
 *
 * `POST /api/exports/sign` builds an audit-grade export of a session and signs it
 * with Ed25519 (asymmetric) — a third party verifies it with only the public key
 * from `/.well-known/jwks.json`, no shared secret. Each event is self-describing:
 * `chainCovered` distinguishes SDK-chained (tamper-evident) from OTLP
 * record-integrity-only events, and rows preserve the server-set `verifiedAgentId`
 * / `verifiedAgentMethod` and per-event cost — never client-supplied identity.
 */
import { Hono } from 'hono';
import { verifyChain, verifyRecords } from '@agentkitai/agentlens-core';
import type { IEventStore, AgentLensEvent } from '@agentkitai/agentlens-core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { signExport, verifyExport, type ExportSignature } from '../lib/export-signing.js';

export interface SignedExportEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  eventType: string;
  severity: string;
  prevHash: string | null;
  hash: string;
  /** SDK-chained (tamper-evident) vs OTLP record-integrity only. */
  chainCovered: boolean;
  verifiedAgentId: string | null;
  verifiedAgentMethod: string | null;
  costUsd: number | null;
}

export interface SignedExportBody {
  kind: 'agentlens.signed-export/v1';
  exportedAt: string;
  sessionId: string;
  chainValid: boolean;
  /** false ⇒ OTLP-ingested session: record-integrity only, not a linear chain. */
  chained: boolean;
  totalEvents: number;
  events: SignedExportEvent[];
}

function toSignedExportEvent(e: AgentLensEvent, chained: boolean): SignedExportEvent {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    timestamp: e.timestamp,
    sessionId: e.sessionId,
    agentId: e.agentId,
    eventType: e.eventType,
    severity: e.severity,
    prevHash: e.prevHash,
    hash: e.hash,
    // Session-level: an SDK chain's genesis event (prevHash=null) is still
    // chain-covered, whereas an OTLP session is record-integrity only throughout.
    chainCovered: chained,
    verifiedAgentId: typeof meta.verifiedAgentId === 'string' ? meta.verifiedAgentId : null,
    verifiedAgentMethod: typeof meta.verifiedAgentMethod === 'string' ? meta.verifiedAgentMethod : null,
    costUsd: typeof p.costUsd === 'number' ? p.costUsd : null,
  };
}

export function buildSignedExportBody(sessionId: string, events: AgentLensEvent[], exportedAt: string): SignedExportBody {
  const unchained = events.length > 0 && events.every((e) => e.prevHash === null);
  const chained = !unchained;
  const chainResult = unchained ? verifyRecords(events) : verifyChain(events);
  return {
    kind: 'agentlens.signed-export/v1',
    exportedAt,
    sessionId,
    chainValid: chainResult.valid,
    chained,
    totalEvents: events.length,
    events: events.map((e) => toSignedExportEvent(e, chained)),
  };
}

export function exportsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/exports/sign — build + Ed25519-sign a session export.
  app.post('/sign', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
    if (!body.sessionId) return c.json({ error: 'sessionId required', status: 400 }, 400);

    const session = await tenantStore.getSession(body.sessionId);
    if (!session) return c.json({ error: 'Session not found', status: 404 }, 404);

    const events = await tenantStore.getSessionTimeline(body.sessionId);
    const exportBody = buildSignedExportBody(body.sessionId, events, new Date().toISOString());
    const signature = signExport(exportBody);
    return c.json({ export: exportBody, signature });
  });

  // POST /api/exports/verify — verify a signed export. Pass `jwk` to verify with
  // the public key alone (the same check a third party runs against the JWKS).
  app.post('/verify', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      export?: unknown;
      signature?: ExportSignature;
      jwk?: Record<string, string>;
    };
    if (!body.export || !body.signature) {
      return c.json({ error: 'export and signature required', status: 400 }, 400);
    }
    return c.json({ valid: verifyExport(body.export, body.signature, body.jwk) });
  });

  return app;
}

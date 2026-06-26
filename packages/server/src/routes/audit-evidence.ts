/**
 * Cross-product verifiable evidence endpoints (#98, Phase 1).
 *
 *   GET  /api/audit/timeline          — chain-tagged timeline for one verified agent.
 *   POST /api/audit/evidence/export   — signed, portable evidence pack for one agent.
 *   POST /api/audit/evidence/verify   — verify a pack's signature.
 *
 * Folded under /api/audit/* (owner decision agentlens#98(a)). **Authorization is
 * the centralized `requireCategory('manage')` guard already applied to
 * /api/audit/* in app.ts** — same as the sibling audit.ts; do NOT re-derive a
 * role from the apiKeys column here (it diverges from the JWT/scope-derived
 * RBAC and locks out OIDC admins/owners/auditors). Keyed strictly on the
 * server-derived verified_agent_id (98(c)); HMAC-signed, pluggable type (98(b)).
 */

import { Hono } from 'hono';

import type { SqliteDb } from '../db/index.js';
import { EventRepository } from '../db/repositories/event-repository.js';
import { runVerification } from '../lib/audit-verify.js';
import {
  collectAgentEvents,
  toTimelineEvent,
  signEvidencePack,
  verifyEvidencePackSignature,
  type SessionChainProof,
  type EvidencePackBody,
  type SignedEvidencePack,
} from '../lib/evidence.js';
import { getTenantId } from './tenant-helper.js';
import type { AuthVariables } from '../middleware/auth.js';

/** from/to required + valid ISO 8601 + from ≤ to + ≤ 1 year span. */
function parseRange(from: unknown, to: unknown): { error?: string; from?: string; to?: string } {
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) {
    return { error: 'Both "from" and "to" are required (ISO 8601)' };
  }
  if (isNaN(Date.parse(from))) return { error: `Invalid ISO 8601 date: ${from}` };
  if (isNaN(Date.parse(to))) return { error: `Invalid ISO 8601 date: ${to}` };
  const span = new Date(to).getTime() - new Date(from).getTime();
  if (span < 0) return { error: '"from" must be on or before "to"' };
  if (span > 365.25 * 24 * 60 * 60 * 1000) return { error: 'Range must not exceed 1 year' };
  return { from, to };
}

function parseTypes(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string' && t.length > 0);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return null;
}

async function buildPack(
  repo: EventRepository,
  tenantId: string,
  agentId: string,
  from: string,
  to: string,
  types: string[] | null,
): Promise<EvidencePackBody> {
  const rows = collectAgentEvents(repo, tenantId, agentId, from, to, types);
  // Verify the chain of every session the agent participated in.
  // ponytail: sequential N+1 over the agent's distinct sessions (bounded by the
  // ≤1-year window); parallelize via runWithConcurrency if export latency bites.
  const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
  const chains: SessionChainProof[] = [];
  for (const sessionId of sessionIds) {
    const v = await runVerification(repo, { tenantId, sessionId });
    chains.push({ sessionId, verified: v.verified, firstHash: v.firstHash, lastHash: v.lastHash });
  }
  return {
    kind: 'agentlens.evidence-pack/v1',
    exportedAt: new Date().toISOString(),
    tenantId,
    verifiedAgentId: agentId,
    range: { from, to },
    eventTypes: types,
    totalEvents: rows.length,
    chains,
    events: rows.map(toTimelineEvent),
  };
}

/** GET /api/audit/timeline — read-only timeline for one verified agent. */
export function auditTimelineRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const repo = new EventRepository(db);

  app.get('/', async (c) => {
    const agentId = c.req.query('agentId');
    if (!agentId) return c.json({ error: 'agentId is required', status: 400 }, 400);
    const range = parseRange(c.req.query('from'), c.req.query('to'));
    if (range.error) return c.json({ error: range.error, status: 400 }, 400);
    const types = parseTypes(c.req.query('types'));

    const tenantId = getTenantId(c);
    const rows = collectAgentEvents(repo, tenantId, agentId, range.from!, range.to!, types);
    return c.json({
      verifiedAgentId: agentId,
      range: { from: range.from, to: range.to },
      eventTypes: types,
      totalEvents: rows.length,
      events: rows.map(toTimelineEvent),
    });
  });

  return app;
}

/** POST /api/audit/evidence/{export,verify} — signed evidence pack + verification. */
export function auditEvidenceRoutes(db: SqliteDb, signingKey?: string) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const repo = new EventRepository(db);

  app.post('/export', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const agentId = body['agentId'];
    if (typeof agentId !== 'string' || !agentId) {
      return c.json({ error: 'agentId is required', status: 400 }, 400);
    }
    const range = parseRange(body['from'], body['to']);
    if (range.error) return c.json({ error: range.error, status: 400 }, 400);
    const types = parseTypes(body['types']);

    const tenantId = getTenantId(c);
    const packBody = await buildPack(repo, tenantId, agentId, range.from!, range.to!, types);
    const signature = signingKey ? signEvidencePack(packBody, signingKey) : null;
    return c.json({ ...packBody, signature } satisfies SignedEvidencePack, 200);
  });

  app.post('/verify', async (c) => {
    if (!signingKey) {
      return c.json(
        { error: 'Evidence verification is unavailable: no signing key configured (AGENTLENS_AUDIT_SIGNING_KEY)', status: 501 },
        501,
      );
    }
    const pack = (await c.req.json().catch(() => null)) as SignedEvidencePack | null;
    if (!pack || typeof pack !== 'object' || pack.kind !== 'agentlens.evidence-pack/v1') {
      return c.json({ error: 'Body must be an agentlens.evidence-pack/v1 document', status: 400 }, 400);
    }
    const result = verifyEvidencePackSignature(pack, signingKey);
    return c.json({ verifiedAgentId: pack.verifiedAgentId, ...result }, 200);
  });

  return app;
}

/**
 * Resolve the reviewer/annotator identity for human-score + annotation routes
 * (#122). Server-side only — the request body never carries identity.
 */
import type { AgentLensEvent } from '@agentkitai/agentlens-core';
import type { AuthContext } from '../middleware/unified-auth.js';
import { verifyAgentTokenWithMethod } from './agent-identity.js';
import type { AnnotatorIdentity } from './human-score.js';

/** The agent identity the session's events were stamped with (pack/analytics attribution). */
export function sessionVerifiedAgentId(timeline: AgentLensEvent[]): string | undefined {
  for (const e of timeline) {
    const v = e.metadata?.verifiedAgentId;
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Resolve the reviewer: AgentGate-verified agent token, else OIDC/JWT human, else the API key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveAnnotator(c: any): Promise<AnnotatorIdentity> {
  const verified = await verifyAgentTokenWithMethod(c.req.header('x-agent-token'));
  if (verified) return { annotatorAgentId: verified.id, annotatorMethod: verified.method };
  const auth = c.get('auth') as AuthContext | undefined;
  if (auth?.userId) return { annotatorUserId: auth.userId, annotatorRole: auth.role };
  if (auth?.keyId) return { annotatorUserId: `apikey:${auth.keyId}`, annotatorRole: auth.role };
  // Legacy api-key context (no unified 'auth' set).
  const apiKey = c.get('apiKey') as { id?: string } | undefined;
  if (apiKey?.id) return { annotatorUserId: `apikey:${apiKey.id}` };
  return {};
}

/** A stable id for the annotator, for assignment / identity checks. */
export function submitterId(a: AnnotatorIdentity): string | undefined {
  return a.annotatorAgentId ?? a.annotatorUserId;
}

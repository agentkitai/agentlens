/**
 * Agent identity verification (#12 Phase 2 — the cross-repo wedge).
 *
 * AgentLens events carry an `agentId`, but it is self-reported by the SDK. To
 * make the tamper-evident audit trail *attributable*, ingest can verify an
 * AgentGate-minted agent token (presented as `X-Agent-Token`) and stamp the
 * resulting verified id into event metadata.
 *
 * The token is the same artifact AgentGate issues from POST /api/agents/token:
 * an HS256 JWT over a SHARED secret with a load-bearing `typ:"agent"` claim.
 * Verifying it here therefore requires AgentGate's signing secret, configured
 * as AGENTGATE_JWT_SECRET — this must be AgentGate's REAL signing secret (the
 * same JWT_SECRET it mints tokens with); a placeholder/weak value would let
 * tokens be forged. When unset the feature is simply off (events ingest
 * unchanged, with no verified id). Verification is cryptographic only —
 * AgentLens does not call back to AgentGate, so it proves identity, not
 * liveness; agent tokens are short-lived, which bounds the staleness (a revoked
 * agent's token is accepted until it expires, ≤ the access-token TTL).
 *
 * Mirrors AgentGate's verifyAgentToken so the two stay in lockstep.
 */

import { verifyAccessToken, type AuthConfig } from 'agentkit-auth';

/** The reserved metadata keys this module owns; always server-set, never trusted from a client. */
export const VERIFIED_AGENT_META_KEYS = ['verifiedAgentId', 'verifiedAgentMethod'] as const;

const AGENT_TOKEN_TYP = 'agent';

/** AgentGate's signing secret, shared with AgentLens to verify agent tokens. Empty → feature off. */
function agentTokenSecret(): string | null {
  const s = process.env['AGENTGATE_JWT_SECRET'];
  return s && s.length > 0 ? s : null;
}

/** True when agent-token verification is configured (a shared secret is present). */
export function agentIdentityEnabled(): boolean {
  return agentTokenSecret() !== null;
}

/**
 * Verify a token AS an AgentGate agent token. Returns the agent id (`sub`) iff
 * the signature is valid AND `typ === "agent"`; otherwise null — including for
 * valid user tokens (the typ guard prevents cross-over), expired tokens, and
 * when no shared secret is configured.
 */
export async function verifyAgentToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const secret = agentTokenSecret();
  if (!secret) return null;

  const config: AuthConfig = {
    oidc: null,
    jwt: { secret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 },
    authDisabled: false,
  };

  const claims = await verifyAccessToken(token, config);
  if (!claims) return null;
  if ((claims as Record<string, unknown>)['typ'] !== AGENT_TOKEN_TYP) return null;
  return typeof claims.sub === 'string' ? claims.sub : null;
}

/**
 * Return a copy of `metadata` with the reserved verified-agent keys removed.
 * EVERY ingest path must run client-supplied metadata through this (or
 * stampVerifiedAgent) so the keys are never client-controlled — the guarantee
 * is "verifiedAgentId in stored metadata is always server-set".
 */
export function stripVerifiedAgentKeys(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!(VERIFIED_AGENT_META_KEYS as readonly string[]).includes(k)) clean[k] = v;
  }
  return clean;
}

/**
 * Read the server-set verified agent id out of (already-stamped) metadata, for
 * projection into the dedicated `verified_agent_id` column at insert (#87). The
 * column is a DERIVED index of this value — never hashed, never client-settable
 * (the keys were stripped/stamped upstream). Returns null when unverified.
 */
export function metadataVerifiedAgentId(metadata: Record<string, unknown> | null | undefined): string | null {
  const v = metadata?.['verifiedAgentId'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Strip the reserved verified-agent keys from `metadata` (so a client can never
 * forge them) and stamp the server-verified id back in when one was resolved.
 * The result is what gets hashed + persisted.
 */
export function stampVerifiedAgent(
  metadata: Record<string, unknown>,
  verifiedAgentId: string | null,
): Record<string, unknown> {
  const clean = stripVerifiedAgentKeys(metadata);
  if (verifiedAgentId) {
    clean['verifiedAgentId'] = verifiedAgentId;
    clean['verifiedAgentMethod'] = 'agentgate_token';
  }
  return clean;
}

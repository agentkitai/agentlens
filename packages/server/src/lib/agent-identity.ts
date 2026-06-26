/**
 * Agent identity verification (#12 Phase 2 + #97 JWKS — the cross-repo wedge).
 *
 * AgentLens events carry an `agentId`, but it is self-reported by the SDK. To
 * make the tamper-evident audit trail *attributable*, ingest verifies an
 * AgentGate-minted agent token (presented as `X-Agent-Token`) and stamps the
 * resulting verified id into event metadata.
 *
 * The token is the artifact AgentGate issues from POST /api/agents/token, a JWT
 * with a load-bearing `typ:"agent"` claim. Two signing schemes are supported,
 * selected by the JWS header `alg`:
 *   - HS256 over a SHARED secret (AGENTGATE_JWT_SECRET = AgentGate's REAL
 *     JWT_SECRET; a placeholder/weak value would let tokens be forged).
 *   - RS256 verified against AgentGate's published JWKS (#40), so AgentLens
 *     holds NO secret — configured via AGENTGATE_JWKS_URL or derived from
 *     AGENTGATE_URL. This path performs a *cached* HTTP fetch of the JWKS (not
 *     a per-token callback).
 * When neither is configured the feature is off (ingest unchanged, no verified
 * id). Verification is of the TOKEN only — there is no per-token liveness check
 * against AgentGate, so it proves identity, not liveness; agent tokens are
 * short-lived, which bounds the staleness (a revoked agent's token is accepted
 * until it expires, ≤ the access-token TTL). Optional AGENTGATE_TOKEN_AUDIENCE /
 * AGENTGATE_TOKEN_ISSUER, when set, are enforced on BOTH paths.
 *
 * Mirrors AgentGate's verifyAgentToken so the two stay in lockstep.
 */

import { verifyAccessToken, type AuthConfig } from 'agentkit-auth';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';

/** The reserved metadata keys this module owns; always server-set, never trusted from a client. */
export const VERIFIED_AGENT_META_KEYS = ['verifiedAgentId', 'verifiedAgentMethod'] as const;

const AGENT_TOKEN_TYP = 'agent';

/** How a verified agent id was established (stamped into `verifiedAgentMethod`). */
export type VerifiedAgentMethod = 'agentgate_token' | 'agentgate_jwks' | 'agentgate_ingest_key';

/** AgentGate's signing secret, shared with AgentLens to verify HS256 agent tokens. Empty → that path off. */
function agentTokenSecret(): string | null {
  const s = process.env['AGENTGATE_JWT_SECRET'];
  return s && s.length > 0 ? s : null;
}

/**
 * URL of AgentGate's JWKS (#40) for verifying RS256 agent tokens WITHOUT the
 * shared secret. Explicit `AGENTGATE_JWKS_URL` wins; otherwise derived from
 * `AGENTGATE_URL` + `/.well-known/jwks.json`. Empty → the JWKS path is off.
 */
function agentTokenJwksUrl(): string | null {
  const explicit = process.env['AGENTGATE_JWKS_URL'];
  if (explicit && explicit.length > 0) return explicit;
  const base = process.env['AGENTGATE_URL'];
  if (base && base.length > 0) return base.replace(/\/+$/, '') + '/.well-known/jwks.json';
  return null;
}

/** Optional audience to require on verify (must match AgentGate's AGENT_TOKEN_AUDIENCE). Enforced on BOTH paths. */
function agentTokenAudience(): string | undefined {
  const a = process.env['AGENTGATE_TOKEN_AUDIENCE'];
  return a && a.length > 0 ? a : undefined;
}

/** Optional issuer to require on verify (must match AgentGate's AGENT_TOKEN_ISSUER). Enforced on BOTH paths. */
function agentTokenIssuer(): string | undefined {
  const i = process.env['AGENTGATE_TOKEN_ISSUER'];
  return i && i.length > 0 ? i : undefined;
}

/** True iff `aud` (string or array) satisfies the required audience. */
function audienceMatches(aud: unknown, required: string): boolean {
  return typeof aud === 'string' ? aud === required : Array.isArray(aud) && aud.includes(required);
}

// createRemoteJWKSet caches keys + handles kid rotation internally; cache one
// resolver per URL so we don't refetch on every token. The URL is operator
// config (not attacker-controlled), so there is no SSRF surface. Pin the fetch
// timeout + refetch cooldown so a slow/unreachable AgentGate JWKS can't add
// jose's larger defaults of latency to every RS256-token ingest request.
let jwksCache: { url: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;
function getRemoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  if (jwksCache?.url !== url) {
    jwksCache = {
      url,
      jwks: createRemoteJWKSet(new URL(url), {
        timeoutDuration: 2500,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      }),
    };
  }
  return jwksCache.jwks;
}

/** Drop the cached JWKS resolver (tests + after a config change). */
export function __resetAgentJwksCache(): void {
  jwksCache = null;
}

/** True when EITHER verification path is configured (shared secret or JWKS URL). */
export function agentIdentityEnabled(): boolean {
  return agentTokenSecret() !== null || agentTokenJwksUrl() !== null;
}

/**
 * Verify a token AS an AgentGate agent token and report HOW it was verified.
 * The token's header `alg` selects the path: RS-family → AgentGate's JWKS (#40,
 * pinned to RS256 so an HS/none swap can't down-bid, no shared secret needed);
 * else → the shared-secret HS256 path. Both re-check `typ === "agent"`. Returns
 * null for user tokens (typ guard), expired/forged tokens, and when neither
 * path is configured. Never throws — any verifier error rejects the token.
 */
export async function verifyAgentTokenWithMethod(
  token: string | undefined | null,
): Promise<{ id: string; method: VerifiedAgentMethod } | null> {
  if (!token) return null;

  let alg: unknown;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return null; // not a well-formed JWS
  }

  // alg.startsWith('RS') routes RS256/384/512 here, but the verify is pinned to
  // RS256 (AgentGate mints RS256 today) — an RS384/512 token is safely rejected,
  // not 500'd. If AgentGate ever rotates the signing alg, update both in lockstep.
  if (typeof alg === 'string' && alg.startsWith('RS')) {
    const url = agentTokenJwksUrl();
    if (!url) return null; // asymmetric token but no JWKS source → reject
    try {
      const aud = agentTokenAudience();
      const iss = agentTokenIssuer();
      const { payload } = await jwtVerify(token, getRemoteJwks(url), {
        algorithms: ['RS256'],
        ...(aud ? { audience: aud } : {}),
        ...(iss ? { issuer: iss } : {}),
      });
      if ((payload as Record<string, unknown>)['typ'] !== AGENT_TOKEN_TYP) return null;
      return typeof payload.sub === 'string' ? { id: payload.sub, method: 'agentgate_jwks' } : null;
    } catch {
      return null;
    }
  }

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
  // agentkit-auth's HS256 verify doesn't check aud/iss, so enforce them here so
  // both paths honour AGENTGATE_TOKEN_AUDIENCE / _ISSUER consistently.
  const aud = agentTokenAudience();
  if (aud && !audienceMatches((claims as Record<string, unknown>)['aud'], aud)) return null;
  const iss = agentTokenIssuer();
  if (iss && (claims as Record<string, unknown>)['iss'] !== iss) return null;
  return typeof claims.sub === 'string' ? { id: claims.sub, method: 'agentgate_token' } : null;
}

/**
 * Verify a token AS an AgentGate agent token. Returns the agent id (`sub`) or
 * null. Thin wrapper over {@link verifyAgentTokenWithMethod} for callers that
 * don't need the method.
 */
export async function verifyAgentToken(token: string | undefined | null): Promise<string | null> {
  return (await verifyAgentTokenWithMethod(token))?.id ?? null;
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
  method: string = 'agentgate_token',
): Record<string, unknown> {
  const clean = stripVerifiedAgentKeys(metadata);
  if (verifiedAgentId) {
    clean['verifiedAgentId'] = verifiedAgentId;
    clean['verifiedAgentMethod'] = method;
  }
  return clean;
}

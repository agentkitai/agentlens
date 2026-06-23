/**
 * Agent identity verification (#12 Phase 2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signAccessToken, type AuthConfig } from 'agentkit-auth';
import { verifyAgentToken, stampVerifiedAgent, stripVerifiedAgentKeys, agentIdentityEnabled } from '../agent-identity.js';

const SECRET = 'agentgate-shared-secret-at-least-32-chars!';

function cfg(secret = SECRET, ttl = 900): AuthConfig {
  return { oidc: null, jwt: { secret, accessTokenTtlSeconds: ttl, refreshTokenTtlSeconds: 604800 }, authDisabled: false };
}

const agentClaims = (sub: string) => ({ sub, tid: 'default', role: 'viewer', email: '', typ: 'agent' });

describe('verifyAgentToken', () => {
  beforeEach(() => { process.env['AGENTGATE_JWT_SECRET'] = SECRET; });
  afterEach(() => { delete process.env['AGENTGATE_JWT_SECRET']; });

  it('resolves a valid agent token to its agent id', async () => {
    const t = await signAccessToken(agentClaims('agt_abc'), cfg());
    expect(await verifyAgentToken(t)).toBe('agt_abc');
  });

  it('rejects a user token (no typ:agent) — prevents cross-over', async () => {
    const t = await signAccessToken({ sub: 'user_1', tid: 'default', role: 'admin', email: 'u@x.io' }, cfg());
    expect(await verifyAgentToken(t)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const t = await signAccessToken(agentClaims('agt_abc'), cfg('a-totally-different-secret-32-chars-xx'));
    expect(await verifyAgentToken(t)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const t = await signAccessToken(agentClaims('agt_abc'), cfg(SECRET, -10));
    expect(await verifyAgentToken(t)).toBeNull();
  });

  it('returns null for undefined/empty input', async () => {
    expect(await verifyAgentToken(undefined)).toBeNull();
    expect(await verifyAgentToken('')).toBeNull();
  });

  it('is disabled (returns null) when no shared secret is configured', async () => {
    delete process.env['AGENTGATE_JWT_SECRET'];
    expect(agentIdentityEnabled()).toBe(false);
    const t = await signAccessToken(agentClaims('agt_abc'), cfg());
    expect(await verifyAgentToken(t)).toBeNull();
  });
});

describe('stampVerifiedAgent', () => {
  it('strips client-supplied reserved keys and stamps the verified id', () => {
    const out = stampVerifiedAgent({ foo: 1, verifiedAgentId: 'forged', verifiedAgentMethod: 'forged' }, 'agt_real');
    expect(out).toEqual({ foo: 1, verifiedAgentId: 'agt_real', verifiedAgentMethod: 'agentgate_token' });
  });

  it('strips reserved keys even with no verified id (anti-forgery)', () => {
    const out = stampVerifiedAgent({ foo: 1, verifiedAgentId: 'forged' }, null);
    expect(out).toEqual({ foo: 1 });
    expect(out['verifiedAgentId']).toBeUndefined();
  });
});

describe('stripVerifiedAgentKeys', () => {
  it('removes both reserved keys and keeps the rest', () => {
    const out = stripVerifiedAgentKeys({ a: 1, verifiedAgentId: 'x', verifiedAgentMethod: 'y', b: 2 });
    expect(out).toEqual({ a: 1, b: 2 });
  });
});

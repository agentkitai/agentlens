/**
 * Agent identity verification (#12 Phase 2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signAccessToken, type AuthConfig } from '@agentkitai/auth';
import { verifyAgentToken, verifyAgentTokenWithMethod, stampVerifiedAgent, stripVerifiedAgentKeys, agentIdentityEnabled } from '../agent-identity.js';

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

describe('delegated (RFC-8693) tokens — verify to the ACTOR + carry the principal (#43)', () => {
  beforeEach(() => { process.env['AGENTGATE_JWT_SECRET'] = SECRET; });
  afterEach(() => { delete process.env['AGENTGATE_JWT_SECRET']; });

  it('verifyAgentTokenWithMethod: id = actor (act.sub), onBehalfOf = principal (sub)', async () => {
    const t = await signAccessToken({ ...agentClaims('agt_A'), act: { sub: 'agt_B' } }, cfg());
    const v = await verifyAgentTokenWithMethod(t);
    expect(v?.id).toBe('agt_B'); // enforcement targets the actor
    expect(v?.onBehalfOf).toBe('agt_A'); // attribution records the principal
  });

  it('verifyAgentToken (thin wrapper) returns the actor for a delegated token', async () => {
    const t = await signAccessToken({ ...agentClaims('agt_A'), act: { sub: 'agt_B' } }, cfg());
    expect(await verifyAgentToken(t)).toBe('agt_B');
  });

  it('a plain token has no onBehalfOf (backward compatible)', async () => {
    const t = await signAccessToken(agentClaims('agt_solo'), cfg());
    const v = await verifyAgentTokenWithMethod(t);
    expect(v?.id).toBe('agt_solo');
    expect(v?.onBehalfOf).toBeUndefined();
  });
});

describe('stampVerifiedAgent', () => {
  it('strips client-supplied reserved keys and stamps the verified id', () => {
    const out = stampVerifiedAgent({ foo: 1, verifiedAgentId: 'forged', verifiedAgentMethod: 'forged' }, 'agt_real');
    expect(out).toEqual({ foo: 1, verifiedAgentId: 'agt_real', verifiedAgentMethod: 'agentgate_token' });
  });

  it('stamps verifiedOnBehalfOf for a delegation, and strips a forged one', () => {
    const out = stampVerifiedAgent(
      { foo: 1, verifiedOnBehalfOf: 'forged' },
      'agt_B',
      'agentgate_jwks',
      'agt_A',
    );
    expect(out).toEqual({ foo: 1, verifiedAgentId: 'agt_B', verifiedAgentMethod: 'agentgate_jwks', verifiedOnBehalfOf: 'agt_A' });
  });

  it('omits verifiedOnBehalfOf for a non-delegated token', () => {
    const out = stampVerifiedAgent({ foo: 1 }, 'agt_B', 'agentgate_token');
    expect(out['verifiedOnBehalfOf']).toBeUndefined();
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

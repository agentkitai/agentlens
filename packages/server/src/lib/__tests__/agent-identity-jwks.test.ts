/**
 * Agent identity — RS256 verification via AgentGate's JWKS (#97 / agentgate#40).
 *
 * AgentLens verifies AgentGate's asymmetric agent tokens against the published
 * JWKS, dropping the shared-secret coupling. Covers alg routing, the derived
 * vs explicit JWKS URL, typ guard, audience scoping, and that the HS256
 * shared-secret path is unaffected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { signAccessToken, type AuthConfig } from 'agentkit-auth';
import {
  verifyAgentToken,
  verifyAgentTokenWithMethod,
  agentIdentityEnabled,
  __resetAgentJwksCache,
} from '../agent-identity.js';

const AUD = 'agentlens';

async function rsaSigner(kid = 'k1') {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pub = await exportJWK(publicKey);
  pub.kid = kid;
  pub.alg = 'RS256';
  pub.use = 'sig';
  return { priv: privateKey, jwk: pub as JWK, kid };
}

/** Serve { keys } from any fetch (jose's createRemoteJWKSet expects a JSON body). */
function stubJwks(keys: JWK[]) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'content-type': 'application/jwk-set+json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function signAgent(
  priv: CryptoKey,
  kid: string,
  opts: { sub?: string; typ?: string; aud?: string } = {},
) {
  const b = new SignJWT({ typ: opts.typ ?? 'agent' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(opts.sub ?? 'agt_rs')
    .setIssuedAt()
    .setExpirationTime('5m');
  if (opts.aud) b.setAudience(opts.aud);
  return b.sign(priv);
}

const hsCfg = (secret: string): AuthConfig => ({
  oidc: null,
  jwt: { secret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 },
  authDisabled: false,
});

beforeEach(() => {
  __resetAgentJwksCache();
  delete process.env['AGENTGATE_JWT_SECRET'];
  delete process.env['AGENTGATE_URL'];
  delete process.env['AGENTGATE_JWKS_URL'];
  delete process.env['AGENTGATE_TOKEN_AUDIENCE'];
  delete process.env['AGENTGATE_TOKEN_ISSUER'];
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetAgentJwksCache();
  delete process.env['AGENTGATE_JWT_SECRET'];
  delete process.env['AGENTGATE_URL'];
  delete process.env['AGENTGATE_JWKS_URL'];
  delete process.env['AGENTGATE_TOKEN_AUDIENCE'];
  delete process.env['AGENTGATE_TOKEN_ISSUER'];
});

describe('RS256 verification via JWKS', () => {
  it('verifies an RS256 agent token against the JWKS and reports method agentgate_jwks', async () => {
    const s = await rsaSigner();
    stubJwks([s.jwk]);
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    const token = await signAgent(s.priv, s.kid, { sub: 'agt_rs' });

    expect(await verifyAgentTokenWithMethod(token)).toEqual({ id: 'agt_rs', method: 'agentgate_jwks' });
    expect(await verifyAgentToken(token)).toBe('agt_rs');
  });

  it('is enabled with only a JWKS URL (no shared secret)', () => {
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    expect(agentIdentityEnabled()).toBe(true);
  });

  it('derives the JWKS URL from AGENTGATE_URL', async () => {
    const s = await rsaSigner();
    const fetchMock = stubJwks([s.jwk]);
    process.env['AGENTGATE_URL'] = 'https://gate.example/';
    const token = await signAgent(s.priv, s.kid);

    expect(await verifyAgentToken(token)).toBe('agt_rs');
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toBe('https://gate.example/.well-known/jwks.json');
  });

  it('rejects an RS256 token whose typ is not agent (no cross-over)', async () => {
    const s = await rsaSigner();
    stubJwks([s.jwk]);
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    const token = await signAgent(s.priv, s.kid, { typ: 'access', sub: 'user_1' });
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it('rejects an RS256 token signed by a key not in the JWKS', async () => {
    const inSet = await rsaSigner('k1');
    const rogue = await rsaSigner('rogue');
    stubJwks([inSet.jwk]); // only k1 published
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    const token = await signAgent(rogue.priv, 'rogue');
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it('rejects an RS256 token when no JWKS source is configured', async () => {
    const s = await rsaSigner();
    stubJwks([s.jwk]);
    // no AGENTGATE_URL / AGENTGATE_JWKS_URL
    const token = await signAgent(s.priv, s.kid);
    expect(await verifyAgentToken(token)).toBeNull();
  });
});

describe('audience scoping', () => {
  it('accepts a matching aud and rejects a missing/wrong aud when required', async () => {
    const s = await rsaSigner();
    stubJwks([s.jwk]);
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    process.env['AGENTGATE_TOKEN_AUDIENCE'] = AUD;

    const good = await signAgent(s.priv, s.kid, { aud: AUD });
    expect(await verifyAgentToken(good)).toBe('agt_rs');

    const noAud = await signAgent(s.priv, s.kid);
    expect(await verifyAgentToken(noAud)).toBeNull();

    const wrongAud = await signAgent(s.priv, s.kid, { aud: 'someone-else' });
    expect(await verifyAgentToken(wrongAud)).toBeNull();
  });
});

describe('HS256 shared-secret path is unaffected', () => {
  it('still verifies an HS256 agent token and reports method agentgate_token', async () => {
    const SECRET = 'agentgate-shared-secret-at-least-32-chars!';
    process.env['AGENTGATE_JWT_SECRET'] = SECRET;
    const token = await signAccessToken(
      { sub: 'agt_hs', tid: 'default', role: 'viewer', email: '', typ: 'agent' },
      hsCfg(SECRET),
    );
    expect(await verifyAgentTokenWithMethod(token)).toEqual({ id: 'agt_hs', method: 'agentgate_token' });
  });

  it('enforces AGENTGATE_TOKEN_AUDIENCE on the HS256 path too (#97 fix)', async () => {
    const SECRET = 'agentgate-shared-secret-at-least-32-chars!';
    process.env['AGENTGATE_JWT_SECRET'] = SECRET;
    process.env['AGENTGATE_TOKEN_AUDIENCE'] = AUD;
    const key = new TextEncoder().encode(SECRET);
    const hs = (opts: { aud?: string } = {}) => {
      const b = new SignJWT({ typ: 'agent' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('agt_hs')
        .setIssuedAt()
        .setExpirationTime('5m');
      if (opts.aud) b.setAudience(opts.aud);
      return b.sign(key);
    };
    expect(await verifyAgentToken(await hs({ aud: AUD }))).toBe('agt_hs');
    expect(await verifyAgentToken(await hs())).toBeNull(); // missing aud
    expect(await verifyAgentToken(await hs({ aud: 'other' }))).toBeNull(); // wrong aud
  });

  it('enforces AGENTGATE_TOKEN_ISSUER on the HS256 path too (#97 fix)', async () => {
    const SECRET = 'agentgate-shared-secret-at-least-32-chars!';
    process.env['AGENTGATE_JWT_SECRET'] = SECRET;
    process.env['AGENTGATE_TOKEN_ISSUER'] = 'https://gate.example';
    const key = new TextEncoder().encode(SECRET);
    const hs = (opts: { iss?: string } = {}) => {
      const b = new SignJWT({ typ: 'agent' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('agt_hs')
        .setIssuedAt()
        .setExpirationTime('5m');
      if (opts.iss) b.setIssuer(opts.iss);
      return b.sign(key);
    };
    expect(await verifyAgentToken(await hs({ iss: 'https://gate.example' }))).toBe('agt_hs');
    expect(await verifyAgentToken(await hs())).toBeNull(); // missing iss
    expect(await verifyAgentToken(await hs({ iss: 'https://evil' }))).toBeNull(); // wrong iss
  });

  it('rejects an HS256 token when only the JWKS path is configured', async () => {
    const SECRET = 'agentgate-shared-secret-at-least-32-chars!';
    process.env['AGENTGATE_JWKS_URL'] = 'https://gate.example/.well-known/jwks.json';
    stubJwks([(await rsaSigner()).jwk]);
    const token = await signAccessToken(
      { sub: 'agt_hs', tid: 'default', role: 'viewer', email: '', typ: 'agent' },
      hsCfg(SECRET),
    );
    expect(await verifyAgentToken(token)).toBeNull(); // HS256 path off (no shared secret)
  });
});

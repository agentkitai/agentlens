import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OidcConfig } from '../config.js';

// Mock openid-client at module level
vi.mock('openid-client', () => {
  const fakeConfig = { serverMetadata: () => ({ issuer: 'https://idp.example.com' }) };
  return {
    discovery: vi.fn().mockResolvedValue(fakeConfig),
    randomPKCECodeVerifier: vi.fn().mockReturnValue('test-verifier'),
    randomState: vi.fn().mockReturnValue('test-state'),
    calculatePKCECodeChallenge: vi.fn().mockResolvedValue('test-challenge'),
    buildAuthorizationUrl: vi.fn().mockImplementation((_config, params) => {
      const url = new URL('https://idp.example.com/authorize');
      for (const [k, v] of Object.entries(params as Record<string, string>)) {
        url.searchParams.set(k, v);
      }
      return url;
    }),
    authorizationCodeGrant: vi.fn().mockResolvedValue({
      access_token: 'mock-access-token',
      id_token: 'mock-id-token',
      claims: () => ({
        sub: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        tenant_id: 'tenant-1',
        role: 'admin',
      }),
    }),
  };
});

import { OidcClient } from '../oidc.js';
import * as oidc from 'openid-client';

const testConfig: OidcConfig = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'my-app',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:3000/callback',
  tenantClaim: 'tenant_id',
  roleClaim: 'role',
};

describe('OidcClient', () => {
  let client: OidcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OidcClient(testConfig);
  });

  it('discovers on first call', async () => {
    await client.discover();
    expect(oidc.discovery).toHaveBeenCalledOnce();
  });

  it('static helpers return values', () => {
    expect(OidcClient.generateCodeVerifier()).toBe('test-verifier');
    expect(OidcClient.generateState()).toBe('test-state');
  });

  describe('getAuthorizationUrl', () => {
    it('returns URL with PKCE params', async () => {
      const url = await client.getAuthorizationUrl('my-state', 'my-verifier');
      expect(url).toContain('https://idp.example.com/authorize');
      expect(url).toContain('state=my-state');
      expect(url).toContain('code_challenge=test-challenge');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('scope=openid+profile+email');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges code and returns claims', async () => {
      const result = await client.exchangeCode('auth-code', 'my-verifier');
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.idToken).toBe('mock-id-token');
      expect(result.claims).toEqual({
        sub: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        tenantId: 'tenant-1',
        role: 'admin',
      });
    });

    it('throws if no id_token', async () => {
      vi.mocked(oidc.authorizationCodeGrant).mockResolvedValueOnce({
        access_token: 'tok',
        id_token: undefined,
        claims: () => ({}),
      } as any);
      await expect(client.exchangeCode('code', 'verifier')).rejects.toThrow('No id_token');
    });
  });

  describe('JWKS cache refresh', () => {
    it('re-discovers after TTL expires', async () => {
      await client.discover();
      expect(oidc.discovery).toHaveBeenCalledTimes(1);

      // Simulate time passing beyond 1hr
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_601_000);
      await client.getAuthorizationUrl('s', 'v');
      expect(oidc.discovery).toHaveBeenCalledTimes(2);
      vi.restoreAllMocks();
    });
  });
});

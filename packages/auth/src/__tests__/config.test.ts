import { describe, it, expect } from 'vitest';
import { loadOidcConfig } from '../config.js';

describe('loadOidcConfig', () => {
  it('returns null when OIDC_ISSUER is not set', () => {
    expect(loadOidcConfig({})).toBeNull();
  });

  it('throws when OIDC_ISSUER set but other required vars missing', () => {
    expect(() => loadOidcConfig({ OIDC_ISSUER: 'https://idp.example.com' })).toThrow(
      /OIDC_CLIENT_ID/,
    );
  });

  it('parses full config with defaults', () => {
    const cfg = loadOidcConfig({
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'my-app',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/callback',
    });
    expect(cfg).toEqual({
      issuerUrl: 'https://idp.example.com',
      clientId: 'my-app',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/callback',
      tenantClaim: 'tenant_id',
      roleClaim: 'role',
    });
  });

  it('uses custom claim names', () => {
    const cfg = loadOidcConfig({
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'my-app',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/callback',
      OIDC_TENANT_CLAIM: 'org_id',
      OIDC_ROLE_CLAIM: 'custom_role',
    });
    expect(cfg!.tenantClaim).toBe('org_id');
    expect(cfg!.roleClaim).toBe('custom_role');
  });
});

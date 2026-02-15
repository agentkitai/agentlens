// @agentkit/auth — Auth + OIDC configuration from environment variables

export type AuthMode = 'dual' | 'oidc-required' | 'api-key-only';

/**
 * Determine auth mode from environment. Defaults to 'dual'.
 */
export function getAuthMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const mode = env.AUTH_MODE as AuthMode | undefined;
  if (mode && ['dual', 'oidc-required', 'api-key-only'].includes(mode)) return mode;
  return 'dual';
}

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantClaim: string;
  roleClaim: string;
}

/**
 * Parse OIDC config from environment variables.
 * Returns null if OIDC_ISSUER is not set (OIDC disabled, API-key-only mode).
 */
export function loadOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuerUrl = env.OIDC_ISSUER;
  if (!issuerUrl) return null;

  const clientId = env.OIDC_CLIENT_ID;
  const clientSecret = env.OIDC_CLIENT_SECRET;
  const redirectUri = env.OIDC_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'OIDC_ISSUER is set but OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI are all required.',
    );
  }

  return {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    tenantClaim: env.OIDC_TENANT_CLAIM ?? 'tenant_id',
    roleClaim: env.OIDC_ROLE_CLAIM ?? 'role',
  };
}

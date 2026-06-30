/**
 * OIDC enterprise connections (#148) — per-org OIDC SSO built on the shared
 * OidcClient (PKCE auth-code flow), configured from an sso_connections row.
 * Microsoft / Azure AD works as a standard OIDC connection (issuerUrl points at
 * the tenant's v2.0 endpoint). Mirrors the SAML SP flow.
 */
import { OidcClient, type OidcClaims, type OidcConfig } from '@agentkitai/auth';
import { SsoConnectionStore, type SsoConnection } from '../../db/sso-connection-store.js';

interface OidcConnConfig {
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tenantClaim?: string;
  roleClaim?: string;
  groupsClaim?: string;
}

export function buildOidcClient(conn: SsoConnection, baseUrl: string): OidcClient {
  const cfg = (conn.config ?? {}) as OidcConnConfig;
  const oidcConfig: OidcConfig = {
    issuerUrl: cfg.issuerUrl ?? '',
    clientId: cfg.clientId ?? '',
    clientSecret: cfg.clientSecret ?? '',
    redirectUri: `${baseUrl}/sso/oidc/${conn.id}/callback`,
    tenantClaim: cfg.tenantClaim ?? 'tenantId',
    roleClaim: cfg.roleClaim ?? 'role',
    groupsClaim: cfg.groupsClaim ?? 'groups',
  };
  return new OidcClient(oidcConfig);
}

/**
 * Resolve the user's role: the connection's IdP-group → role mapping wins, else
 * the OIDC role claim, else viewer.
 */
export function resolveOidcRole(conn: SsoConnection, claims: OidcClaims): string {
  const mapped = SsoConnectionStore.roleForGroups(conn, claims.groups ?? []);
  if (mapped) return mapped;
  return claims.role ?? 'viewer';
}

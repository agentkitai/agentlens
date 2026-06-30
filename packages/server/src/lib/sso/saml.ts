/**
 * SAML 2.0 SP helper (#148) — wraps @node-saml/node-saml, configured per-org from
 * an sso_connections row. SP-initiated flow: login redirect, ACS assertion
 * validation (signed assertions), SP metadata. IdP group → role via the
 * connection's group_role_mappings.
 */
import { SAML, type Profile } from '@node-saml/node-saml';
import { SsoConnectionStore, type SsoConnection } from '../../db/sso-connection-store.js';

interface SamlConnConfig {
  /** IdP SSO endpoint (where the AuthnRequest is sent). */
  entryPoint?: string;
  /** IdP signing certificate (PEM or base64 body) — validates the assertion. */
  idpCert?: string;
  /** SP entity id / issuer (defaults to the metadata URL). */
  issuer?: string;
  /** Expected audience; false disables the check. */
  audience?: string | false;
  wantAssertionsSigned?: boolean;
}

export function buildSaml(conn: SsoConnection, baseUrl: string): SAML {
  const cfg = (conn.config ?? {}) as SamlConnConfig;
  return new SAML({
    callbackUrl: `${baseUrl}/sso/saml/${conn.id}/acs`,
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer ?? `${baseUrl}/sso/saml/${conn.id}/metadata`,
    idpCert: cfg.idpCert ?? '',
    audience: cfg.audience ?? false,
    wantAssertionsSigned: cfg.wantAssertionsSigned ?? true,
    // Stateless ACS — we don't persist AuthnRequest ids across the redirect.
    validateInResponseTo: 'never' as never,
  });
}

/** SP-initiated login URL (redirect target). */
export function samlLoginUrl(conn: SsoConnection, baseUrl: string, relayState = ''): Promise<string> {
  return buildSaml(conn, baseUrl).getAuthorizeUrlAsync(relayState, undefined, {});
}

/** Validate a signed SAMLResponse; returns the profile or throws/returns null. */
export async function validateSamlResponse(conn: SsoConnection, baseUrl: string, samlResponse: string): Promise<Profile | null> {
  const { profile } = await buildSaml(conn, baseUrl).validatePostResponseAsync({ SAMLResponse: samlResponse });
  return profile ?? null;
}

/** SP metadata XML for the IdP to consume. */
export function samlMetadata(conn: SsoConnection, baseUrl: string): string {
  return buildSaml(conn, baseUrl).generateServiceProviderMetadata(null, null);
}

export interface SamlUser {
  email: string;
  displayName?: string;
  groups: string[];
}

/** Pull email / displayName / groups out of a validated SAML profile (IdP-agnostic). */
export function extractSamlUser(profile: Profile): SamlUser {
  const p = profile as unknown as Record<string, unknown>;
  const attrs = (p.attributes as Record<string, unknown>) ?? {};
  const pick = (k: string): unknown => p[k] ?? attrs[k];
  const email = String(pick('email') ?? p.nameID ?? attrs['emailAddress'] ?? '');
  const displayNameRaw = pick('displayName') ?? pick('name');
  const rawGroups = pick('groups') ?? attrs['http://schemas.xmlsoap.org/claims/Group'] ?? [];
  const groups = Array.isArray(rawGroups) ? rawGroups.map(String) : rawGroups ? [String(rawGroups)] : [];
  return {
    email,
    displayName: displayNameRaw ? String(displayNameRaw) : undefined,
    groups,
  };
}

/** Map the SAML user's IdP groups to a role via the connection (default viewer). */
export function resolveSamlRole(conn: SsoConnection, groups: string[]): string {
  return SsoConnectionStore.roleForGroups(conn, groups) ?? 'viewer';
}

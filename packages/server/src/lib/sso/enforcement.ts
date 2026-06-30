/**
 * SSO enforcement + email-domain verification (#148).
 *
 * A domain is "enforced" when it has an enabled, domain-verified, enforced
 * sso_connection — then non-SSO logins for that domain must be redirected to SSO.
 * Domain ownership is proven with a DNS TXT record (`agentlens-verify=<token>`).
 * The DNS resolver is injectable so the flow is testable without real DNS.
 */
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { SsoConnectionStore, SsoConnection } from '../../db/sso-connection-store.js';

export type TxtResolver = (hostname: string) => Promise<string[][]>;

/** Lower-cased email domain, or null if not an email. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** The enforced SSO connection for an email's domain, or null. */
export async function enforcedConnectionForEmail(
  store: SsoConnectionStore,
  email: string,
): Promise<SsoConnection | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  return (await store.getEnforcedByDomain(domain)) ?? null;
}

/** The SSO login URL for a connection (SP-initiated start). */
export function ssoLoginUrl(baseUrl: string, conn: SsoConnection): string {
  const kind = conn.type === 'oidc' ? 'oidc' : 'saml';
  return `${baseUrl}/sso/${kind}/${conn.id}/login`;
}

/** Generate a DNS-TXT verification token for a connection's domain. */
export async function requestDomainVerification(
  store: SsoConnectionStore,
  connId: string,
): Promise<{ domain: string; token: string; txtRecord: string } | null> {
  const conn = await store.getById(connId);
  if (!conn || !conn.domain) return null;
  const token = randomBytes(16).toString('hex');
  await store.update(connId, { config: { ...conn.config, domainVerificationToken: token } });
  const txtRecord = `agentlens-verify=${token}`;
  return { domain: conn.domain, token, txtRecord };
}

/**
 * Confirm domain ownership by checking the domain's TXT records for the token.
 * Sets domain_verified on success.
 */
export async function confirmDomainVerification(
  store: SsoConnectionStore,
  connId: string,
  resolveTxt: TxtResolver = dns.resolveTxt,
): Promise<boolean> {
  const conn = await store.getById(connId);
  if (!conn || !conn.domain) return false;
  const token = (conn.config as { domainVerificationToken?: string }).domainVerificationToken;
  if (!token) return false;

  let records: string[][];
  try {
    records = await resolveTxt(conn.domain);
  } catch {
    return false;
  }
  const expected = `agentlens-verify=${token}`;
  const found = records.some((chunks) => chunks.join('').trim() === expected);
  if (!found) return false;

  await store.update(connId, { domainVerified: true });
  return true;
}

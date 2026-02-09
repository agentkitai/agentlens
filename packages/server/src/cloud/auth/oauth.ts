/**
 * OAuth provider integration (Google + GitHub).
 *
 * This module handles:
 * 1. Generating OAuth authorization URLs
 * 2. Exchanging authorization codes for tokens
 * 3. Fetching user profile from OAuth providers
 * 4. Creating/linking user records on first login
 * 5. Issuing JWT session cookies
 */

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthUserProfile {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface OAuthConfig {
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
}

// ═══════════════════════════════════════════
// Google OAuth
// ═══════════════════════════════════════════

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export function getGoogleAuthUrl(config: OAuthProviderConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeGoogleCode(
  config: OAuthProviderConfig,
  code: string,
): Promise<{ accessToken: string }> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status}`);
  const data = await resp.json();
  return { accessToken: data.access_token };
}

export async function getGoogleProfile(accessToken: string): Promise<OAuthUserProfile> {
  const resp = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Google profile fetch failed: ${resp.status}`);
  const data = await resp.json();
  return {
    provider: 'google',
    providerId: data.id,
    email: data.email,
    name: data.name ?? null,
    avatarUrl: data.picture ?? null,
  };
}

// ═══════════════════════════════════════════
// GitHub OAuth
// ═══════════════════════════════════════════

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

export function getGithubAuthUrl(config: OAuthProviderConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'user:email',
    state,
  });
  return `${GITHUB_AUTH_URL}?${params}`;
}

export async function exchangeGithubCode(
  config: OAuthProviderConfig,
  code: string,
): Promise<{ accessToken: string }> {
  const resp = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });
  if (!resp.ok) throw new Error(`GitHub token exchange failed: ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  return { accessToken: data.access_token };
}

export async function getGithubProfile(accessToken: string): Promise<OAuthUserProfile> {
  const [userResp, emailsResp] = await Promise.all([
    fetch(GITHUB_USER_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }),
    fetch(GITHUB_EMAILS_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }),
  ]);

  if (!userResp.ok) throw new Error(`GitHub user fetch failed: ${userResp.status}`);
  const user = await userResp.json();

  let email = user.email;
  if (!email && emailsResp.ok) {
    const emails = await emailsResp.json();
    const primary = emails.find((e: any) => e.primary && e.verified);
    email = primary?.email ?? emails[0]?.email;
  }
  if (!email) throw new Error('No email found from GitHub');

  return {
    provider: 'github',
    providerId: String(user.id),
    email,
    name: user.name ?? user.login ?? null,
    avatarUrl: user.avatar_url ?? null,
  };
}

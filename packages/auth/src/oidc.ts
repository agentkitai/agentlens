// @agentkit/auth — OIDC Provider Integration (openid-client v6)

import * as oidc from 'openid-client';
import type { OidcConfig } from './config.js';

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  tenantId?: string;
  role?: string;
}

export interface TokenSet {
  accessToken: string;
  idToken: string;
  claims: OidcClaims;
}

export class OidcClient {
  private config: OidcConfig;
  private serverConfig: oidc.Configuration | null = null;
  private jwksCacheTime = 0;

  constructor(config: OidcConfig) {
    this.config = config;
  }

  /** Discover IdP endpoints. Must be called before other methods. */
  async discover(): Promise<void> {
    this.serverConfig = await oidc.discovery(
      new URL(this.config.issuerUrl),
      this.config.clientId,
      this.config.clientSecret,
    );
    this.jwksCacheTime = Date.now();
  }

  private async ensureDiscovered(): Promise<oidc.Configuration> {
    if (!this.serverConfig) {
      await this.discover();
    }
    // Refresh JWKS cache if stale
    if (Date.now() - this.jwksCacheTime > JWKS_TTL_MS) {
      await this.discover();
    }
    return this.serverConfig!;
  }

  /**
   * Generate a PKCE code verifier for use with authorization flow.
   */
  static generateCodeVerifier(): string {
    return oidc.randomPKCECodeVerifier();
  }

  /**
   * Generate a random state parameter.
   */
  static generateState(): string {
    return oidc.randomState();
  }

  /**
   * Build the authorization URL with PKCE challenge.
   */
  async getAuthorizationUrl(state: string, codeVerifier: string): Promise<string> {
    const config = await this.ensureDiscovered();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return url.href;
  }

  /**
   * Exchange an authorization code for tokens. Validates the id_token.
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    const config = await this.ensureDiscovered();

    const currentUrl = new URL(this.config.redirectUri);
    currentUrl.searchParams.set('code', code);

    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
    });

    const idToken = tokens.id_token;
    const accessToken = tokens.access_token;

    if (!idToken) {
      throw new Error('No id_token returned from token endpoint');
    }

    const claims = tokens.claims();
    if (!claims) {
      throw new Error('Failed to extract claims from id_token');
    }

    return {
      accessToken,
      idToken,
      claims: this.extractClaims(claims),
    };
  }

  /** Extract standard + configurable claims from the id_token payload. */
  private extractClaims(payload: Record<string, unknown>): OidcClaims {
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      tenantId: payload[this.config.tenantClaim] as string | undefined,
      role: payload[this.config.roleClaim] as string | undefined,
    };
  }
}

/**
 * Auth Service — orchestrates user creation, login, OAuth, and sessions.
 *
 * Uses MigrationClient (pg Pool) for database operations.
 * In-memory brute-force protection (replaceable with Redis in prod).
 */

import type { MigrationClient } from '../migrate.js';
import { hashPassword, verifyPassword, validatePasswordComplexity } from './passwords.js';
import { signJwt, verifyJwt, type JwtPayload } from './jwt.js';
import { generateToken, hashToken, verifyToken } from './tokens.js';
import { BruteForceProtection } from './brute-force.js';
import type { OAuthUserProfile } from './oauth.js';

export interface AuthServiceConfig {
  jwtSecret: string;
  jwtExpiresInSeconds?: number; // default 7 days
}

export interface AuthUser {
  id: string;
  email: string;
  email_verified: boolean;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  oauth_provider: string | null;
  oauth_provider_id: string | null;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string | null };
}

export class AuthService {
  constructor(
    private db: MigrationClient,
    private config: AuthServiceConfig,
    private bruteForce = new BruteForceProtection(),
  ) {}

  // ═══════════════════════════════════════════
  // OAuth Login / Registration
  // ═══════════════════════════════════════════

  /**
   * Handle OAuth callback: find or create user, return JWT.
   */
  async oauthLogin(profile: OAuthUserProfile): Promise<AuthResult> {
    // 1. Try to find by OAuth provider + ID
    let user = await this.findUserByOAuth(profile.provider, profile.providerId);

    if (!user) {
      // 2. Try to find by email (link OAuth to existing account)
      user = await this.findUserByEmail(profile.email);

      if (user) {
        // Link OAuth to existing user
        await this.db.query(
          `UPDATE users SET oauth_provider = $1, oauth_provider_id = $2, 
           email_verified = TRUE, avatar_url = COALESCE(avatar_url, $3), 
           display_name = COALESCE(display_name, $4), updated_at = now()
           WHERE id = $5`,
          [profile.provider, profile.providerId, profile.avatarUrl, profile.name, user.id],
        );
        user.email_verified = true;
      } else {
        // 3. Create new user
        user = await this.createOAuthUser(profile);
      }
    }

    // Issue JWT
    const token = await this.issueToken(user);
    return { token, user: { id: user.id, email: user.email, name: user.display_name } };
  }

  private async createOAuthUser(profile: OAuthUserProfile): Promise<AuthUser> {
    // Create user
    const result = await this.db.query(
      `INSERT INTO users (email, email_verified, display_name, avatar_url, oauth_provider, oauth_provider_id)
       VALUES ($1, TRUE, $2, $3, $4, $5)
       RETURNING *`,
      [profile.email, profile.name, profile.avatarUrl, profile.provider, profile.providerId],
    );
    const user = (result.rows as AuthUser[])[0];

    // Create default personal org
    await this.createDefaultOrg(user);
    return user;
  }

  // ═══════════════════════════════════════════
  // Email/Password Registration
  // ═══════════════════════════════════════════

  /**
   * Register a new user with email and password.
   * Returns verification token (to be sent via email).
   */
  async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<{ user: AuthUser; verificationToken: string }> {
    // Validate password
    const complexity = validatePasswordComplexity(password);
    if (!complexity.valid) {
      throw new AuthError('invalid_password', complexity.errors.join('; '));
    }

    // Check if email already exists
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new AuthError('email_exists', 'An account with this email already exists');
    }

    // Hash password & create user
    const passwordHash = await hashPassword(password);
    const verificationToken = generateToken();
    const tokenHash = hashToken(verificationToken);

    const result = await this.db.query(
      `INSERT INTO users (email, email_verified, password_hash, display_name)
       VALUES ($1, FALSE, $2, $3)
       RETURNING *`,
      [email, passwordHash, displayName ?? null],
    );
    const user = (result.rows as AuthUser[])[0];

    // Store verification token (using a simple approach: store in users table or a tokens table)
    // For simplicity, we'll use the email_verification_token approach
    await this.db.query(
      `INSERT INTO _email_tokens (user_id, token_hash, type, expires_at)
       VALUES ($1, $2, 'verification', now() + interval '24 hours')`,
      [user.id, tokenHash],
    );

    return { user, verificationToken };
  }

  /**
   * Verify email address with token.
   */
  async verifyEmail(token: string): Promise<boolean> {
    const tokenHash = hashToken(token);
    const result = await this.db.query(
      `SELECT user_id FROM _email_tokens 
       WHERE token_hash = $1 AND type = 'verification' AND expires_at > now()`,
      [tokenHash],
    );
    if ((result.rows as any[]).length === 0) return false;

    const userId = (result.rows as any[])[0].user_id;
    await this.db.query(`UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1`, [userId]);
    await this.db.query(`DELETE FROM _email_tokens WHERE token_hash = $1`, [tokenHash]);

    // Create default org after verification
    const user = await this.findUserById(userId);
    if (user) await this.createDefaultOrg(user);

    return true;
  }

  // ═══════════════════════════════════════════
  // Email/Password Login
  // ═══════════════════════════════════════════

  /**
   * Login with email and password.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    // Check brute-force lock
    if (this.bruteForce.isLocked(email)) {
      throw new AuthError('account_locked', 'Account temporarily locked due to too many failed attempts');
    }

    const user = await this.findUserByEmail(email);
    if (!user || !user.password_hash) {
      this.bruteForce.recordFailure(email);
      throw new AuthError('invalid_credentials', 'Invalid email or password');
    }

    if (!user.email_verified) {
      throw new AuthError('email_not_verified', 'Please verify your email before logging in');
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const locked = this.bruteForce.recordFailure(email);
      if (locked) {
        throw new AuthError('account_locked', 'Account temporarily locked due to too many failed attempts');
      }
      throw new AuthError('invalid_credentials', 'Invalid email or password');
    }

    this.bruteForce.recordSuccess(email);

    const token = await this.issueToken(user);
    return { token, user: { id: user.id, email: user.email, name: user.display_name } };
  }

  // ═══════════════════════════════════════════
  // Password Reset
  // ═══════════════════════════════════════════

  /**
   * Request password reset. Returns token to be sent via email.
   * Always succeeds (even if email not found) to prevent enumeration.
   */
  async requestPasswordReset(email: string): Promise<string | null> {
    const user = await this.findUserByEmail(email);
    if (!user) return null; // Don't reveal whether email exists

    const token = generateToken();
    const tokenHash = hashToken(token);

    // Delete old reset tokens for this user
    await this.db.query(
      `DELETE FROM _email_tokens WHERE user_id = $1 AND type = 'reset'`,
      [user.id],
    );

    await this.db.query(
      `INSERT INTO _email_tokens (user_id, token_hash, type, expires_at)
       VALUES ($1, $2, 'reset', now() + interval '1 hour')`,
      [user.id, tokenHash],
    );

    return token;
  }

  /**
   * Reset password using token.
   */
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.valid) {
      throw new AuthError('invalid_password', complexity.errors.join('; '));
    }

    const tokenHash = hashToken(token);
    const result = await this.db.query(
      `SELECT user_id FROM _email_tokens 
       WHERE token_hash = $1 AND type = 'reset' AND expires_at > now()`,
      [tokenHash],
    );
    if ((result.rows as any[]).length === 0) return false;

    const userId = (result.rows as any[])[0].user_id;
    const passwordHash = await hashPassword(newPassword);

    await this.db.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [passwordHash, userId],
    );
    await this.db.query(`DELETE FROM _email_tokens WHERE token_hash = $1`, [tokenHash]);

    // Clear brute-force records for this user's email
    const user = await this.findUserById(userId);
    if (user) this.bruteForce.recordSuccess(user.email);

    return true;
  }

  // ═══════════════════════════════════════════
  // Token Issuance
  // ═══════════════════════════════════════════

  private async issueToken(user: AuthUser): Promise<string> {
    // Fetch user's org memberships
    const orgsResult = await this.db.query(
      `SELECT om.org_id, om.role FROM org_members om WHERE om.user_id = $1`,
      [user.id],
    );
    const orgs = (orgsResult.rows as Array<{ org_id: string; role: string }>).map((r) => ({
      org_id: r.org_id,
      role: r.role,
    }));

    return signJwt(
      { sub: user.id, email: user.email, name: user.display_name, orgs },
      this.config.jwtSecret,
      this.config.jwtExpiresInSeconds ?? 7 * 24 * 3600,
    );
  }

  // ═══════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════

  private async findUserByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.db.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return (result.rows as AuthUser[])[0] ?? null;
  }

  private async findUserById(id: string): Promise<AuthUser | null> {
    const result = await this.db.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return (result.rows as AuthUser[])[0] ?? null;
  }

  private async findUserByOAuth(provider: string, providerId: string): Promise<AuthUser | null> {
    const result = await this.db.query(
      `SELECT * FROM users WHERE oauth_provider = $1 AND oauth_provider_id = $2`,
      [provider, providerId],
    );
    return (result.rows as AuthUser[])[0] ?? null;
  }

  private async createDefaultOrg(user: AuthUser): Promise<void> {
    // Check if user already has an org
    const existing = await this.db.query(
      `SELECT 1 FROM org_members WHERE user_id = $1 LIMIT 1`,
      [user.id],
    );
    if ((existing.rows as any[]).length > 0) return;

    const displayName = user.display_name || user.email.split('@')[0];
    const slug = `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${user.id.slice(0, 8)}`;

    const orgResult = await this.db.query(
      `INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id`,
      [`${displayName}'s Org`, slug],
    );
    const orgId = (orgResult.rows as any[])[0].id;

    await this.db.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [orgId, user.id],
    );
  }
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

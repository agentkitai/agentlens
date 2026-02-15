// @agentkit/auth — Barrel export
export type {
  AuthContext,
  AuthConfig,
  Identity,
  IdentityType,
  Permission,
  Role,
} from './types.js';

export { ROLE_PERMISSIONS, hasPermission } from './rbac.js';
export { requirePermission, createAuthMiddleware } from './middleware/hono.js';
export type { ResolvedUser, CreateAuthMiddlewareOptions } from './middleware/hono.js';
export { getAuthMode } from './config.js';
export type { AuthMode } from './config.js';

export { loadOidcConfig } from './config.js';
export type { OidcConfig } from './config.js';
export { OidcClient } from './oidc.js';
export type { OidcClaims, TokenSet } from './oidc.js';

export {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  hashToken,
} from './jwt.js';
export type {
  AccessTokenClaims,
  RefreshTokenRow,
  RefreshTokenStore,
} from './jwt.js';

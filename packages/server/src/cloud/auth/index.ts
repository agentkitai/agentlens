export { AuthService, AuthError, type AuthServiceConfig, type AuthResult, type AuthUser } from './auth-service.js';
export { signJwt, verifyJwt, JWT_COOKIE_OPTIONS, type JwtPayload } from './jwt.js';
export { hashPassword, verifyPassword, validatePasswordComplexity } from './passwords.js';
export { generateToken, hashToken, verifyToken } from './tokens.js';
export { BruteForceProtection } from './brute-force.js';
export {
  ApiKeyService,
  ApiKeyError,
  generateApiKey,
  type ApiKeyRecord,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type ApiKeyEnvironment,
} from './api-keys.js';
export {
  ApiKeyAuthMiddleware,
  ApiKeyAuthError,
  InMemoryApiKeyCache,
  type ApiKeyAuthContext,
  type ApiKeyCache,
  type CacheEntry,
} from './api-key-middleware.js';
export {
  type OAuthConfig,
  type OAuthProviderConfig,
  type OAuthUserProfile,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  getGoogleProfile,
  getGithubAuthUrl,
  exchangeGithubCode,
  getGithubProfile,
} from './oauth.js';

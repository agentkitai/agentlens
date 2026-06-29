// @agentkit/auth — Core types

export type IdentityType = 'user' | 'api_key';

export interface AuthContext {
  identity: Identity;
  tenantId: string;
  permissions: Permission[];
}

export interface Identity {
  type: IdentityType;
  id: string;
  displayName: string;
  email?: string;
  role: Role;
}

// Unified role model (#147). Canonical: owner · admin · member · viewer · auditor.
// 'editor' is a DEPRECATED alias for 'member' (kept so existing tokens/keys work).
export type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'auditor' | 'editor';

export type Permission =
  | 'events:read' | 'events:write'
  | 'sessions:read'
  | 'agents:read' | 'agents:write'
  | 'config:read' | 'config:write'
  | 'keys:manage'
  | 'users:manage'
  | 'guardrails:read' | 'guardrails:write'
  | 'lessons:read' | 'lessons:write'
  | 'audit:read' | 'audit:export'
  | '*';

/** Coarse permission categories (the cloud guard model, folded in by #147). */
export type RoleCategory = 'read' | 'write' | 'manage' | 'billing' | 'audit';

export interface AuthConfig {
  oidc: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  } | null;
  jwt: {
    secret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
  };
  authDisabled: boolean;
}

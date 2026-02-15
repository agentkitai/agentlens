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

export type Role = 'viewer' | 'editor' | 'admin' | 'owner';

export type Permission =
  | 'events:read' | 'events:write'
  | 'sessions:read'
  | 'agents:read' | 'agents:write'
  | 'config:read' | 'config:write'
  | 'keys:manage'
  | 'users:manage'
  | 'guardrails:read' | 'guardrails:write'
  | 'lessons:read' | 'lessons:write'
  | '*';

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

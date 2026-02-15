/**
 * SH-7: Secret Management Hardening
 *
 * Resolves secrets from 3 tiers:
 *   1. process.env[name]           — plain env var (default)
 *   2. process.env[name + '_FILE'] — file path (Docker Secrets / K8s)
 *   3. process.env[name + '_ARN']  — AWS Secrets Manager ARN
 */

import { readFileSync } from 'node:fs';
import { createLogger } from './logger.js';

const log = createLogger('Secrets');

export interface SecretSpec {
  name: string;
  required?: boolean; // fail fast in production if missing
}

export interface ResolvedSecrets {
  [key: string]: string | undefined;
}

/**
 * Resolve a single secret through the 3-tier hierarchy.
 * Returns the resolved value or undefined.
 */
export async function resolveSecret(name: string): Promise<string | undefined> {
  // Tier 1: plain env var
  const plain = process.env[name];
  if (plain !== undefined) return plain;

  // Tier 2: file-based (_FILE suffix)
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf-8').trim();
    } catch (err) {
      throw new Error(
        `Secret ${name}: failed to read file "${filePath}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Tier 3: AWS Secrets Manager (_ARN suffix)
  const arn = process.env[`${name}_ARN`];
  if (arn) {
    return fetchFromAwsSecretsManager(arn, name);
  }

  return undefined;
}

/**
 * Lazy-import AWS SDK and fetch secret value.
 */
async function fetchFromAwsSecretsManager(arn: string, name: string): Promise<string> {
  try {
    // @ts-ignore — optional dependency; fails gracefully at runtime
    const mod = await import('@aws-sdk/client-secrets-manager').catch(() => {
      throw new Error(
        `Secret ${name}: install @aws-sdk/client-secrets-manager to use ARN-based secrets`,
      );
    });
    const { SecretsManagerClient, GetSecretValueCommand } = mod;
    const client = new SecretsManagerClient({});
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: arn }),
    );
    const value = response.SecretString;
    if (!value) {
      throw new Error(`Secret ${name}: ARN "${arn}" returned no SecretString`);
    }
    return value;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith(`Secret ${name}:`)) throw err;
    throw new Error(
      `Secret ${name}: AWS Secrets Manager fetch failed for "${arn}": ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Well-known secret names managed by this module. */
export const MANAGED_SECRETS: SecretSpec[] = [
  { name: 'JWT_SECRET', required: true },
  { name: 'OIDC_CLIENT_SECRET' },
  { name: 'DATABASE_URL' },
  { name: 'AGENTGATE_WEBHOOK_SECRET' },
  { name: 'FORMBRIDGE_WEBHOOK_SECRET' },
];

/**
 * Resolve all managed secrets at startup.
 * - Sets resolved values back into process.env for downstream consumers.
 * - Fails fast in production if required secrets are missing.
 * - Warns in production if all secrets are plain env vars (no file/ARN).
 */
export async function resolveAllSecrets(): Promise<ResolvedSecrets> {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const resolved: ResolvedSecrets = {};
  let allPlainEnv = true;

  for (const spec of MANAGED_SECRETS) {
    const { name } = spec;

    // Track whether any secret uses file or ARN tier
    if (process.env[`${name}_FILE`] || process.env[`${name}_ARN`]) {
      allPlainEnv = false;
    }

    const value = await resolveSecret(name);

    if (value !== undefined) {
      resolved[name] = value;
      // Inject into process.env so downstream code (config.ts, middleware) just reads env
      process.env[name] = value;
    } else if (spec.required && isProduction) {
      throw new Error(
        `FATAL: Required secret "${name}" is not set. ` +
        `Provide ${name}, ${name}_FILE, or ${name}_ARN.`,
      );
    }
  }

  if (isProduction && allPlainEnv) {
    log.warn(
      '⚠️  All secrets are plain environment variables. ' +
      'Consider using _FILE (Docker/K8s) or _ARN (AWS) for production hardening.',
    );
  }

  return resolved;
}

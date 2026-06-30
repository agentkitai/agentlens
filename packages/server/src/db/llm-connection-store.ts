/**
 * LLM connection store (#143) — bring-your-own provider credentials.
 *
 * Keys are encrypted at rest (lib/secret-box, AES-256-GCM). The plaintext key is
 * NEVER returned by the public shape (`LlmConnection`); only `keyLast4` is shown.
 * `getWithKey` decrypts for server-side invocation only (Playground, evaluators).
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';
import { encryptSecret, decryptSecret, lastFour } from '../lib/secret-box.js';

export type LlmProvider = 'openai' | 'anthropic' | 'azure' | 'bedrock' | 'vertex' | 'custom';

/** Public-safe connection (no secret). */
export interface LlmConnection {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  baseUrl?: string;
  defaultModel?: string;
  keyLast4: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionInput {
  provider: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  createdBy?: string;
}

interface Row {
  id: string;
  tenant_id: string;
  provider: string;
  name: string;
  base_url: string | null;
  default_model: string | null;
  encrypted_key: string;
  key_last4: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toPublic(r: Row): LlmConnection {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    provider: r.provider,
    name: r.name,
    baseUrl: r.base_url ?? undefined,
    defaultModel: r.default_model ?? undefined,
    keyLast4: r.key_last4,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class LlmConnectionStore {
  constructor(private readonly db: AnyDb) {}

  async create(tenantId: string, input: CreateConnectionInput): Promise<LlmConnection> {
    const now = new Date().toISOString();
    const row: Row = {
      id: `llmconn_${randomUUID()}`,
      tenant_id: tenantId,
      provider: input.provider,
      name: input.name,
      base_url: input.baseUrl ?? null,
      default_model: input.defaultModel ?? null,
      encrypted_key: encryptSecret(input.apiKey),
      key_last4: lastFour(input.apiKey),
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    };
    await dbRun(this.db, sql`
      INSERT INTO llm_connections
        (id, tenant_id, provider, name, base_url, default_model, encrypted_key, key_last4, created_by, created_at, updated_at)
      VALUES
        (${row.id}, ${row.tenant_id}, ${row.provider}, ${row.name}, ${row.base_url}, ${row.default_model},
         ${row.encrypted_key}, ${row.key_last4}, ${row.created_by}, ${row.created_at}, ${row.updated_at})
    `);
    return toPublic(row);
  }

  async list(tenantId: string): Promise<LlmConnection[]> {
    return (await dbAll<Row>(this.db, sql`SELECT * FROM llm_connections WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`))
      .map(toPublic);
  }

  async get(tenantId: string, id: string): Promise<LlmConnection | undefined> {
    const r = await dbGet<Row>(this.db, sql`SELECT * FROM llm_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
    return r ? toPublic(r) : undefined;
  }

  /** Internal: decrypt the key for server-side provider calls. Never expose via the API. */
  async getWithKey(tenantId: string, id: string): Promise<(LlmConnection & { apiKey: string }) | undefined> {
    const r = await dbGet<Row>(this.db, sql`SELECT * FROM llm_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
    if (!r) return undefined;
    return { ...toPublic(r), apiKey: decryptSecret(r.encrypted_key) };
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existed = (await this.get(tenantId, id)) !== undefined;
    await dbRun(this.db, sql`DELETE FROM llm_connections WHERE tenant_id = ${tenantId} AND id = ${id}`);
    return existed;
  }
}

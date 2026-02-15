/**
 * Test helpers: boot an in-memory AgentLens server and create an SDK client wired to it.
 */

import {
  createTestDb,
  runMigrations,
  SqliteEventStore,
  createApp,
  hashApiKey,
} from '@agentlensai/server';
import { sql } from 'drizzle-orm';
import { serve } from '@hono/node-server';
import { AgentLensClient } from '@agentlensai/sdk';

export { AgentLensClient };

const TEST_API_KEY = 'als_testkey123456789abcdef0123456789abcdef0123456789abcdef012345';

export interface TestEnv {
  client: AgentLensClient;
  apiKey: string;
  badClient: AgentLensClient;
  close: () => void;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);

  // Insert API key
  const keyHash = hashApiKey(TEST_API_KEY);
  db.run(
    sql`INSERT INTO api_keys (id, key_hash, name, scopes, created_at, tenant_id)
        VALUES ('test-key-id', ${keyHash}, 'Integration Test Key', '["*"]', ${Math.floor(Date.now() / 1000)}, 'default')`,
  );

  const app = await createApp(store, {
    authDisabled: false,
    db,
    corsOrigin: '*',
  });

  // Start on a random port
  const server = serve({ fetch: app.fetch, port: 0 });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://localhost:${port}`;

  const client = new AgentLensClient({
    url: baseUrl,
    apiKey: TEST_API_KEY,
    retry: { maxRetries: 0 },
    timeout: 5_000,
  });

  const badClient = new AgentLensClient({
    url: baseUrl,
    apiKey: 'als_invalid_key_000000000000000000000000000000000000000000000000000',
    retry: { maxRetries: 0 },
    timeout: 5_000,
  });

  return { client, apiKey: TEST_API_KEY, badClient, close: () => server.close() };
}

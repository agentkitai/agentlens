/**
 * Tenant-Aware Connection Pool (S-1.5)
 *
 * Wraps a PostgreSQL pool to automatically set `app.current_org`
 * via SET LOCAL within a transaction. SET LOCAL is scoped to the
 * transaction and auto-resets on commit/rollback, making it safe
 * for connection reuse and compatible with PgBouncer transaction mode.
 */

export interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

export interface Pool {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  end(): Promise<void>;
}

export interface TenantQueryResult {
  rows: unknown[];
  rowCount: number;
}

/**
 * Execute a function within a tenant-scoped transaction.
 *
 * 1. Acquires connection from pool
 * 2. BEGIN transaction
 * 3. SET LOCAL app.current_org = orgId (scoped to transaction)
 * 4. Execute the callback
 * 5. COMMIT (or ROLLBACK on error)
 * 6. Return connection to pool (app.current_org is auto-cleared)
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required for tenant-scoped transactions');
  }

  // Basic UUID format validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new Error('orgId must be a valid UUID');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL is transaction-scoped: auto-clears on COMMIT/ROLLBACK
    // Safe for PgBouncer transaction mode
    await client.query(`SET LOCAL app.current_org = $1`, [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a single query within a tenant-scoped transaction.
 * Convenience wrapper around withTenantTransaction for simple queries.
 */
export async function tenantQuery(
  pool: Pool,
  orgId: string,
  sql: string,
  params?: unknown[],
): Promise<TenantQueryResult> {
  return withTenantTransaction(pool, orgId, async (client) => {
    return client.query(sql, params);
  });
}

/**
 * Execute a query WITHOUT tenant context.
 * Use only for cross-tenant operations (e.g., admin queries, migrations).
 */
export async function adminQuery(
  pool: Pool,
  sql: string,
  params?: unknown[],
): Promise<TenantQueryResult> {
  return pool.query(sql, params);
}

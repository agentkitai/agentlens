/**
 * Postgres integration tests — CRUD for core tables, tenant isolation, migrations.
 * Skipped when DB_DIALECT !== 'postgresql' (i.e. no Postgres available).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { resolve } from 'path';

const IS_PG = process.env.DB_DIALECT === 'postgresql';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/agentlens_test';

const describePg = IS_PG ? describe : describe.skip;

describePg('Postgres integration tests', () => {
  let pool: any;
  let db: any;
  let schema: typeof import('../db/schema.postgres.js');

  beforeAll(async () => {
    // Dynamic imports so tests skip cleanly when pg isn't installed
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    schema = await import('../db/schema.postgres.js');

    pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    // Run migrations
    const migrationsFolder = resolve(__dirname, '../db/drizzle');
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await pool?.end();
  });

  // Clean tables before each test
  beforeEach(async () => {
    await db.delete(schema.events);
    await db.delete(schema.sessions);
    await db.delete(schema.agents);
    await db.delete(schema.apiKeys);
    await db.delete(schema.users);
  });

  // ─── CRUD: Events ─────────────────────────────────────
  describe('Events CRUD', () => {
    it('should insert and retrieve an event', async () => {
      const event = {
        id: 'evt-001',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'tool_call',
        severity: 'info',
        payload: { tool: 'search', args: {} },
        metadata: {},
        hash: 'abc123',
        tenantId: 'tenant-a',
      };

      await db.insert(schema.events).values(event);
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-001'));
      
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe('sess-001');
      expect(rows[0].eventType).toBe('tool_call');
    });

    it('should update an event', async () => {
      await db.insert(schema.events).values({
        id: 'evt-002',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'tool_call',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'hash1',
        tenantId: 'default',
      });

      await db.update(schema.events).set({ severity: 'error' }).where(eq(schema.events.id, 'evt-002'));
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-002'));
      expect(rows[0].severity).toBe('error');
    });

    it('should delete an event', async () => {
      await db.insert(schema.events).values({
        id: 'evt-003',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'log',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'hash2',
        tenantId: 'default',
      });

      await db.delete(schema.events).where(eq(schema.events.id, 'evt-003'));
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-003'));
      expect(rows).toHaveLength(0);
    });
  });

  // ─── CRUD: Sessions ───────────────────────────────────
  describe('Sessions CRUD', () => {
    it('should insert and retrieve a session', async () => {
      await db.insert(schema.sessions).values({
        id: 'sess-001',
        agentId: 'agent-001',
        startedAt: new Date().toISOString(),
        status: 'active',
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('active');
    });
  });

  // ─── CRUD: Agents ─────────────────────────────────────
  describe('Agents CRUD', () => {
    it('should insert and retrieve an agent', async () => {
      const now = new Date().toISOString();
      await db.insert(schema.agents).values({
        id: 'agent-001',
        name: 'TestAgent',
        firstSeenAt: now,
        lastSeenAt: now,
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, 'agent-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TestAgent');
    });
  });

  // ─── CRUD: Users ──────────────────────────────────────
  describe('Users CRUD', () => {
    it('should insert and retrieve a user', async () => {
      const now = Math.floor(Date.now() / 1000);
      await db.insert(schema.users).values({
        id: 'user-001',
        tenantId: 'default',
        email: 'test@example.com',
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      });

      const rows = await db.select().from(schema.users).where(eq(schema.users.id, 'user-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('test@example.com');
    });
  });

  // ─── CRUD: API Keys ──────────────────────────────────
  describe('API Keys CRUD', () => {
    it('should insert and retrieve an API key', async () => {
      const now = Math.floor(Date.now() / 1000);
      await db.insert(schema.apiKeys).values({
        id: 'key-001',
        keyHash: 'hash123',
        name: 'Test Key',
        scopes: ['read', 'write'],
        createdAt: now,
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, 'key-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Test Key');
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────
  describe('Tenant isolation', () => {
    it('should isolate events by tenant', async () => {
      const base = {
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'log',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'h',
      };

      await db.insert(schema.events).values([
        { ...base, id: 'evt-a1', tenantId: 'tenant-a', hash: 'ha1' },
        { ...base, id: 'evt-a2', tenantId: 'tenant-a', hash: 'ha2' },
        { ...base, id: 'evt-b1', tenantId: 'tenant-b', hash: 'hb1' },
      ]);

      const tenantAEvents = await db.select().from(schema.events)
        .where(eq(schema.events.tenantId, 'tenant-a'));
      const tenantBEvents = await db.select().from(schema.events)
        .where(eq(schema.events.tenantId, 'tenant-b'));

      expect(tenantAEvents).toHaveLength(2);
      expect(tenantBEvents).toHaveLength(1);
    });

    it('should isolate sessions by tenant', async () => {
      await db.insert(schema.sessions).values([
        { id: 'sess-001', agentId: 'a1', startedAt: new Date().toISOString(), tenantId: 'tenant-a' },
        { id: 'sess-001', agentId: 'a1', startedAt: new Date().toISOString(), tenantId: 'tenant-b' },
      ]);

      const tenantA = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.tenantId, 'tenant-a'));
      const tenantB = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.tenantId, 'tenant-b'));

      expect(tenantA).toHaveLength(1);
      expect(tenantB).toHaveLength(1);
    });

    it('should isolate agents by tenant', async () => {
      const now = new Date().toISOString();
      await db.insert(schema.agents).values([
        { id: 'agent-001', name: 'A', firstSeenAt: now, lastSeenAt: now, tenantId: 'tenant-a' },
        { id: 'agent-001', name: 'A', firstSeenAt: now, lastSeenAt: now, tenantId: 'tenant-b' },
      ]);

      const tenantA = await db.select().from(schema.agents)
        .where(eq(schema.agents.tenantId, 'tenant-a'));
      const tenantC = await db.select().from(schema.agents)
        .where(eq(schema.agents.tenantId, 'tenant-c'));

      expect(tenantA).toHaveLength(1);
      expect(tenantC).toHaveLength(0);
    });
  });

  // ─── Migration verification ───────────────────────────
  describe('Migration verification', () => {
    it('should have all expected tables', async () => {
      const result = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tableNames = result.rows.map((r: any) => r.table_name);
      
      const expectedTables = [
        'events', 'sessions', 'agents', 'alert_rules', 'alert_history',
        'users', 'api_keys', 'lessons', 'embeddings', 'session_summaries',
      ];

      for (const table of expectedTables) {
        expect(tableNames, `Missing table: ${table}`).toContain(table);
      }
    });
  });
});

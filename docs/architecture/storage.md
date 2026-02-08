# Storage Architecture

## Storage Interface

All storage operations go through the `IEventStore` interface defined in `@agentlens/core`. This makes the storage backend pluggable — SQLite and PostgreSQL share the same contract.

```typescript
interface IEventStore {
  // Write
  insertEvents(events: AgentLensEvent[]): Promise<void>;
  upsertSession(session: Partial<Session>): Promise<void>;
  upsertAgent(agent: Agent): Promise<void>;

  // Read — Events
  queryEvents(query: EventQuery): Promise<EventQueryResult>;
  getEvent(id: string): Promise<AgentLensEvent | null>;
  getSessionTimeline(sessionId: string): Promise<AgentLensEvent[]>;
  countEvents(query: EventQuery): Promise<number>;

  // Read — Sessions
  querySessions(query: SessionQuery): Promise<SessionQueryResult>;
  getSession(id: string): Promise<Session | null>;

  // Read — Agents
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;

  // Analytics
  getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult>;

  // Alert Rules
  createAlertRule(rule: AlertRule): Promise<void>;
  updateAlertRule(id: string, updates: Partial<AlertRule>): Promise<void>;
  deleteAlertRule(id: string): Promise<void>;
  listAlertRules(): Promise<AlertRule[]>;
  getAlertRule(id: string): Promise<AlertRule | null>;

  // Maintenance
  applyRetention(maxAgeDays: number): Promise<{ deletedCount: number }>;
  getStats(): Promise<StorageStats>;
}
```

## SQLite (Default)

### Why SQLite?

- Zero external dependencies — just a file on disk
- WAL mode enables concurrent reads with writes
- Excellent performance for single-instance deployments
- Perfect for self-hosted and edge deployments

### Configuration

| Pragma | Value | Purpose |
|---|---|---|
| `journal_mode` | `WAL` | Concurrent read/write |
| `synchronous` | `NORMAL` | Balance durability + speed |
| `cache_size` | `-64000` | 64 MB page cache |
| `busy_timeout` | `5000` | 5s retry on contention |

### Schema

Managed by Drizzle ORM with automatic migrations on startup.

**Tables:** `events`, `sessions`, `agents`, `alert_rules`, `alert_history`, `api_keys`, `config_kv`

**Key Indexes:**
- `idx_events_timestamp` — Time-range queries
- `idx_events_session_id` — Session timeline
- `idx_events_agent_id` — Agent filtering
- `idx_events_type` — Event type filtering
- `idx_events_session_ts` — Composite: session + timestamp
- `idx_events_agent_type_ts` — Composite: agent + type + timestamp (dashboard pattern)
- `idx_sessions_agent_id`, `idx_sessions_started_at`, `idx_sessions_status`

## PostgreSQL (Team)

For teams needing shared access, configure with:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/agentlens
DB_DIALECT=postgresql
```

Same `IEventStore` interface, same API behavior.

## Retention Policy

A configurable retention engine deletes old events to prevent unbounded growth:

- **Default:** 90 days
- **Configurable:** `RETENTION_DAYS` environment variable or Settings page
- **`0`** = keep forever
- Sessions with no remaining events are also cleaned up
- Runs daily on a scheduled interval

This is the only exception to the "no DELETE" rule — retention cleanup is an audited operation.

## Performance Targets

| Metric | Target |
|---|---|
| Event ingestion throughput | ≥ 1,000 events/sec |
| Ingestion latency (P95) | < 5ms per event (batch of 100) |
| Query latency (P95) | < 100ms for filtered queries (< 1M events) |
| Timeline render | < 1s for sessions with 1,000 events |
